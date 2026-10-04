"""Real OSM/Teeregister Estonia national pipeline, using the existing routing model.

No Dutch acquisition, speed defaults, population grid or AHN calls are used.
Barrier/restricted junctions are isolated locally. Complex via-way restrictions
remain excluded: the node-only router does not understand arbitrary turns.
"""
from __future__ import annotations

import json
import hashlib
import logging
import re
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone

import numpy as np
import osmium
import osmium.filter as osm_filter
import requests
import shapely
from pyproj import Transformer

from . import busyness, elevation, features, geom, graph, linked, route, score, teeregister
from .config import ensure_dirs, load_rubric, origins, projected_crs, read_manifest, write_manifest
from .fetch import _fetch, sha256_file, USER_AGENT

log = logging.getLogger(__name__)
BBOX = (20.85, 57.49, 28.22, 60.0)  # Geofabrik estonia.poly bounds, slightly padded
COVERAGE = "Estonia"
OSM_URL = "https://download.geofabrik.de/europe/estonia-latest.osm.pbf"
TERRAIN_WCS = "https://teenus.maaamet.ee/ows/wcs-dtm"
TILE_M = 20000  # national dtm-25 is fetched as grid-aligned 20 km tiles
TERRAIN_LICENSE = "https://geoportaal.maaruum.ee/opendata-licence"
PAVED = {"asphalt", "chipseal", "tarred", "concrete", "paved"}
EE_SPEED_TYPES = {"EE:rural": 90, "EE:urban": 50}


def mapped_speeds(tags) -> tuple[int, int]:
    """Only explicit numeric limits or an explicitly mapped Estonian speed zone."""
    def value(text):
        return int(text) if re.fullmatch(r"\d{1,3}", text or "") and 0 < int(text) <= 130 else EE_SPEED_TYPES.get(text, 0)
    base = value(tags.get("maxspeed"))
    # Do not override an explicit but unrecognised maxspeed with a zone.
    if tags.get("maxspeed") is None:
        base = EE_SPEED_TYPES.get(tags.get("maxspeed:type") or tags.get("source:maxspeed"), 0)
    forward = value(tags.get("maxspeed:forward")) if tags.get("maxspeed:forward") else base
    backward = value(tags.get("maxspeed:backward")) if tags.get("maxspeed:backward") else base
    fwd, back = graph.oneway_allowed(tags, tags.get("highway"))
    return (forward if fwd else backward), (backward if back else forward)


def terrain_tile_url(ix: int, iy: int) -> str:
    x0, y0 = ix * TILE_M, iy * TILE_M
    return (TERRAIN_WCS + "?service=WCS&version=2.0.1&request=GetCoverage&coverageId=dtm-25"
            f"&subset=x%28{x0}%2C{x0 + TILE_M}%29&subset=y%28{y0}%2C{y0 + TILE_M}%29"
            "&format=image%2Ftiff")


def terrain_tiles() -> list[tuple[int, int]]:
    """20 km grid-aligned tile indices intersecting the extraction boundary."""
    region = interior_boundary()
    minx, miny, maxx, maxy = region.bounds
    tiles = []
    for ix in range(int(np.floor(minx / TILE_M)), int(np.floor(maxx / TILE_M)) + 1):
        for iy in range(int(np.floor(miny / TILE_M)), int(np.floor(maxy / TILE_M)) + 1):
            if shapely.intersects(region, shapely.box(ix * TILE_M, iy * TILE_M,
                                                      (ix + 1) * TILE_M, (iy + 1) * TILE_M)):
                tiles.append((ix, iy))
    return tiles


def fetch() -> None:
    p = ensure_dirs()
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    path = _fetch(OSM_URL, p.raw / "estonia-latest.osm.pbf", session)
    manifest = read_manifest()
    digest = sha256_file(path)
    if "osm" in manifest and manifest["osm"]["sha256"] != digest:
        raise ValueError("OSM checksum differs from the recorded snapshot")
    if "osm" not in manifest:
        manifest["osm"] = {
            "url": OSM_URL, "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "sha256": digest, "bytes": path.stat().st_size,
            "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
            "license_url": "https://www.openstreetmap.org/copyright",
        }
    with osmium.io.Reader(str(path)) as reader:
        manifest["osm"]["snapshot"] = reader.header().get("osmosis_replication_timestamp")
    boundary_url = "https://download.geofabrik.de/europe/estonia.poly"
    boundary = _fetch(boundary_url, p.raw / "estonia.poly", session)
    if ("extraction_boundary" in manifest
            and manifest["extraction_boundary"]["sha256"] != sha256_file(boundary)):
        raise ValueError("extraction boundary checksum differs from recorded snapshot")
    if "extraction_boundary" not in manifest:
        manifest["extraction_boundary"] = {
            "url": boundary_url, "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "sha256": sha256_file(boundary), "bytes": boundary.stat().st_size,
            "note": "Geofabrik extraction boundary, not a surveyed national boundary",
        }
    manifest["coverage"] = {"name": COVERAGE, "bounds_wgs84": BBOX, "crs": projected_crs()}
    tile_records = []
    for ix, iy in terrain_tiles():
        rel = f"dtm-tiles/dtm_x{ix}_y{iy}.tif"
        try:
            downloaded = _fetch(terrain_tile_url(ix, iy), p.raw / rel, session)
        except requests.HTTPError as error:
            # The WCS rejects subsets fully outside the dtm-25 coverage extent
            # (open-sea margin tiles of the extraction polygon). Recorded as
            # absent; the sampler keeps those points unknown.
            if error.response is not None and error.response.status_code == 400:
                log.info("terrain tile %s outside the dtm-25 coverage; skipped", rel)
                continue
            raise
        tile_records.append({"file": rel, "sha256": sha256_file(downloaded),
                             "bytes": downloaded.stat().st_size})
    previous_tiles = manifest.get("terrain", {}).get("tiles")
    if previous_tiles is not None and [(t["file"], t["sha256"]) for t in previous_tiles] != [
            (t["file"], t["sha256"]) for t in tile_records]:
        raise ValueError("terrain tiles differ from the recorded snapshot")
    manifest["terrain"] = {
        "retrieved_at": manifest.get("terrain", {}).get("retrieved_at")
                        or datetime.now(timezone.utc).isoformat(),
        "tile_m": TILE_M, "tiles": tile_records,
        "license": "Maa- ja Ruumiamet open-data licence (2025-01-01)",
        "license_url": TERRAIN_LICENSE}
    for key, url, filename in (
        ("terrain_license", "https://geoportaal.maaamet.ee/docs/Avaandmed/ETAK_open_data_licence.pdf",
         "ETAK_open_data_licence.pdf"),
    ):
        downloaded = _fetch(url, p.raw / filename, session)
        checksum = sha256_file(downloaded)
        if key in manifest and manifest[key]["sha256"] != checksum:
            raise ValueError(f"{key} checksum differs from recorded snapshot")
        if key not in manifest:
            manifest[key] = {"url": url, "sha256": checksum, "bytes": downloaded.stat().st_size,
                             "retrieved_at": datetime.now(timezone.utc).isoformat(),
                             "license": "Maa- ja Ruumiamet open-data licence (2025-01-01)",
                             "license_url": TERRAIN_LICENSE}
    manifest["terrain"].update(
        name="Maa- ja Ruumiamet terrain model dtm-25", resolution_m=25,
        horizontal_crs="EPSG:3301", vertical_datum="EH2000",
        version="WCS dtm-25 snapshot as 20 km tiles; per-source flight vintages not exposed",
        attribution="Maa- ja Ruumiamet, terrain model dtm-25, extracted " +
                    manifest["terrain"]["retrieved_at"][:10],
    )
    records = teeregister.fetch(p.raw, session, BBOX)
    previous = manifest.get("teeregister", {}).get("layers")
    if previous is not None and previous != records:
        raise ValueError("Teeregister differs from recorded snapshot")
    manifest.setdefault("teeregister", {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "url": teeregister.URL, "layers": records, "crs": "EPSG:3301",
        "attribution": "Transpordiamet, Teeregister, extracted 3 October 2026",
        "rights_note": "Public/no-conditions catalogue metadata; live WFS says "
                      "AccessConstraints=private. Used locally at the user's request; "
                      "not assigned an OSM or ETAK licence.",
        "metadata_url": "https://andmed.eesti.ee/datasets/eesti-teeregister",
    })
    write_manifest(manifest)


def inside(lon: float, lat: float) -> bool:
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def interior_boundary():
    """National extraction boundary (Geofabrik estonia.poly), metric CRS."""
    text = (ensure_dirs().raw / "estonia.poly").read_text().splitlines()[1:]
    rings, ring = [], []
    for line in text:
        parts = line.split()
        if len(parts) == 2:
            ring.append(tuple(map(float, parts)))
        elif line.strip() == "END" and ring:
            rings.append(shapely.Polygon(ring))
            ring = []
    tf = Transformer.from_crs("EPSG:4326", projected_crs(), always_xy=True)
    boundary = shapely.transform(shapely.union_all(rings), tf.transform, interleaved=False)
    # National run: the extraction boundary itself, with a 1 m float-safety
    # margin. The pilot's 5 km inland buffer only made sense for an arbitrary
    # rectangle; nationally it would delete every border town and coastline.
    return shapely.buffer(boundary, 1)


def supported_spans(refs, xy, tags, blocked_nodes, surfaces, speeds):
    """Split at evidence changes and blocked nodes, retaining the other road."""
    spans, dropped = [], Counter()
    osm_speed = mapped_speeds(tags)
    for i in range(len(refs) - 1):
        line = shapely.LineString(xy[i:i + 2])
        reason = None
        if refs[i] in blocked_nodes or refs[i + 1] in blocked_nodes:
            reason = "blocked_junction"
        elif line.length < 1:
            reason = "short_segment"
        surf = tags.get("surface")
        surface_match = None
        if not reason:
            if surf is not None and surf not in PAVED:
                reason = "known_non_paved_surface"
            else:
                surface_match = surfaces.match(line, tags, teeregister.surface)
                if surface_match and surface_match[0] == "unpaved":
                    reason = "register_unpaved_or_surface_conflict"
                elif surf is None and not surface_match:
                    reason = "unknown_surface"
                elif surf is None:
                    surf = surface_match[0]
        speed_match = None
        limits = osm_speed
        if not reason and not all(limits):
            speed_match = speeds.match(line, tags, teeregister.speeds)
            if speed_match:
                forward, backward = speed_match[0]
                # Resolve only missing values; explicit OSM limits remain primary.
                provisional = {**tags,
                               "maxspeed:forward": str(limits[0] or forward),
                               "maxspeed:backward": str(limits[1] or backward)}
                limits = mapped_speeds(provisional)
            if not all(limits):
                reason = "unknown_speed"
        if reason:
            dropped[reason + "_segments"] += 1
            dropped[reason + "_km"] += line.length / 1000
            continue
        evidence = {
            "surface_source": 1 if tags.get("surface") else 2,
            "surface_oid": surface_match[1] if surface_match else 0,
            "speed_source": [1 if speed else 2 for speed in osm_speed],
            "speed_oid": speed_match[1] if speed_match else 0,
        }
        resolved = {**tags, "surface": surf,
                    "maxspeed:forward": str(limits[0]), "maxspeed:backward": str(limits[1])}
        if (spans and spans[-1]["refs"][-1] == refs[i]
                and spans[-1]["tags"] == resolved and spans[-1]["evidence"] == evidence):
            spans[-1]["refs"].append(refs[i + 1])
        else:
            spans.append({"refs": list(refs[i:i + 2]), "tags": resolved, "evidence": evidence})
    return spans, dropped


def prepare() -> None:
    p = ensure_dirs()
    source = p.raw / "estonia-latest.osm.pbf"
    blocked_nodes, blocked_ways, bicycle_ways = set(), set(), set()
    counts = Counter()
    tf = Transformer.from_crs("EPSG:4326", projected_crs(), always_xy=True)
    inland = interior_boundary()
    register = read_manifest()["teeregister"]["layers"]
    surfaces = teeregister.Evidence.load(p.raw, "n_kate", register)
    speeds = teeregister.Evidence.load(p.raw, "n_kiiruspiirang", register)
    for obj in osmium.FileProcessor(source).with_filter(osm_filter.KeyFilter(
            "barrier", "access", "vehicle", "motor_vehicle", "motorcar", "type",
            "restriction", "access:conditional", "vehicle:conditional",
            "motor_vehicle:conditional", "motorcar:conditional")):
        if obj.is_node():
            if (obj.tags.get("barrier") not in (None, "no")
                    or any(obj.tags.get(k) not in (None, "yes", "permissive", "designated")
                           for k in ("access", "vehicle", "motor_vehicle", "motorcar"))
                    or any(":conditional" in t.k for t in obj.tags)):
                blocked_nodes.add(obj.id)
        elif obj.is_relation() and obj.tags.get("route") in {"bicycle", "mtb"}:
            bicycle_ways.update(m.ref for m in obj.members if m.type == "w")
        elif obj.is_relation() and (obj.tags.get("type") == "restriction"
                                    or any(t.k.startswith("restriction") for t in obj.tags)):
            via_nodes = [m.ref for m in obj.members if m.type == "n" and m.role == "via"]
            if via_nodes:
                blocked_nodes.update(via_nodes)
            else:
                # No safe local cut is known for a via-way/unsupported relation.
                blocked_ways.update(m.ref for m in obj.members if m.type == "w")
    ways, node_ids, evidence = [], set(), {}
    for obj in osmium.FileProcessor(source).with_locations().with_filter(osm_filter.KeyFilter("highway")):
        if not obj.is_way() or obj.tags.get("highway") not in graph.DRIVABLE_SET:
            continue
        if not all(n.location.valid() for n in obj.nodes):
            continue
        if not any(inside(n.lon, n.lat) for n in obj.nodes):
            continue
        counts["candidate_ways"] += 1
        reason = None
        if not all(inside(n.lon, n.lat) for n in obj.nodes):
            reason = "outside_country_bounds"
        elif not shapely.covers(inland, shapely.transform(
                shapely.LineString([(n.lon, n.lat) for n in obj.nodes]),
                tf.transform, interleaved=False)):
            reason = "outside_extraction_boundary"
        elif obj.id in blocked_ways:
            reason = "complex_turn_restriction"
        elif any(":conditional" in t.k for t in obj.tags):
            reason = "conditional_not_supported"
        elif any(obj.tags.get(k) is not None for k in (
                "oneway:motorcar", "motorcar:forward", "motorcar:backward",
                "vehicle:forward", "vehicle:backward")):
            reason = "unsupported_directional_access"
        elif any(obj.tags.get(k) not in (None, "yes", "permissive", "designated")
                 for k in ("motorcar", "motor_vehicle", "vehicle")):
            reason = "restricted_vehicle_access"
        elif obj.tags.get("access") not in (None, "yes", "permissive", "designated") and not any(
                obj.tags.get(k) in {"yes", "permissive", "designated"} for k in ("motorcar", "motor_vehicle")):
            reason = "restricted_access"
        elif obj.tags.get("route") == "ferry" or obj.tags.get("ferry") is not None:
            reason = "ferry"
        elif not graph.is_drivable_way(obj.tags):
            reason = "access_or_other_exclusion"
        if reason:
            counts[reason] += 1
            continue
        tags = dict(obj.tags)
        if not tags.get("name") and tags.get("ref"):
            tags["name"] = "Road " + tags["ref"]
        refs = [n.ref for n in obj.nodes]
        xy = np.column_stack(tf.transform([n.lon for n in obj.nodes], [n.lat for n in obj.nodes]))
        spans, dropped = supported_spans(refs, xy, tags, blocked_nodes, surfaces, speeds)
        counts.update(dropped)
        if not spans:
            counts["no_supported_span_ways"] += 1
            continue
        counts["retained_ways"] += 1
        counts["recovered_surface_ways"] += int(any(s["evidence"]["surface_source"] == 2 for s in spans))
        counts["recovered_speed_ways"] += int(any(2 in s["evidence"]["speed_source"] for s in spans))
        counts["locally_cut_restriction_ways"] += int(bool(dropped["blocked_junction_segments"]))
        for part, span in enumerate(spans):
            # Synthetic IDs are local prepared-way identities, never OSM IDs.
            identifier = obj.id if part == 0 else -(obj.id * 100000 + part)
            ways.append((identifier, span["tags"], span["refs"]))
            node_ids.update(span["refs"])
            evidence[str(identifier)] = {"osm_way": obj.id, **span["evidence"]}
    # Write via a new temporary file; never overwrite the source download.
    dest = p.cache / "estonia.osm.pbf"
    tmp = dest.with_suffix(".tmp.pbf")
    if tmp.exists():
        tmp.unlink()  # only this pipeline's regenerable partial output
    writer = osmium.SimpleWriter(str(tmp))
    for obj in osmium.FileProcessor(source).with_filter(osm_filter.EntityFilter(osmium.osm.NODE)):
        if obj.is_node() and (obj.id in node_ids or
                              (obj.location.valid() and inside(obj.lon, obj.lat) and len(obj.tags))):
            writer.add_node(obj)
    for identifier, tags, refs in ways:
        writer.add_way(osmium.osm.mutable.Way(id=identifier, tags=tags, nodes=refs))
    writer.close()
    tmp.replace(dest)
    counts["prepared_spans"] = len(ways)
    counts["road_nodes"] = len(node_ids)
    (p.cache / "road-evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    # Libosmium assembles complete multipolygons, including holes. Unlike the
    # legacy closed-way scenery path, relation-based forests/lakes are included.
    factory = osmium.geom.GeoJSONFactory()
    tf = Transformer.from_crs("EPSG:4326", projected_crs(), always_xy=True)
    clip = shapely.box(*BBOX)
    scenic = []
    for obj in osmium.FileProcessor(source).with_areas():
        if not obj.is_area():
            continue
        tags = obj.tags
        if not (tags.get("natural") in graph.SCENIC_NATURAL
                or tags.get("landuse") in graph.SCENIC_LANDUSE
                or tags.get("leisure") in graph.SCENIC_LEISURE
                or tags.get("water") in graph.SCENIC_WATER):
            continue
        geom = shapely.from_geojson(factory.create_multipolygon(obj))
        if not shapely.intersects(geom, clip):
            continue
        geom = shapely.intersection(shapely.make_valid(geom), clip)
        geom = shapely.transform(geom, tf.transform, interleaved=False)
        if geom.area >= features.SCENIC_MIN_AREA:
            scenic.append(shapely.to_wkb(geom, hex=True))
            counts["scenic_relations" if obj.from_way() is False else "scenic_ways"] += 1
    (p.cache / "scenery.json").write_text(json.dumps(scenic), encoding="utf-8")
    (p.cache / "bicycle-ways.json").write_text(json.dumps(sorted(bicycle_ways)), encoding="utf-8")
    (p.cache / "preparation.json").write_text(json.dumps(counts, indent=2), encoding="utf-8")
    log.info("prepared %s", dict(counts))


def scenery_share(npz: dict) -> np.ndarray:
    p = ensure_dirs()
    polygons = np.array([shapely.from_wkb(s) for s in json.loads(
        (p.cache / "scenery.json").read_text())], dtype=object)
    result = np.zeros(len(npz["edge_u"]), np.float32)
    if len(polygons):
        tree = shapely.STRtree(polygons)
        for fraction in (.25, .5, .75):
            idx = (npz["edge_g0"] + np.floor(
                (npz["edge_g1"] - npz["edge_g0"] - 1) * fraction)).astype(int)
            pts = shapely.points(npz["coord_x"][idx], npz["coord_y"][idx])
            pairs = tree.query(pts, predicate="dwithin", distance=features.SCENIC_BUFFER_M)
            if pairs.size:
                result[np.unique(pairs[0])] += 1 / 3
    return result


def feature_step() -> None:
    p = ensure_dirs()
    npz, side = graph.load()
    rubric = load_rubric()
    out = features._corner_arrays(npz, rubric)
    a_lat = float(out.pop("_a_lat"))
    legal = npz["edge_maxspeed"]
    if not (legal > 0).all():
        raise ValueError("prepared Estonia graph contains unknown speed")
    out.update(features._aggregate_corners(npz, out, legal, a_lat))
    out.update(legal_speed=legal, speed_source=npz["edge_speed_source"],
               advisory=npz["edge_advisory"], scenery=scenery_share(npz))
    out.update(features._hazards(npz))
    out.update(busyness.compute(npz, side))
    out.update(elevation_features(npz))
    np.savez(p.cache / "features.npz", **out)


def graph_step() -> None:
    p = ensure_dirs()
    npz, side = graph.build(p.cache / "estonia.osm.pbf")
    evidence = json.loads((p.cache / "road-evidence.json").read_text())
    rows = [evidence[str(int(w))] for w in npz["edge_way"]]
    npz["edge_way"] = np.array([r["osm_way"] for r in rows], np.int64)
    npz["edge_surface_source"] = np.array([r["surface_source"] for r in rows], np.uint8)
    npz["edge_surface_oid"] = np.array([r["surface_oid"] for r in rows], np.int64)
    npz["edge_speed_source"] = np.array([r["speed_source"][int(rev)]
                                        for r, rev in zip(rows, npz["edge_rev"])], np.uint8)
    npz["edge_speed_oid"] = np.array([r["speed_oid"] for r in rows], np.int64)
    npz["edge_bike"] = np.isin(npz["edge_way"], json.loads(
        (p.cache / "bicycle-ways.json").read_text())).astype(np.uint8)
    side["crs"] = projected_crs()
    side["country"] = "ee"
    graph.save(npz, side, graph.cache_dir())


class TerrainSampler:
    """Tiled national dtm-25: disk-cached WCS tiles, small LRU, bilinear sampling.

    Reuses the verified GeoTIFF decoder and per-tile bilinear sampler from the
    Dutch pipeline. A point whose tile was never downloaded (open sea) or whose
    cells are nodata stays NaN: unknown terrain is never fabricated.
    """
    LRU_TILES = 48  # 48 x 800x800 float32 ~= 120 MB at most

    def __init__(self):
        self.directory = ensure_dirs().raw / "dtm-tiles"
        if not self.directory.is_dir() or not any(self.directory.glob("*.tif")):
            raise FileNotFoundError("national terrain tiles have not been downloaded")
        self.tiles: dict[tuple[int, int], elevation._Tile | None] = {}

    def tile(self, ix: int, iy: int) -> elevation._Tile | None:
        import tifffile
        key = (int(ix), int(iy))
        if key not in self.tiles:
            if len(self.tiles) >= self.LRU_TILES:
                self.tiles.pop(next(iter(self.tiles)))
            path = self.directory / f"dtm_x{key[0]}_y{key[1]}.tif"
            tile = None
            if path.exists():
                with tifffile.TiffFile(path) as tif:
                    if tif.geotiff_metadata.get("ProjectedCSTypeGeoKey") != 3301:
                        raise ValueError("terrain is not EPSG:3301")
                tile = elevation.decode_geotiff(path.read_bytes())
                if tile.resx != 25 or tile.resy != 25:
                    raise ValueError("terrain is not the documented 25 m model")
            self.tiles[key] = tile
        return self.tiles[key]

    def sample(self, x, y):
        x, y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
        z = np.full(x.shape, np.nan, np.float32)
        ix = np.floor(x / TILE_M).astype(np.int64)
        iy = np.floor(y / TILE_M).astype(np.int64)
        for tile_ix, tile_iy in set(zip(ix.tolist(), iy.tolist())):
            tile = self.tile(tile_ix, tile_iy)
            if tile is not None:
                mask = (ix == tile_ix) & (iy == tile_iy)
                z[mask] = elevation._sample_tile(tile, x[mask], y[mask])
        return z


def elevation_features(npz: dict) -> dict:
    n = len(npz["edge_u"])
    out = {"climb_m": np.zeros(n, np.float32), "descent_m": np.zeros(n, np.float32),
           "max_grade": np.zeros(n, np.float32), "elev_start": np.full(n, np.nan, np.float32),
           "elev_end": np.full(n, np.nan, np.float32),
           "elev_ok": np.zeros(n, np.uint8)}
    sampler = TerrainSampler()
    representatives = {}
    for e in range(n):
        a, b = int(npz["edge_g0"][e]), int(npz["edge_g1"][e])
        if a in representatives:
            source = representatives[a]
            same = npz["edge_rev"][source] == npz["edge_rev"][e]
            out["climb_m"][e] = out["climb_m" if same else "descent_m"][source]
            out["descent_m"][e] = out["descent_m" if same else "climb_m"][source]
            for key in ("max_grade", "elev_ok"):
                out[key][e] = out[key][source]
            out["elev_start"][e] = out["elev_start" if same else "elev_end"][source]
            out["elev_end"][e] = out["elev_end" if same else "elev_start"][source]
            continue
        representatives[a] = e
        xs, ys, s = geom.resample(npz["coord_x"][a:b], npz["coord_y"][a:b])
        z = sampler.sample(xs, ys)
        if not np.isfinite(z).all():
            continue  # partial terrain is unknown, never median-filled
        if npz["edge_rev"][e]:
            z = z[::-1]
        climb, descent, grade = geom.elevation_stats(s, z)
        out["climb_m"][e], out["descent_m"][e], out["max_grade"][e] = climb, descent, grade
        out["elev_start"][e], out["elev_end"][e], out["elev_ok"][e] = z[0], z[-1], 1
    log.info("real 25 m terrain covers %d/%d directed edges", int(out["elev_ok"].sum()), n)
    return out


def check_path(npz: dict, edges: list[int], circuit: bool = False) -> dict:
    if not edges:
        raise ValueError("empty route")
    e = np.asarray(edges)
    if not np.array_equal(npz["edge_v"][e[:-1]], npz["edge_u"][e[1:]]):
        raise ValueError("route has a disconnected edge transition")
    if circuit and npz["edge_v"][e[-1]] != npz["edge_u"][e[0]]:
        raise ValueError("circuit does not close")
    return {"edges": [int(x) for x in e],
            "osm_ways": sorted(set(int(x) for x in npz["edge_way"][e])),
            "continuous": True, "closed": bool(npz["edge_v"][e[-1]] == npz["edge_u"][e[0]]),
            "length_m": float(npz["edge_len"][e].sum())}


def is_genuine_circuit(npz, edges):
    """A closed path is not a circuit if it mostly drives the same road back."""
    check_path(npz, edges, circuit=True)
    return route.retrace_share(npz, edges) <= .20


def catalogue() -> None:
    p = ensure_dirs()
    npz, side = graph.load()
    with np.load(p.cache / "features.npz") as z:
        feats = dict(z)
    with np.load(p.cache / "scores.npz") as z:
        scores = dict(z)
    rubric = load_rubric()
    stretches = route.find_stretches(npz, scores["fun"], scores["excluded"].astype(bool), rubric)
    areas = route.cluster_areas(stretches, rubric)
    cost = npz["edge_len"].astype(float) * (
        1 + rubric["connectors"]["lambda"] * (1 - scores["fun"])
    ) ** rubric["connectors"]["gamma"]
    circuits = route.build_variants(route.CSR(npz), areas, cost, npz, rubric)
    rejected_shapes = sum(not is_genuine_circuit(npz, c.edges) for c in circuits)
    circuits = [c for c in circuits if is_genuine_circuit(npz, c.edges)]
    log.info("circuit shape gate: rejected %d retracing/out-and-back candidates", rejected_shapes)
    ranked = route.rank_circuits(circuits, npz, feats, scores, rubric)
    manifest = read_manifest()
    generated = manifest["osm"].get("snapshot") or manifest["osm"]["retrieved_at"]
    sampler = TerrainSampler()
    data = route.assemble(ranked, stretches, npz, side, feats, scores, rubric, sampler, generated)
    tf_home = Transformer.from_crs("EPSG:4326", projected_crs(), always_xy=True)
    homes = {name: tf_home.transform(*point) for name, point in origins().items()}
    for item, (c, _) in zip(data["routes"], ranked):
        item["retrace_share"] = round(route.retrace_share(npz, c.edges), 3)
        if "out_and_back" in item["flags"]:
            raise ValueError("out-and-back must not be published as an Estonia circuit")
        # Reach times are not modelled for Estonia; publish honest
        # straight-line distances like sprints and linked rides have.
        sx, sy = tf_home.transform(item["start"]["lon"], item["start"]["lat"])
        item["distance_km"] = {name: round(float(np.hypot(sx - hx, sy - hy)) / 1000, 1)
                               for name, (hx, hy) in homes.items()}
    data["sprints"] = route.mine_sprints(stretches, npz, side, feats, scores, rubric, sampler)
    linked_areas = route.cluster_areas(stretches, rubric, min_fun_km=0)
    candidates = linked.linked_candidates(npz, scores, rubric, linked_areas)
    rides = linked.assemble(candidates, npz, side, feats, scores, rubric, sampler)
    evidence = [{"family": "circuit", "id": item["id"], **check_path(npz, c.edges, True)}
                for item, (c, _) in zip(data["routes"], ranked)]
    sprint_ids = {item["id"] for item in data["sprints"]}
    for stretch in stretches:
        key = sorted(int(npz["edge_g0"][e]) for e in stretch.edges)
        identifier = "sprint-" + hashlib.sha256(np.asarray(key, dtype="<i8").tobytes()).hexdigest()[:16]
        if identifier in sprint_ids:
            evidence.append({"family": "sprint", "id": identifier, **check_path(npz, stretch.edges)})
            sprint_ids.remove(identifier)
    ride_ids = {item["id"] for item in rides["rides"]}
    for candidate in candidates:
        identifier = "linked-" + hashlib.sha256(np.asarray(candidate["edges"], dtype="<i8").tobytes()).hexdigest()[:16]
        if identifier in ride_ids:
            evidence.append({"family": "linked", "id": identifier,
                             **check_path(npz, candidate["edges"], candidate["type"] == "circuit")})
            ride_ids.remove(identifier)
    if sprint_ids or ride_ids:
        raise ValueError("published route lacks its graph path evidence")
    meta = {"country": "ee", "schema_version": 1, "generated": generated,
            "coverage": COVERAGE, "bounds": BBOX, "timezone": "Europe/Tallinn",
            "sources": manifest,
            "license": {"osm_network_and_derived_database": "ODbL-1.0",
                        "terrain": TERRAIN_LICENSE,
                        "teeregister": manifest["teeregister"]["rights_note"]},
            "note": "Estonia national coverage from the Geofabrik extract. Static OSM access evidence, not live legal permission.",
            "windows": "Sample departures in Europe/Tallinn local time; check current signs before driving"}
    meta["pipeline_sha256"] = {name: sha256_file(Path(__file__).with_name(name))
                              for name in ("estonia.py", "teeregister.py", "config.py", "fetch.py", "access.py",
                                           "elevation.py", "graph.py", "geom.py", "features.py",
                                           "busyness.py", "score.py", "route.py", "linked.py")}
    meta["rubric_sha256"] = sha256_file(p.config / "fun.yaml")
    data["meta"] = {**meta, "title": "FunRoads", "tagline": COVERAGE}
    rides["meta"] = meta
    # Missing terrain is unknown, never a fabricated flat elevation profile.
    for item in data["routes"] + data["sprints"] + rides["rides"]:
        item["why"].append("Estonia national network; quiet is a static OSM proxy, not traffic counts")
        item["why"].append("Elevation models 25 m EH2000 ground terrain, not surveyed road or bridge decks")
        item["why"].append("OSM road evidence supplemented by geometry-matched Teeregister surface and base speed records; check current signs")
    if not data["sprints"] or not rides["rides"]:
        raise ValueError("Estonia produced no real sprints or linked rides")
    for filename, doc in (("routes.json", data), ("linked.json", rides)):
        dest = p.cache / filename
        tmp = dest.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                       encoding="utf-8")
        tmp.replace(dest)
    (p.cache / "route-evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    quality_report(npz, feats, data, rides, evidence, rejected_shapes)
    log.info("Estonia catalogue: %d circuits, %d sprints, %d linked rides",
             len(data["routes"]), len(data["sprints"]), len(rides["rides"]))


def quality_report(npz, feats, routes_doc, linked_doc, evidence, rejected_shapes) -> None:
    """Write measured counts and representative checks alongside each rebuild."""
    p = ensure_dirs()
    prep = json.loads((p.cache / "preparation.json").read_text())
    csr = route.CSR(npz)
    unseen = set(range(csr.n_nodes))
    components = []
    while unseen:
        stack = [min(unseen)]
        unseen.remove(stack[0])
        size = 0
        while stack:
            node = stack.pop()
            size += 1
            neighbors = list(csr.targets[csr.indptr[node]:csr.indptr[node + 1]])
            neighbors += list(csr.rsources[csr.rindptr[node]:csr.rindptr[node + 1]])
            for target in neighbors:
                target = int(target)
                if target in unseen:
                    unseen.remove(target)
                    stack.append(target)
        components.append(size)
    _, first = np.unique(npz["edge_g0"], return_index=True)
    checks = {
        "coverage": COVERAGE, "bounds_wgs84": BBOX, "preparation": prep,
        "nodes": len(npz["node_ids"]), "directed_edges": len(npz["edge_u"]),
        "physical_network_km": float(npz["edge_len"][first].sum()) / 1000,
        "weak_components": len(components), "largest_component_nodes": max(components),
        "terrain_covered_edges": int(feats["elev_ok"].sum()),
        "unknown_surface_edges": int((npz["edge_surface"] == 0).sum()),
        "unknown_speed_edges": int((feats["legal_speed"] == 0).sum()),
        "osm_cycle_route_edges": int(npz["edge_bike"].sum()),
        "missing_width_edges": int((npz["edge_width"] == 0).sum()),
        "missing_population_edges": int(np.isnan(feats["pop_near"]).sum()),
        "circuits": len(routes_doc["routes"]), "sprints": len(routes_doc["sprints"]),
        "linked_open": sum(r["type"] == "open" for r in linked_doc["rides"]),
        "linked_loops": sum(r["type"] == "circuit" for r in linked_doc["rides"]),
        "checked_published_paths": len(evidence),
        "teeregister_speed_edges": int((npz["edge_speed_source"] == 2).sum()),
        "teeregister_surface_edges": int((npz["edge_surface_source"] == 2).sum()),
        "circuit_candidates_rejected_retrace": rejected_shapes,
    }
    if checks["unknown_speed_edges"] or checks["unknown_surface_edges"]:
        raise ValueError("Estonia contains a road without required speed/surface evidence")
    checks["catalogue_sha256"] = {name: sha256_file(p.cache / name)
                                 for name in ("routes.json", "linked.json")}
    (p.reports / "quality.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")
    text = [
        "# Estonia data quality", "",
        f"Coverage: {COVERAGE}, national, clipped to the Geofabrik extraction boundary.",
        f"WGS84 bounds: `{BBOX}`. Metric processing: EPSG:3301; heights: EH2000.",
        f"OSM snapshot: {routes_doc['meta']['generated']}. Terrain: real 25 m DTM, extraction date in the manifest.",
        "", "## Measured output", "",
        f"- {checks['circuits']} circuits, {checks['sprints']} sprints, "
        f"{checks['linked_open']} linked open rides and {checks['linked_loops']} linked loops.",
        f"- {checks['nodes']} graph nodes; {checks['directed_edges']} directed edges; "
        f"{checks['physical_network_km']:.1f} km of physical eligible network.",
        f"- {checks['weak_components']} weak components; largest has {checks['largest_component_nodes']} nodes. "
        "Missing tags and conservative exclusions fragment the network; no country-wide reach times are modelled.",
        f"- Terrain covers {checks['terrain_covered_edges']}/{checks['directed_edges']} edges. "
        "Coarse ground terrain is not road-deck surveying; bridges/tunnels and short grades remain limitations.",
        f"- Unknown speed/surface on retained roads: {checks['unknown_speed_edges']}/{checks['unknown_surface_edges']}. "
        "Unknown/loose surface and unmapped limits are excluded, not filled with Dutch defaults.",
        f"- Teeregister evidence recovered {checks['teeregister_speed_edges']} directed edges' speed limits "
        f"and {checks['teeregister_surface_edges']} edges' surfaces (geometry-matched, OSM tags stay primary).",
        f"- Circuit shape gate rejected {checks['circuit_candidates_rejected_retrace']} closed candidates "
        "that mostly retraced the same road (retrace share > 0.20); those are out-and-backs, not circuits.",
        f"- Width missing on {checks['missing_width_edges']} edges. Traffic counts, population and live closures "
        "are unavailable; quiet is a reweighted OSM proxy, not observed traffic.",
        f"- {checks['osm_cycle_route_edges']} directed edges carry mapped bicycle-route evidence.",
        "", "## Exclusions (first failing gate per candidate way)", "",
        *[f"- {key}: {value}" for key, value in prep.items()],
        "", "## Continuity and safety checks", "",
        f"All {len(evidence)} published paths have exact connected graph transitions. "
        "Circuits and linked loops close on the same OSM node. One-way direction is retained.",
        "Ferries are not routed. Private/restricted roads, barriers, conditional tags and unsupported "
        "directional permissions are excluded. Via-node barriers/restrictions cut only the two adjacent "
        "segments; complex via-way turn relations still exclude their member ways because this node-only "
        "router cannot model arbitrary turns. Missing OSM restrictions remain possible.",
        "Every published circuit must also pass a geometric retrace gate (<= 0.20 of its length driven "
        "back along the same road within 25 m, opposing directions), so closed out-and-backs are not "
        "labelled circuits.",
        "Entire ways must lie inside the Geofabrik extraction boundary, so cross-border stubs and "
        "ferry links are cut. The extraction boundary is not a surveyed international-border model.",
        "Sprints require a mapped reverse driving direction; endpoints are not verified safe turning places.",
        "", "## Representative generated routes", "",
        "| Family | Name | km | Estimated route min | Terrain climb m |",
        "|---|---|---:|---:|---:|",
    ]
    for family, items in (("Circuit", routes_doc["routes"]), ("Sprint", routes_doc["sprints"]),
                          ("Linked", linked_doc["rides"])):
        for item in items[:4]:
            text.append(f"| {family} | {item['name']} | {item['km']} | {item['drive_min']} | {item['climb_m']} |")
    text += [
        "", "## Source conflicts and omissions", "",
        "Teeregister (Transpordiamet WFS, n_kate + n_kiiruspiirang) IS used, at the user's request, to "
        "recover missing surface/speed evidence: records match OSM geometry within 12 m with >= 90% line "
        "coverage, >= 95% endpoint alignment, ref-number agreement and no ambiguous parallel candidates. "
        "Explicit register surface codes win over the contradictory INSPIRE category (gravel code 32 is "
        "marked paved there); macadam/stabilised/milled codes 23/25/26 stay unknown; time-window or "
        "extra-plate speed records are rejected. Rights caveat preserved in the manifest: catalogue "
        "metadata says no conditions, live WFS says AccessConstraints=private. Acquisition uses "
        "2-record-overlapping sorted pages with OID dedupe because GeoJSON paging loses boundary records.",
        "ETAK vectors and population/AKS data are NOT used. Scenery includes assembled OSM multipolygons "
        "and holes (not only closed ways), with three probes per edge and a 40 m adjacency test.",
        "OSM speed-zone tags explicitly map EE:rural to 90 and EE:urban to 50; directions override base "
        "limits. No untagged road-class speed default is used. Profiles preserve mapped limits per edge.",
        "Scores are the existing absolute rubric, not Estonian percentiles or ground-truth driver ratings. "
        "Circuits follow the standard 25 km soft minimum; 40–120 km remains the flagged target, "
        "not a claim about every loop.",
        "", "## Provenance", "",
        "`data/ee/manifest.json` records source URLs, retrieval dates, snapshot, licences and SHA-256. "
        "Both interchange documents carry those notices, code/rubric hashes and country/version metadata. "
        "`data/ee/cache/route-evidence.json` ties published IDs to checked edge paths and OSM way IDs. "
        "`reports/ee/quality.json` records catalogue hashes.",
    ]
    (p.reports / "quality.md").write_text("\n".join(text) + "\n", encoding="utf-8")


def run(step: str) -> None:
    actions = {"fetch": fetch, "prepare": prepare,
               "graph": graph_step,
               "features": feature_step, "score": score.run,
               "route": catalogue, "linked": catalogue}
    if step == "all":
        for name in ("fetch", "prepare", "graph", "features", "score", "route"):
            log.info("Estonia: %s", name)
            actions[name]()
    elif step == "graph":
        prepare()
        actions[step]()
    elif step in actions:
        actions[step]()
    else:
        raise ValueError(f"{step} is a Netherlands-only step; Estonia uses the absolute rubric without Dutch calibration")
