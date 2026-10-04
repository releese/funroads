"""Turn the raw graph into the per-edge features the rubric scores.

What this step produces, per directed edge:
  corner geometry   counts per radius band, engaged corners, turn per km,
                    esses share, straight share, and the corner list itself
  elevation         climb, descent and maximum sustained grade
  scenery           share of the road that runs through or beside forest,
                    heath, dune, park or water
  hazards           speed bumps and plateaus on the carriageway, speed cameras
  plus              legal speed, advisory speed and busyness, merged from the
                    speed-matching and busyness steps when they have been run

Geometry work happens once per undirected segment. The reverse direction is a
mirror: corner positions flip to `length - s` and the left/right sign inverts,
which keeps the two directions consistent without doing the maths twice.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np

from . import busyness as busyness_mod
from . import geom
from . import graph as graph_mod
from .config import ensure_dirs, load_rubric

log = logging.getLogger("funroads.features")

SAMPLE_STEP_M = 10.0
BUMP_SNAP_M = 4.0        # a traffic calming node sits on the centreline
CAMERA_SNAP_M = 20.0     # a camera stands beside the road
SCENIC_MIN_AREA = 10_000.0   # ignore scenic patches below 1 hectare
SCENIC_BUFFER_M = 40.0       # a road counts as scenic when scenery is this close

# Radius bands, in metres, and how much a corner in each band counts towards
# "this road is fun". The sweet spot is a third-gear corner in a 997.
BANDS = (
    ("hairpin", 0.0, 30.0, 0.7),
    ("sweet", 30.0, 150.0, 1.0),
    ("flowing", 150.0, 300.0, 0.6),
    ("sweep", 300.0, 600.0, 0.2),
)

# Fallback legal limits by road class, used only when neither the official
# speed database nor an OSM tag gives a value.
CLASS_DEFAULT_SPEED = {
    "motorway": 100, "motorway_link": 80, "trunk": 100, "trunk_link": 80,
    "primary": 80, "primary_link": 60, "secondary": 80, "secondary_link": 60,
    "tertiary": 60, "tertiary_link": 50, "unclassified": 60, "road": 50,
    "residential": 30, "living_street": 15,
}


def _corner_arrays(npz: dict, rubric: dict) -> dict[str, np.ndarray]:
    """Run the corner model over every undirected segment and mirror it."""
    cm = rubric.get("corner_model", {})
    step = float(cm.get("sample_step_m", SAMPLE_STEP_M))
    a_lat = float(cm.get("a_lat_comfort", 0.45))

    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    rev = npz["edge_rev"]
    cx, cy = npz["coord_x"], npz["coord_y"]
    n_edges = len(g0)

    # One representative edge per distinct geometry slice: the forward direction
    # if it exists, otherwise the reverse-only edge.
    order = np.lexsort((rev, g0))
    first_of_slice = np.ones(n_edges, dtype=bool)
    first_of_slice[1:] = g0[order][1:] != g0[order][:-1]
    rep_edges = order[first_of_slice]
    # Map every edge to its representative.
    slice_to_rep = {}
    for e in rep_edges:
        slice_to_rep[int(g0[e])] = int(e)

    per_edge: dict[int, geom.Corners] = {}
    t0 = time.time()
    for n_done, e in enumerate(rep_edges, 1):
        a, b = int(g0[e]), int(g1[e])
        xs, ys, s = geom.resample(cx[a:b], cy[a:b], step=step)
        per_edge[int(e)] = geom.detect_corners(xs, ys, s)
        if n_done % 200_000 == 0:
            log.info("corners: %d / %d segments (%.0fs)", n_done, len(rep_edges), time.time() - t0)
    log.info("corners: %d segments in %.0fs", len(rep_edges), time.time() - t0)

    # Flatten per directed edge, mirroring the reverse direction.
    c_edge, c_s, c_r, c_sign, c_head = [], [], [], [], []
    for e in range(n_edges):
        rep = slice_to_rep[int(g0[e])]
        c = per_edge[rep]
        if not len(c):
            continue
        length = float(npz["edge_len"][e])
        rep_rev = int(rev[rep])
        if int(rev[e]) == rep_rev:
            s_vals = c.s
            signs = c.sign
        else:
            s_vals = length - c.s
            signs = (-c.sign).astype(np.int8)
        order_s = np.argsort(s_vals, kind="stable")
        c_edge.append(np.full(len(c), e, dtype=np.int32))
        c_s.append(s_vals[order_s].astype(np.float32))
        c_r.append(c.radius[order_s].astype(np.float32))
        c_sign.append(signs[order_s])
        c_head.append(c.heading[order_s].astype(np.float32))

    def cat(parts, dtype):
        return np.concatenate(parts).astype(dtype) if parts else np.zeros(0, dtype)

    return {
        "corner_edge": cat(c_edge, np.int32),
        "corner_s": cat(c_s, np.float32),
        "corner_r": cat(c_r, np.float32),
        "corner_sign": cat(c_sign, np.int8),
        "corner_head": cat(c_head, np.float32),
        "_a_lat": np.float32(a_lat),
    }


def _aggregate_corners(npz: dict, corners: dict, legal: np.ndarray, a_lat: float) -> dict[str, np.ndarray]:
    """Per-edge corner statistics, including how many corners actually engage."""
    n = len(npz["edge_u"])
    ce = corners["corner_edge"]
    cr = corners["corner_r"]
    ch = corners["corner_head"]
    cs = corners["corner_s"]
    csign = corners["corner_sign"]
    length_km = np.maximum(npz["edge_len"].astype(np.float64) / 1000.0, 1e-4)

    v_corner = np.asarray(geom.corner_speed(cr, a_lat=a_lat), dtype=np.float32)
    # A corner engages when the comfortable speed through it is below the limit,
    # so you have to brake and steer instead of holding the limit.
    limit_at_corner = legal[ce].astype(np.float32)
    engaged = v_corner < (limit_at_corner - 3.0)

    weight = np.zeros(len(cr), dtype=np.float32)
    counts = {}
    for name, lo, hi, w in BANDS:
        in_band = (cr >= lo) & (cr < hi)
        weight[in_band] = w
        counts[f"n_{name}"] = np.bincount(ce[in_band], minlength=n).astype(np.int32)

    out = dict(counts)
    out["n_corners"] = np.bincount(ce, minlength=n).astype(np.int32)
    out["n_engaged"] = np.bincount(ce[engaged], minlength=n).astype(np.int32)
    out["corner_weight"] = np.bincount(ce, weights=weight, minlength=n).astype(np.float32)
    out["engaged_weight"] = np.bincount(
        ce[engaged], weights=weight[engaged], minlength=n
    ).astype(np.float32)
    out["engaged_per_km"] = (out["engaged_weight"] / length_km).astype(np.float32)
    out["head_per_km"] = (
        np.bincount(ce, weights=ch.astype(np.float64), minlength=n) / length_km
    ).astype(np.float32)
    out["min_radius"] = np.full(n, np.inf, dtype=np.float32)
    np.minimum.at(out["min_radius"], ce, cr)
    out["corner_v"] = v_corner
    out["corner_engaged"] = engaged.astype(np.uint8)

    # Esses and straight share need the corner sequence of each edge.
    esses = np.zeros(n, dtype=np.float32)
    straights = np.zeros(n, dtype=np.float32)
    order = np.argsort(ce, kind="stable")
    ce_s = ce[order]
    bounds = np.searchsorted(ce_s, np.arange(n + 1))
    lengths = npz["edge_len"].astype(np.float64)
    for e in range(n):
        lo, hi = bounds[e], bounds[e + 1]
        idx = order[lo:hi]
        if not len(idx):
            straights[e] = geom.straight_share(
                lengths[e], geom.Corners(np.zeros(0), np.zeros(0), np.zeros(0, np.int8), np.zeros(0), np.zeros(0))
            )
            continue
        c = geom.Corners(
            s=cs[idx].astype(np.float64),
            radius=cr[idx].astype(np.float64),
            sign=csign[idx],
            heading=ch[idx].astype(np.float64),
            # Approximate arc length from turn and radius: L = R * theta.
            length=np.radians(ch[idx].astype(np.float64)) * cr[idx].astype(np.float64),
        )
        esses[e] = geom.esses_share(c)
        straights[e] = geom.straight_share(lengths[e], c)
    out["esses"] = esses
    out["straight_share"] = straights
    return out


def _legal_speed(npz: dict, side: dict, cache: Path, bbox) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Legal limit, advisory speed and source, preferring the official database."""
    n = len(npz["edge_u"])
    hw_names = {v: k for k, v in side["highway_codes"].items()}
    legal = np.zeros(n, dtype=np.uint8)
    source = np.zeros(n, dtype=np.uint8)
    advisory = npz["edge_advisory"].copy()

    speeds_path = cache / ("speeds_bbox.npz" if bbox else "speeds.npz")
    if speeds_path.exists():
        with np.load(speeds_path) as z:
            if len(z["legal_speed"]) == n:
                legal = z["legal_speed"].astype(np.uint8)
                source = z["speed_source"].astype(np.uint8)
                if "advisory" in z.files:
                    adv = z["advisory"].astype(np.uint8)
                    advisory = np.where(advisory > 0, advisory, adv).astype(np.uint8)
                log.info("legal speeds from %s", speeds_path.name)
            else:
                log.warning("%s has %d rows, graph has %d: ignoring",
                            speeds_path.name, len(z["legal_speed"]), n)
    if not legal.any():
        log.info("speed matching not available; using OSM tags with class defaults")

    osm = npz["edge_maxspeed"].astype(np.uint8)
    take_osm = (legal == 0) & (osm > 0)
    legal[take_osm] = osm[take_osm]
    source[take_osm] = 1
    still = legal == 0
    if still.any():
        defaults = np.zeros(n, dtype=np.uint8)
        for code, name in hw_names.items():
            defaults[npz["edge_highway"] == code] = CLASS_DEFAULT_SPEED.get(name, 50)
        legal[still] = defaults[still]
        source[still] = 3
    return legal, advisory, source


def _scenery_share(npz: dict) -> np.ndarray:
    """Share of sample points on each edge that sit in or beside scenery."""
    import shapely

    off = npz["scenic_off"]
    if not len(off):
        return np.zeros(len(npz["edge_u"]), dtype=np.float32)
    starts = np.concatenate([[0], off[:-1]])
    sx, sy = npz["scenic_x"].astype(np.float64), npz["scenic_y"].astype(np.float64)
    rings = []
    for a, b in zip(starts, off):
        if b - a < 4:
            continue
        rings.append((int(a), int(b)))
    log.info("scenery: building %d polygons", len(rings))
    polys = []
    for a, b in rings:
        coords = np.column_stack([sx[a:b], sy[a:b]])
        # Drop patches too small to change how a drive feels.
        w = coords[:, 0].max() - coords[:, 0].min()
        h = coords[:, 1].max() - coords[:, 1].min()
        if w * h < SCENIC_MIN_AREA:
            continue
        polys.append(shapely.polygons(coords))
    if not polys:
        return np.zeros(len(npz["edge_u"]), dtype=np.float32)
    polys = np.asarray(polys, dtype=object)
    tree = shapely.STRtree(polys)

    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    cx, cy = npz["coord_x"], npz["coord_y"]
    # Three probes per edge: a quarter, the middle and three quarters along.
    fr = np.array([0.25, 0.5, 0.75])
    n = len(g0)
    hits = np.zeros(n, dtype=np.float32)
    for f in fr:
        idx = (g0 + np.floor((g1 - g0 - 1) * f)).astype(np.int64)
        pts = shapely.points(cx[idx].astype(np.float64), cy[idx].astype(np.float64))
        # A road just outside a wood still feels like a forest road, hence the
        # small buffer via dwithin rather than a strict containment test.
        pairs = tree.query(pts, predicate="dwithin", distance=SCENIC_BUFFER_M)
        if pairs.size:
            hits[np.unique(pairs[0])] += 1.0
    return (hits / len(fr)).astype(np.float32)


def _hazards(npz: dict) -> dict[str, np.ndarray]:
    """Speed bumps on the carriageway and cameras beside it, per edge."""
    import shapely

    n = len(npz["edge_u"])
    geoms, slice_edges = edge_geometries(npz)
    tree = shapely.STRtree(geoms)

    out = {}
    for name, kinds, snap in (
        ("bumps", (graph_mod.PT_BUMP,), BUMP_SNAP_M),
        ("cameras", (graph_mod.PT_CAMERA,), CAMERA_SNAP_M),
        ("controls", (graph_mod.PT_CONTROL, graph_mod.PT_CROSSING), BUMP_SNAP_M),
    ):
        mask = np.isin(npz["pt_kind"], np.asarray(kinds, dtype=np.uint8))
        acc = np.zeros(n, dtype=np.int32)
        if mask.any():
            pts = shapely.points(npz["pt_x"][mask].astype(np.float64), npz["pt_y"][mask].astype(np.float64))
            pairs = tree.query(pts, predicate="dwithin", distance=snap)
            if pairs.size:
                # A hazard on a segment applies to both driving directions.
                for slot in pairs[1]:
                    for e in slice_edges[slot]:
                        acc[e] += 1
        out[name] = acc
        log.info("hazards: %s matched to %d edges", name, int((acc > 0).sum()))
    return out


def edge_geometries(npz: dict) -> tuple[np.ndarray, list[list[int]]]:
    """Shapely linestrings, one per undirected segment, plus their edge indices.

    Both driving directions share a geometry slice, so building one linestring
    per slice halves the work and the memory of every spatial query.
    """
    import shapely

    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    cx, cy = npz["coord_x"], npz["coord_y"]
    slots: dict[int, int] = {}
    slice_edges: list[list[int]] = []
    parts: list[np.ndarray] = []
    for e in range(len(g0)):
        a, b = int(g0[e]), int(g1[e])
        if b - a < 2:
            continue
        slot = slots.get(a)
        if slot is None:
            slot = len(parts)
            slots[a] = slot
            parts.append(np.column_stack([cx[a:b].astype(np.float64), cy[a:b].astype(np.float64)]))
            slice_edges.append([])
        slice_edges[slot].append(e)
    sizes = np.fromiter((len(pp) for pp in parts), dtype=np.int64, count=len(parts))
    coords = np.vstack(parts)
    indices = np.repeat(np.arange(len(parts)), sizes)
    return shapely.linestrings(coords, indices=indices), slice_edges


def _elevation(npz: dict, bbox) -> dict[str, np.ndarray]:
    """Climb, descent and maximum grade per edge, from the AHN ground model."""
    n = len(npz["edge_u"])
    zeros = {
        "climb_m": np.zeros(n, np.float32),
        "descent_m": np.zeros(n, np.float32),
        "max_grade": np.zeros(n, np.float32),
        "elev_start": np.full(n, np.nan, np.float32),
        "elev_ok": np.zeros(n, np.uint8),
    }
    try:
        from . import elevation as elev_mod
    except ImportError:
        log.warning("elevation module not available; elevation features are zero")
        return zeros
    sampler = elev_mod.Sampler()

    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    cx, cy = npz["coord_x"], npz["coord_y"]
    flags = npz["edge_flags"]
    out = {k: v.copy() for k, v in zeros.items()}

    # Resample every segment once and sample the whole country in one call, so
    # the sampler can group points by tile instead of paying per-edge overhead.
    reps: list[int] = []
    seen: set[int] = set()
    xs_parts, ys_parts, s_parts = [], [], []
    for e in range(n):
        a = int(g0[e])
        if a in seen:
            continue
        seen.add(a)
        b = int(g1[e])
        xs, ys, s = geom.resample(cx[a:b], cy[a:b], step=SAMPLE_STEP_M)
        reps.append(e)
        xs_parts.append(xs)
        ys_parts.append(ys)
        s_parts.append(s)
    sizes = np.fromiter((len(v) for v in xs_parts), dtype=np.int64, count=len(xs_parts))
    bounds = np.concatenate([[0], np.cumsum(sizes)])
    all_x = np.concatenate(xs_parts)
    all_y = np.concatenate(ys_parts)
    log.info("elevation: sampling %d points over %d segments", len(all_x), len(reps))
    t0 = time.time()
    sampler.prefetch(all_x, all_y)
    all_z = sampler.sample(all_x, all_y)
    log.info("elevation: sampled in %.0fs, stats %s", time.time() - t0, sampler.stats)

    for i, e in enumerate(reps):
        lo, hi = int(bounds[i]), int(bounds[i + 1])
        z = all_z[lo:hi]
        if not np.isfinite(z).any():
            continue
        s = s_parts[i]
        z = elev_mod.fix_bridges(
            s, z, bool(flags[e] & graph_mod.F_BRIDGE), bool(flags[e] & graph_mod.F_TUNNEL)
        )
        climb, descent, grade = geom.elevation_stats(s, z)
        out["climb_m"][e] = climb
        out["descent_m"][e] = descent
        out["max_grade"][e] = grade
        out["elev_start"][e] = float(np.nanmin(z))
        out["elev_ok"][e] = 1

    # Mirror onto the other direction of each segment: climb and descent swap.
    rep_of_slice = {int(g0[e]): e for e in reps}
    for e in range(n):
        src = rep_of_slice.get(int(g0[e]))
        if src is None or src == e:
            continue
        same_dir = npz["edge_rev"][e] == npz["edge_rev"][src]
        out["climb_m"][e] = out["climb_m"][src] if same_dir else out["descent_m"][src]
        out["descent_m"][e] = out["descent_m"][src] if same_dir else out["climb_m"][src]
        out["max_grade"][e] = out["max_grade"][src]
        out["elev_start"][e] = out["elev_start"][src]
        out["elev_ok"][e] = out["elev_ok"][src]
    log.info("elevation: %.0f%% of edges covered", 100.0 * float(out["elev_ok"].mean()))
    return out


def compute(npz: dict, side: dict, bbox=None) -> dict[str, np.ndarray]:
    rubric = load_rubric()
    p = ensure_dirs()
    out: dict[str, np.ndarray] = {}

    corners = _corner_arrays(npz, rubric)
    a_lat = float(corners.pop("_a_lat"))
    legal, advisory, source = _legal_speed(npz, side, p.cache, bbox)
    out["legal_speed"] = legal
    out["advisory"] = advisory
    out["speed_source"] = source

    out.update(corners)
    out.update(_aggregate_corners(npz, corners, legal, a_lat))
    out["scenery"] = _scenery_share(npz)
    out.update(_hazards(npz))
    out.update(_elevation(npz, bbox))

    busy_path = p.cache / ("busyness_bbox.npz" if bbox else "busyness.npz")
    if busy_path.exists():
        with np.load(busy_path) as z:
            if len(z["busyness"]) == len(legal):
                for k in z.files:
                    out[k] = z[k]
    else:
        log.info("busyness cache missing; computing it now")
        out.update(busyness_mod.compute(npz, side))

    signs_path = p.cache / ("signs_bbox.npz" if bbox else "signs.npz")
    if signs_path.exists():
        with np.load(signs_path) as z:
            if len(z[z.files[0]]) == len(legal):
                for k in z.files:
                    out[f"sign_{k}" if not k.startswith("sign") else k] = z[k]
                log.info("merged traffic sign features from %s", signs_path.name)
    return out


def run(bbox=None) -> None:
    npz, side = graph_mod.load(bbox)
    out = compute(npz, side, bbox)
    p = ensure_dirs()
    path = p.cache / ("features_bbox.npz" if bbox else "features.npz")
    np.savez(path, **out)
    log.info(
        "features written to %s: %d edges, %d corners, %.1f%% engaged-corner edges",
        path.name, len(npz["edge_u"]), len(out["corner_r"]),
        100.0 * float((out["n_engaged"] > 0).mean()),
    )


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
