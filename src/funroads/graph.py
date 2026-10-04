"""Build the drivable road graph from the OSM Netherlands extract.

Design
------
* Pass A reads ways only (no node locations, so it is fast) and counts how
  often each node is used by a drivable way. Nodes used by >= 2 drivable ways
  are junctions. Route relations are scanned at the same time to collect the
  way ids that carry a signed bicycle route.
* Pass B re-reads the file with node locations, splits every drivable way at
  its junction nodes and emits one directed edge per allowed driving
  direction. Geometry is stored once per undirected segment in RD New
  (EPSG:28992) and shared by both directions via an index range plus a
  `reversed` flag.
* Pass B also collects a point layer (traffic calming, stop/give-way/signals,
  level crossings, cafes and other stops, place nodes) and the exterior rings
  of scenic areas (forest, heath, dune, water, nature reserve).

Everything is written to data/cache/graph/graph.npz plus a small JSON side
file with the string tables, so later steps are pure array computation.

Determinism: the OSM file order drives everything, junction detection uses
np.unique, and node indices come from sorted unique ids. No Python sets are
used where iteration order could leak into the output.
"""

from __future__ import annotations

import json
import logging
import re
from array import array
from pathlib import Path

import numpy as np
import osmium
import osmium.filter as osm_filter
from pyproj import Transformer

from .config import ensure_dirs, projected_crs
from .access import allowed_windows

log = logging.getLogger("funroads.graph")

# ---------------------------------------------------------------------------
# Tag tables
# ---------------------------------------------------------------------------

DRIVABLE_HIGHWAY = (
    "living_street", "motorway", "motorway_link", "primary", "primary_link",
    "residential", "road", "secondary", "secondary_link", "tertiary",
    "tertiary_link", "trunk", "trunk_link", "unclassified",
)
DRIVABLE_SET = frozenset(DRIVABLE_HIGHWAY)
MOTORWAY_LIKE = frozenset({"motorway", "trunk", "motorway_link", "trunk_link"})
LINK_LIKE = frozenset({"motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"})

# Code 0 is reserved for "unknown" everywhere, so the tables start at 1.
HIGHWAY_CODES = {name: i + 1 for i, name in enumerate(DRIVABLE_HIGHWAY)}
HIGHWAY_NAMES = {v: k for k, v in HIGHWAY_CODES.items()}

SURFACE_ASPHALT = 1
SURFACE_CONCRETE = 2
SURFACE_PAVED = 3
SURFACE_STONES = 4
SURFACE_SETT = 5
SURFACE_LOOSE = 6

SURFACE_CODES = {
    "asphalt": SURFACE_ASPHALT, "chipseal": SURFACE_ASPHALT, "tarred": SURFACE_ASPHALT,
    "concrete": SURFACE_CONCRETE, "concrete:lanes": SURFACE_CONCRETE,
    "concrete:plates": SURFACE_CONCRETE,
    "paved": SURFACE_PAVED, "metal": SURFACE_PAVED, "wood": SURFACE_PAVED,
    "paving_stones": SURFACE_STONES, "bricks": SURFACE_STONES, "brick": SURFACE_STONES,
    "sett": SURFACE_SETT, "cobblestone": SURFACE_SETT, "unhewn_cobblestone": SURFACE_SETT,
    # Anything below is excluded by is_drivable_way, but keep the codes for reporting.
    "pebblestone": SURFACE_LOOSE, "compacted": SURFACE_LOOSE, "fine_gravel": SURFACE_LOOSE,
    "gravel": SURFACE_LOOSE, "ground": SURFACE_LOOSE, "dirt": SURFACE_LOOSE,
    "earth": SURFACE_LOOSE, "grass": SURFACE_LOOSE, "mud": SURFACE_LOOSE,
    "sand": SURFACE_LOOSE, "woodchips": SURFACE_LOOSE, "unpaved": SURFACE_LOOSE,
}
EXCLUDED_SURFACES = frozenset(k for k, v in SURFACE_CODES.items() if v == SURFACE_LOOSE)

SMOOTHNESS_CODES = {
    "excellent": 1, "good": 2, "intermediate": 3, "bad": 4, "very_bad": 5,
    "horrible": 6, "very_horrible": 7, "impassable": 8,
}

# Flag bits on edge_flags.
F_BRIDGE = 1
F_TUNNEL = 2
F_MOTORWAY = 4
F_LINK = 8
F_ROUNDABOUT = 16

# Point layer kinds.
PT_BUMP = 1        # traffic calming: bump, hump, table, cushion, chicane
PT_CONTROL = 2     # traffic signals, stop, give_way
PT_CROSSING = 3    # railway level crossing
PT_COFFEE = 4      # cafe / restaurant / bakery / ice cream: a Sunday stop
PT_FUEL = 5
PT_VIEW = 6        # viewpoint / attraction / picnic site
PT_PLACE = 7       # city/town/village/hamlet centre
PT_CAMERA = 8      # speed camera / average speed check

COFFEE_AMENITY = frozenset({"cafe", "restaurant", "fast_food", "ice_cream", "bakery", "pub", "biergarten"})
VIEW_TOURISM = frozenset({"attraction", "viewpoint", "picnic_site", "museum"})
PLACE_KINDS = frozenset({"city", "town", "village", "hamlet", "suburb", "borough"})
CALMING_HIGHWAY = frozenset({"speed_bump", "hump", "table", "cushion", "chicane", "choker", "dip", "rumble_strip"})

SCENIC_NATURAL = frozenset({"wood", "scrub", "heath", "moor", "sand", "dune", "wetland", "water", "bay", "beach", "grassland"})
SCENIC_LANDUSE = frozenset({"forest", "orchard", "vineyard", "meadow", "village_green", "recreation_ground"})
SCENIC_LEISURE = frozenset({"nature_reserve", "park"})
SCENIC_WATER = frozenset({"river", "lake", "reservoir", "canal"})

_SPEED_RE = re.compile(r"^\s*(\d+)\s*(mph)?", re.IGNORECASE)
_WALK_SPEEDS = {"walk", "NL:walk"}
_ZONE_SPEEDS = {"NL:urban": 50, "NL:rural": 80, "NL:motorway": 100, "NL:trunk": 100, "NL:zone30": 30, "NL:zone60": 60}


def parse_speed(value: str | None) -> int:
    """Parse an OSM maxspeed value to km/h. 0 means unknown."""
    if not value:
        return 0
    v = value.strip()
    if v in _WALK_SPEEDS:
        return 15
    if v in _ZONE_SPEEDS:
        return _ZONE_SPEEDS[v]
    if v.startswith("NL:zone"):
        tail = v[7:]
        if tail.isdigit():
            return int(tail)
    m = _SPEED_RE.match(v)
    if not m:
        return 0
    n = int(m.group(1))
    if m.group(2):
        n = int(round(n * 1.60934))
    return n if 0 < n <= 140 else 0


def is_drivable_way(tags) -> bool:
    """True for public, paved, car-accessible roads worth putting in the graph."""
    if tags.get("highway") not in DRIVABLE_SET:
        return False
    if tags.get("area") == "yes":
        return False
    mv = tags.get("motorcar") or tags.get("motor_vehicle") or tags.get("vehicle")
    if mv in {"no", "private", "agricultural", "forestry", "destination"}:
        return False
    acc = tags.get("access")
    if acc in {"no", "private", "agricultural", "forestry", "destination", "customers"}:
        # An explicit motor_vehicle permission overrides a blanket access restriction.
        if mv not in {"yes", "permissive", "designated"}:
            return False
    if tags.get("surface") in EXCLUDED_SURFACES:
        return False
    if tags.get("smoothness") in {"very_bad", "horrible", "very_horrible", "impassable"}:
        return False
    return allowed_windows(tags) != 0


def oneway_allowed(tags, highway: str) -> tuple[bool, bool]:
    """Return (forward_allowed, backward_allowed) for motor traffic."""
    ow = tags.get("oneway")
    roundabout = tags.get("junction") in {"roundabout", "circular"}
    if ow is None and (roundabout or highway in {"motorway", "motorway_link"}):
        ow = "yes"
    if tags.get("oneway:motor_vehicle") is not None:
        ow = tags.get("oneway:motor_vehicle")
    if ow in {"-1", "reverse"}:
        return False, True
    if ow in {"yes", "true", "1"}:
        return True, False
    if tags.get("motor_vehicle:backward") == "no":
        return True, False
    if tags.get("motor_vehicle:forward") == "no":
        return False, True
    return True, True


# ---------------------------------------------------------------------------
# Pass A: junctions and bicycle routes
# ---------------------------------------------------------------------------


def pass_a(pbf: Path) -> tuple[np.ndarray, np.ndarray]:
    """Return (sorted junction node ids, sorted bicycle-route way ids)."""
    refs = array("q")
    bike_ways = array("q")
    n_ways = 0
    fp = osmium.FileProcessor(pbf).with_filter(osm_filter.KeyFilter("highway", "route"))
    for obj in fp:
        kind = obj.type_str()
        if kind == "w":
            if not is_drivable_way(obj.tags):
                continue
            n_ways += 1
            for nd in obj.nodes:
                refs.append(nd.ref)
            if n_ways % 400_000 == 0:
                log.info("pass A: %d drivable ways", n_ways)
        elif kind == "r":
            tags = obj.tags
            if tags.get("type") == "route" and tags.get("route") in {"bicycle", "mtb"}:
                for m in obj.members:
                    if m.type == "w":
                        bike_ways.append(m.ref)
    refs_np = np.frombuffer(refs, dtype=np.int64)
    uniq, counts = np.unique(refs_np, return_counts=True)
    junctions = uniq[counts >= 2]
    bike_np = np.unique(np.frombuffer(bike_ways, dtype=np.int64)) if len(bike_ways) else np.zeros(0, np.int64)
    log.info(
        "pass A done: %d drivable ways, %d unique nodes, %d junctions, %d bicycle-route ways",
        n_ways, len(uniq), len(junctions), len(bike_np),
    )
    return junctions, bike_np


# ---------------------------------------------------------------------------
# Pass B: directed edges, point layer, scenic rings
# ---------------------------------------------------------------------------


class Builder:
    def __init__(self, pbf: Path, junctions: np.ndarray, bbox: tuple[float, float, float, float] | None):
        self.pbf = pbf
        self.junctions = junctions
        self.bbox = bbox
        self.tf = Transformer.from_crs("EPSG:4326", projected_crs(), always_xy=True)

        self.e_u = array("q")          # OSM node id of the edge start (driving direction)
        self.e_v = array("q")
        self.e_g0 = array("q")         # geometry slice [g0, g1) in coord_x/coord_y, forward order
        self.e_g1 = array("q")
        self.e_rev = array("b")        # 1 = drive the stored geometry backwards
        self.e_len = array("f")
        self.e_hw = array("B")
        self.e_max = array("B")
        self.e_adv = array("B")
        self.e_surf = array("B")
        self.e_smooth = array("B")
        self.e_width = array("f")
        self.e_lanes = array("B")
        self.e_flags = array("B")
        self.e_way = array("q")
        self.e_name = array("i")
        self.e_ref = array("i")
        self.e_calm = array("B")       # traffic calming tagged on the way itself
        self.e_access = array("B")     # legal sampled departure windows (access.WINDOWS)

        self.coord_x = array("f")
        self.coord_y = array("f")

        self.names: list[str] = [""]
        self._name_idx: dict[str, int] = {"": 0}
        self.refs: list[str] = [""]
        self._ref_idx: dict[str, int] = {"": 0}

        self.pt_kind = array("B")
        self.pt_x = array("f")
        self.pt_y = array("f")
        self.pt_name = array("i")

        self.scenic_x = array("f")
        self.scenic_y = array("f")
        self.scenic_off = array("q")   # end offsets, one per ring
        self.scenic_kind = array("B")  # 1 forest/wood, 2 heath/dune/sand, 3 water, 4 park/reserve, 5 other green

        self.n_ways_seen = 0

    # -- string tables -----------------------------------------------------

    def name_index(self, name: str | None) -> int:
        if not name:
            return 0
        i = self._name_idx.get(name)
        if i is None:
            i = len(self.names)
            self._name_idx[name] = i
            self.names.append(name)
        return i

    def ref_index(self, ref: str | None) -> int:
        if not ref:
            return 0
        i = self._ref_idx.get(ref)
        if i is None:
            i = len(self.refs)
            self._ref_idx[ref] = i
            self.refs.append(ref)
        return i

    # -- bbox helper -------------------------------------------------------

    def in_bbox(self, lon: float, lat: float) -> bool:
        if self.bbox is None:
            return True
        bl, bb, br, bt = self.bbox
        return bl <= lon <= br and bb <= lat <= bt

    # -- nodes -------------------------------------------------------------

    def handle_node(self, n) -> None:
        tags = n.tags
        hw = tags.get("highway")
        name = tags.get("name")
        if hw in CALMING_HIGHWAY or tags.get("traffic_calming") not in (None, "no"):
            kind = PT_BUMP
        elif hw in {"traffic_signals", "stop", "give_way", "mini_roundabout"}:
            kind = PT_CONTROL
        elif hw == "speed_camera" or tags.get("enforcement") == "maxspeed":
            kind = PT_CAMERA
        elif tags.get("railway") == "level_crossing":
            kind = PT_CROSSING
        elif tags.get("amenity") in COFFEE_AMENITY:
            kind = PT_COFFEE
            name = name or tags.get("amenity")
        elif tags.get("amenity") == "fuel":
            kind = PT_FUEL
        elif tags.get("tourism") in VIEW_TOURISM or tags.get("natural") == "peak":
            kind = PT_VIEW
            name = name or tags.get("tourism")
        elif tags.get("place") in PLACE_KINDS and name:
            kind = PT_PLACE
        else:
            return
        loc = n.location
        if not loc.valid() or not self.in_bbox(loc.lon, loc.lat):
            return
        x, y = self.tf.transform(loc.lon, loc.lat)
        self.pt_kind.append(kind)
        self.pt_x.append(x)
        self.pt_y.append(y)
        self.pt_name.append(self.name_index(name))

    # -- non-drivable ways: scenic areas and area POIs ---------------------

    def handle_other_way(self, w, tags) -> None:
        natural = tags.get("natural")
        landuse = tags.get("landuse")
        leisure = tags.get("leisure")
        water = tags.get("water") or tags.get("waterway")
        if natural in SCENIC_NATURAL:
            kind = 1 if natural in {"wood", "scrub", "grassland"} else (
                3 if natural in {"water", "bay", "wetland"} else 2)
        elif landuse in SCENIC_LANDUSE:
            kind = 1 if landuse in {"forest", "orchard", "vineyard"} else 5
        elif leisure in SCENIC_LEISURE:
            kind = 4
        elif water in SCENIC_WATER:
            kind = 3
        elif tags.get("amenity") in COFFEE_AMENITY or tags.get("tourism") in VIEW_TOURISM:
            self._area_poi(w, tags)
            return
        else:
            return
        nodes = list(w.nodes)
        if len(nodes) < 4 or nodes[0].ref != nodes[-1].ref:
            return  # only closed rings; multipolygon relations are out of scope
        lons = np.fromiter((nd.lon for nd in nodes if nd.location.valid()), dtype=np.float64)
        lats = np.fromiter((nd.lat for nd in nodes if nd.location.valid()), dtype=np.float64)
        if len(lons) < 4:
            return
        if self.bbox is not None:
            bl, bb, br, bt = self.bbox
            if lons.min() > br or lons.max() < bl or lats.min() > bt or lats.max() < bb:
                return
        xs, ys = self.tf.transform(lons, lats)
        # Skip tiny patches: they cannot change the scenery share of a road.
        if (xs.max() - xs.min()) < 60 and (ys.max() - ys.min()) < 60:
            return
        self.scenic_x.extend(xs.astype(np.float32).tolist())
        self.scenic_y.extend(ys.astype(np.float32).tolist())
        self.scenic_off.append(len(self.scenic_x))
        self.scenic_kind.append(kind)

    def _area_poi(self, w, tags) -> None:
        nodes = [nd for nd in w.nodes if nd.location.valid()]
        if len(nodes) < 3:
            return
        lon = sum(nd.lon for nd in nodes) / len(nodes)
        lat = sum(nd.lat for nd in nodes) / len(nodes)
        if not self.in_bbox(lon, lat):
            return
        x, y = self.tf.transform(lon, lat)
        self.pt_kind.append(PT_COFFEE if tags.get("amenity") in COFFEE_AMENITY else PT_VIEW)
        self.pt_x.append(x)
        self.pt_y.append(y)
        self.pt_name.append(self.name_index(tags.get("name") or tags.get("amenity") or tags.get("tourism")))

    # -- drivable ways -----------------------------------------------------

    def handle_road(self, w, tags) -> None:
        nodes = [nd for nd in w.nodes if nd.location.valid()]
        if len(nodes) < 2:
            return
        lons = np.fromiter((nd.lon for nd in nodes), dtype=np.float64, count=len(nodes))
        lats = np.fromiter((nd.lat for nd in nodes), dtype=np.float64, count=len(nodes))
        if self.bbox is not None:
            bl, bb, br, bt = self.bbox
            inside = (lons >= bl) & (lons <= br) & (lats >= bb) & (lats <= bt)
            if not inside.any():
                return
        refs = np.fromiter((nd.ref for nd in nodes), dtype=np.int64, count=len(nodes))

        # Junction membership per node, vectorised against the sorted id array.
        if len(self.junctions):
            pos = np.searchsorted(self.junctions, refs)
            np.clip(pos, 0, len(self.junctions) - 1, out=pos)
            is_junction = self.junctions[pos] == refs
        else:
            is_junction = np.zeros(len(refs), dtype=bool)
        is_junction = is_junction.copy()
        is_junction[0] = True
        is_junction[-1] = True

        xs, ys = self.tf.transform(lons, lats)
        highway = tags.get("highway")
        hw_code = HIGHWAY_CODES[highway]
        ms = parse_speed(tags.get("maxspeed"))
        ms_fwd = parse_speed(tags.get("maxspeed:forward")) or ms
        ms_bwd = parse_speed(tags.get("maxspeed:backward")) or ms
        adv = parse_speed(tags.get("maxspeed:advisory")) or parse_speed(tags.get("maxspeed:advisory:forward"))
        surf = SURFACE_CODES.get(tags.get("surface", ""), 0)
        smooth = SMOOTHNESS_CODES.get(tags.get("smoothness", ""), 0)
        try:
            width = float(str(tags.get("width", "0")).split()[0] or 0)
        except (ValueError, IndexError):
            width = 0.0
        try:
            lanes = min(int(tags.get("lanes", "0") or 0), 255)
        except ValueError:
            lanes = 0
        flags = 0
        if tags.get("bridge") not in (None, "no") or tags.get("man_made") == "bridge":
            flags |= F_BRIDGE
        if tags.get("tunnel") not in (None, "no") or tags.get("covered") == "yes":
            flags |= F_TUNNEL
        if highway in MOTORWAY_LIKE:
            flags |= F_MOTORWAY
        if highway in LINK_LIKE:
            flags |= F_LINK
        if tags.get("junction") in {"roundabout", "circular"}:
            flags |= F_ROUNDABOUT
        name_idx = self.name_index(tags.get("name"))
        ref_idx = self.ref_index(tags.get("ref"))
        calm = 1 if tags.get("traffic_calming") not in (None, "no") else 0
        fwd_ok, bwd_ok = oneway_allowed(tags, highway)
        if not (fwd_ok or bwd_ok):
            return

        cut_points = np.flatnonzero(is_junction)
        prev = int(cut_points[0])
        for cut in cut_points[1:]:
            i0, i1 = prev, int(cut)
            prev = i1
            seg_x = xs[i0 : i1 + 1]
            seg_y = ys[i0 : i1 + 1]
            length = float(np.hypot(np.diff(seg_x), np.diff(seg_y)).sum())
            if length < 1.0:
                continue
            g0 = len(self.coord_x)
            self.coord_x.extend(seg_x.astype(np.float32).tolist())
            self.coord_y.extend(seg_y.astype(np.float32).tolist())
            g1 = len(self.coord_x)
            u, v = int(refs[i0]), int(refs[i1])
            common = (g0, g1, length, hw_code, adv, surf, smooth, width, lanes, flags,
                      w.id, name_idx, ref_idx, calm, allowed_windows(tags))
            if fwd_ok:
                self._emit(u, v, 0, ms_fwd, common)
            if bwd_ok:
                self._emit(v, u, 1, ms_bwd, common)

    def _emit(self, u: int, v: int, rev: int, maxspeed: int, common: tuple) -> None:
        (g0, g1, length, hw_code, adv, surf, smooth, width, lanes, flags,
         way_id, name_idx, ref_idx, calm, access) = common
        self.e_u.append(u)
        self.e_v.append(v)
        self.e_g0.append(g0)
        self.e_g1.append(g1)
        self.e_rev.append(rev)
        self.e_len.append(length)
        self.e_hw.append(hw_code)
        self.e_max.append(min(maxspeed, 255))
        self.e_adv.append(min(adv, 255))
        self.e_surf.append(surf)
        self.e_smooth.append(smooth)
        self.e_width.append(width)
        self.e_lanes.append(lanes)
        self.e_flags.append(flags)
        self.e_way.append(way_id)
        self.e_name.append(name_idx)
        self.e_ref.append(ref_idx)
        self.e_calm.append(calm)
        self.e_access.append(access)

    # -- driver ------------------------------------------------------------

    def run(self) -> None:
        keys = ("highway", "amenity", "place", "tourism", "railway", "traffic_calming",
                "landuse", "natural", "leisure", "water", "waterway", "enforcement")
        fp = (
            osmium.FileProcessor(self.pbf)
            .with_locations()
            .with_filter(osm_filter.KeyFilter(*keys))
        )
        for obj in fp:
            kind = obj.type_str()
            if kind == "n":
                self.handle_node(obj)
            elif kind == "w":
                self.n_ways_seen += 1
                if self.n_ways_seen % 1_000_000 == 0:
                    log.info("pass B: %d ways scanned, %d edges", self.n_ways_seen, len(self.e_u))
                tags = obj.tags
                if tags.get("highway") in DRIVABLE_SET and is_drivable_way(tags):
                    self.handle_road(obj, tags)
                else:
                    self.handle_other_way(obj, tags)
        log.info(
            "pass B done: %d directed edges, %d points, %d scenic rings",
            len(self.e_u), len(self.pt_kind), len(self.scenic_kind),
        )


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def build(pbf: Path, bbox: tuple[float, float, float, float] | None = None) -> tuple[dict, dict]:
    junctions, bike_ways = pass_a(pbf)
    b = Builder(pbf, junctions, bbox)
    b.run()
    if not len(b.e_u):
        raise RuntimeError("no drivable edges produced; check the bbox or the input file")

    e_u_ref = np.frombuffer(b.e_u, dtype=np.int64)
    e_v_ref = np.frombuffer(b.e_v, dtype=np.int64)
    node_ids = np.unique(np.concatenate([e_u_ref, e_v_ref]))
    edge_u = np.searchsorted(node_ids, e_u_ref).astype(np.int32)
    edge_v = np.searchsorted(node_ids, e_v_ref).astype(np.int32)

    coord_x = np.frombuffer(b.coord_x, dtype=np.float32)
    coord_y = np.frombuffer(b.coord_y, dtype=np.float32)
    e_g0 = np.frombuffer(b.e_g0, dtype=np.int64)
    e_g1 = np.frombuffer(b.e_g1, dtype=np.int64)
    e_rev = np.frombuffer(b.e_rev, dtype=np.int8).astype(np.uint8)

    # Node coordinates: take them from the geometry end that matches the node,
    # accounting for edges that drive the shared geometry backwards.
    rev_bool = e_rev.astype(bool)
    start_i = np.where(rev_bool, e_g1 - 1, e_g0)
    end_i = np.where(rev_bool, e_g0, e_g1 - 1)
    node_x = np.zeros(len(node_ids), dtype=np.float32)
    node_y = np.zeros(len(node_ids), dtype=np.float32)
    node_x[edge_u] = coord_x[start_i]
    node_y[edge_u] = coord_y[start_i]
    node_x[edge_v] = coord_x[end_i]
    node_y[edge_v] = coord_y[end_i]

    e_way = np.frombuffer(b.e_way, dtype=np.int64)
    edge_bike = np.isin(e_way, bike_ways).astype(np.uint8) if len(bike_ways) else np.zeros(len(e_way), np.uint8)

    npz = {
        "node_ids": node_ids,
        "node_x": node_x,
        "node_y": node_y,
        "edge_u": edge_u,
        "edge_v": edge_v,
        "edge_g0": e_g0,
        "edge_g1": e_g1,
        "edge_rev": e_rev,
        "edge_len": np.frombuffer(b.e_len, dtype=np.float32),
        "edge_highway": np.frombuffer(b.e_hw, dtype=np.uint8),
        "edge_maxspeed": np.frombuffer(b.e_max, dtype=np.uint8),
        "edge_advisory": np.frombuffer(b.e_adv, dtype=np.uint8),
        "edge_surface": np.frombuffer(b.e_surf, dtype=np.uint8),
        "edge_smooth": np.frombuffer(b.e_smooth, dtype=np.uint8),
        "edge_width": np.frombuffer(b.e_width, dtype=np.float32),
        "edge_lanes": np.frombuffer(b.e_lanes, dtype=np.uint8),
        "edge_flags": np.frombuffer(b.e_flags, dtype=np.uint8),
        "edge_way": e_way,
        "edge_name": np.frombuffer(b.e_name, dtype=np.int32),
        "edge_ref": np.frombuffer(b.e_ref, dtype=np.int32),
        "edge_calm": np.frombuffer(b.e_calm, dtype=np.uint8),
        "edge_access": np.frombuffer(b.e_access, dtype=np.uint8),
        "edge_bike": edge_bike,
        "coord_x": coord_x,
        "coord_y": coord_y,
        "pt_kind": np.frombuffer(b.pt_kind, dtype=np.uint8),
        "pt_x": np.frombuffer(b.pt_x, dtype=np.float32),
        "pt_y": np.frombuffer(b.pt_y, dtype=np.float32),
        "pt_name": np.frombuffer(b.pt_name, dtype=np.int32),
        "scenic_x": np.frombuffer(b.scenic_x, dtype=np.float32),
        "scenic_y": np.frombuffer(b.scenic_y, dtype=np.float32),
        "scenic_off": np.frombuffer(b.scenic_off, dtype=np.int64),
        "scenic_kind": np.frombuffer(b.scenic_kind, dtype=np.uint8),
    }
    side = {"names": b.names, "refs": b.refs, "highway_codes": HIGHWAY_CODES}
    return npz, side


def save(npz: dict, side: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    np.savez(out_dir / "graph.npz", **npz)
    with open(out_dir / "graph_side.json", "w", encoding="utf-8") as f:
        json.dump(side, f, ensure_ascii=False)
    log.info("saved graph to %s", out_dir)


def cache_dir(bbox=None) -> Path:
    p = ensure_dirs()
    return p.cache / ("graph_bbox" if bbox else "graph")


def load(bbox=None) -> tuple[dict, dict]:
    d = cache_dir(bbox)
    with np.load(d / "graph.npz") as z:
        npz = {k: z[k] for k in z.files}
    with open(d / "graph_side.json", "r", encoding="utf-8") as f:
        side = json.load(f)
    return npz, side


def run(bbox: tuple[float, float, float, float] | None = None) -> None:
    p = ensure_dirs()
    pbf = p.raw / "netherlands-latest.osm.pbf"
    if not pbf.exists():
        raise FileNotFoundError(f"{pbf} missing - run the fetch step first")
    npz, side = build(pbf, bbox)
    save(npz, side, cache_dir(bbox))
    log.info(
        "graph ready: %d nodes, %d directed edges, %d geometry points",
        len(npz["node_ids"]), len(npz["edge_u"]), len(npz["coord_x"]),
    )


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
