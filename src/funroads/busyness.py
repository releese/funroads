"""Estimate how busy a road is on a Sunday, without traffic counts.

NDW does hold a nationwide traffic-volume estimate for every road, but it is
bought in from a commercial supplier and is explicitly not open data; the
open INWEVA counts only cover motorways. So busyness here is a composite of
open proxies, each of which independently predicts "you will be stuck behind
something":

  population    people living within 500 m (CBS 100 m grid)
  junctions     graph degree per km: driveways, side roads, crossings
  controls      traffic signals, stops, give-ways, roundabouts per km
  bicycles      the road carries a signed cycle route, or a cycle route runs
                alongside it. On a Dutch Sunday this is the single best
                predictor of a spoiled drive
  class         motorway and primary roads carry through traffic; residential
                streets have parked cars and pedestrians
  destinations  cafes, car parks, attractions: places people drive to
  builtup       inside a built-up area

The output is a 0..1 index where 0 is an empty polder lane and 1 is a town
main street. The weights are deliberately simple and documented, because
without ground-truth counts a more elaborate model would only look precise.
"""

from __future__ import annotations

import logging
import sqlite3
import zipfile
from pathlib import Path

import numpy as np

from . import graph as graph_mod
from .config import ensure_dirs, projected_crs

log = logging.getLogger("funroads.busyness")

# Weights of each proxy in the composite index. They sum to 1.
WEIGHTS = {
    "population": 0.26,
    "bicycles": 0.20,
    "junctions": 0.16,
    "class": 0.14,
    "controls": 0.10,
    "destinations": 0.08,
    "builtup": 0.06,
}

# Per road class contribution to busyness (0 = empty, 1 = heavy through traffic).
CLASS_BUSY = {
    "motorway": 1.00, "motorway_link": 1.00, "trunk": 0.95, "trunk_link": 0.95,
    "primary": 0.80, "primary_link": 0.80, "secondary": 0.55, "secondary_link": 0.55,
    "tertiary": 0.35, "tertiary_link": 0.35, "unclassified": 0.22, "road": 0.30,
    "residential": 0.45, "living_street": 0.55,
}

CBS_POP_COLUMNS = ("aantal_inwoners", "INWONER", "inwoners", "aantal_inwoner")
NEIGHBOURHOOD_M = 500.0  # radius for the population sum around a road
POP_LO = 50.0      # people within the box: below this the road feels empty
POP_HI = 30000.0   # at this point you are on a town street


def _clip01(a: np.ndarray) -> np.ndarray:
    return np.clip(a, 0.0, 1.0)


def load_cbs_grid(cache: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (x, y, inhabitants) cell centres in RD New from the CBS grid.

    The CBS 100 m product ships as a GeoPackage. Cell geometry is a polygon,
    but the cells sit on a fixed 100 m grid, so the centre is recovered from
    the GeoPackage envelope in the blob header without decoding any WKB.
    """
    gpkg = _find_cbs_gpkg(cache)
    if gpkg is None:
        log.warning("CBS grid not found; population proxy will be zero")
        return np.zeros(0, np.float64), np.zeros(0, np.float64), np.zeros(0, np.float32)

    con = sqlite3.connect(f"file:{gpkg}?mode=ro", uri=True)
    try:
        table, geom_col = _cbs_table(con)
        pop_col = _cbs_population_column(con, table)
        log.info("CBS grid: table=%s geom=%s population=%s", table, geom_col, pop_col)
        rows = con.execute(
            f'SELECT "{geom_col}", "{pop_col}" FROM "{table}" WHERE "{pop_col}" IS NOT NULL'
        )
        xs, ys, pop = [], [], []
        for blob, value in rows:
            if blob is None:
                continue
            env = _gpkg_envelope(blob)
            if env is None:
                continue
            minx, maxx, miny, maxy = env
            xs.append((minx + maxx) / 2.0)
            ys.append((miny + maxy) / 2.0)
            # CBS uses negative sentinels (-99997 etc.) for suppressed cells.
            v = float(value) if value is not None else 0.0
            pop.append(v if v >= 0 else 0.0)
    finally:
        con.close()
    log.info("CBS grid: %d cells with population", len(xs))
    return (
        np.asarray(xs, dtype=np.float64),
        np.asarray(ys, dtype=np.float64),
        np.asarray(pop, dtype=np.float32),
    )


def _find_cbs_gpkg(cache: Path) -> Path | None:
    candidates = sorted((cache / "cbs").glob("*.gpkg")) if (cache / "cbs").exists() else []
    if candidates:
        return candidates[0]
    # Not extracted yet: unpack the zip we downloaded.
    raw = cache.parent / "raw"
    zips = sorted(raw.glob("cbs_vk100_*.zip"))
    if not zips:
        return None
    out = cache / "cbs"
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zips[-1]) as z:
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            if info.filename.lower().endswith(".gpkg"):
                log.info("extracting %s", info.filename)
                z.extract(info, out)
    got = sorted(out.rglob("*.gpkg"))
    return got[0] if got else None


def _cbs_table(con: sqlite3.Connection) -> tuple[str, str]:
    row = con.execute(
        "SELECT table_name, column_name FROM gpkg_geometry_columns LIMIT 1"
    ).fetchone()
    if row:
        return row[0], row[1]
    name = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'gpkg%'"
        " AND name NOT LIKE 'sqlite%' AND name NOT LIKE 'rtree%' LIMIT 1"
    ).fetchone()[0]
    return name, "geom"


def _cbs_population_column(con: sqlite3.Connection, table: str) -> str:
    cols = [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]
    lower = {c.lower(): c for c in cols}
    for cand in CBS_POP_COLUMNS:
        if cand.lower() in lower:
            return lower[cand.lower()]
    for c in cols:
        if "inwon" in c.lower():
            return c
    raise RuntimeError(f"no population column found in {table}: {cols}")


def _gpkg_envelope(blob: bytes) -> tuple[float, float, float, float] | None:
    """Read the envelope from a GeoPackage geometry blob header.

    Layout: 'GP', version, flags, int32 srs_id, then the envelope. Bits 1-3 of
    the flags give the envelope kind; kind 1 is the 4-value xy envelope.
    """
    if len(blob) < 8 or blob[0:2] != b"GP":
        return None
    flags = blob[3]
    env_kind = (flags >> 1) & 0x07
    if env_kind == 0:
        return None
    little = bool(flags & 0x01)
    dtype = "<f8" if little else ">f8"
    n_doubles = {1: 4, 2: 6, 3: 6, 4: 8}.get(env_kind)
    if n_doubles is None:
        return None
    vals = np.frombuffer(blob, dtype=dtype, count=n_doubles, offset=8)
    return float(vals[0]), float(vals[1]), float(vals[2]), float(vals[3])


def population_near_edges(
    mid_x: np.ndarray, mid_y: np.ndarray, cbs: tuple[np.ndarray, np.ndarray, np.ndarray],
    radius: float = NEIGHBOURHOOD_M,
) -> np.ndarray:
    """People living within `radius` of each edge midpoint.

    Implemented as a box sum on a 100 m raster via a summed-area table, which
    turns a 2 million by 4 million nearest-neighbour problem into two array
    lookups.
    """
    cx, cy, pop = cbs
    n = len(mid_x)
    if not len(cx):
        return np.zeros(n, dtype=np.float32)
    cell = 100.0
    x0, y0 = cx.min() - cell, cy.min() - cell
    nx = int((cx.max() - x0) / cell) + 3
    ny = int((cy.max() - y0) / cell) + 3
    grid = np.zeros((ny, nx), dtype=np.float32)
    ix = ((cx - x0) / cell).astype(np.int64)
    iy = ((cy - y0) / cell).astype(np.int64)
    np.add.at(grid, (iy, ix), pop)
    # Summed-area table with a zero border so the box sum needs no clamping.
    sat = np.zeros((ny + 1, nx + 1), dtype=np.float64)
    np.cumsum(np.cumsum(grid, axis=0), axis=1, out=sat[1:, 1:])

    r = int(round(radius / cell))
    ex = np.clip(((mid_x - x0) / cell).astype(np.int64), 0, nx - 1)
    ey = np.clip(((mid_y - y0) / cell).astype(np.int64), 0, ny - 1)
    x_lo = np.clip(ex - r, 0, nx)
    x_hi = np.clip(ex + r + 1, 0, nx)
    y_lo = np.clip(ey - r, 0, ny)
    y_hi = np.clip(ey + r + 1, 0, ny)
    total = (
        sat[y_hi, x_hi] - sat[y_lo, x_hi] - sat[y_hi, x_lo] + sat[y_lo, x_lo]
    )
    return total.astype(np.float32)


def box_count(
    px: np.ndarray, py: np.ndarray, qx: np.ndarray, qy: np.ndarray,
    cell: float, weights: np.ndarray | None = None,
) -> np.ndarray:
    """Weighted count of source points in the 3x3 cell block around each query.

    A summed-area table over a raster of `cell` metres turns an otherwise
    quadratic neighbour search into two array lookups, which is what makes a
    national pass over two million edges practical. The effective search radius
    is therefore between one and one and a half cells, not an exact circle.
    """
    n = len(qx)
    if not len(px):
        return np.zeros(n, dtype=np.float32)
    w = np.ones(len(px), dtype=np.float32) if weights is None else weights.astype(np.float32)
    x0, y0 = float(px.min()) - cell, float(py.min()) - cell
    nx = int((float(px.max()) - x0) / cell) + 3
    ny = int((float(py.max()) - y0) / cell) + 3
    grid = np.zeros((ny, nx), dtype=np.float32)
    np.add.at(
        grid,
        (((py - y0) / cell).astype(np.int64), ((px - x0) / cell).astype(np.int64)),
        w,
    )
    sat = np.zeros((ny + 1, nx + 1), dtype=np.float64)
    np.cumsum(np.cumsum(grid, axis=0), axis=1, out=sat[1:, 1:])
    ex = np.clip(((qx - x0) / cell).astype(np.int64), 0, nx - 1)
    ey = np.clip(((qy - y0) / cell).astype(np.int64), 0, ny - 1)
    x_lo, x_hi = np.clip(ex - 1, 0, nx), np.clip(ex + 2, 0, nx)
    y_lo, y_hi = np.clip(ey - 1, 0, ny), np.clip(ey + 2, 0, ny)
    return (sat[y_hi, x_hi] - sat[y_lo, x_hi] - sat[y_hi, x_lo] + sat[y_lo, x_lo]).astype(np.float32)


def bicycle_proximity(npz: dict, mid_x: np.ndarray, mid_y: np.ndarray, cell: float = 40.0) -> np.ndarray:
    """1 where a signed cycle route runs on the road, 0.7 where one runs beside it.

    Routes sharing the carriageway come from the graph's `edge_bike` flag. A
    parallel cycle path is not in the drivable graph at all, so proximity to a
    cycle-route edge stands in for "expect cyclists here".
    """
    on_road = npz["edge_bike"].astype(np.float32)
    bike_idx = np.flatnonzero(npz["edge_bike"] > 0)
    if not len(bike_idx):
        return on_road
    g0 = npz["edge_g0"][bike_idx]
    g1 = npz["edge_g1"][bike_idx]
    bx = ((npz["coord_x"][g0] + npz["coord_x"][g1 - 1]) / 2.0).astype(np.float64)
    by = ((npz["coord_y"][g0] + npz["coord_y"][g1 - 1]) / 2.0).astype(np.float64)
    near = (box_count(bx, by, mid_x, mid_y, cell) > 0).astype(np.float32) * 0.7
    return np.maximum(on_road, near)


def point_density(
    npz: dict, kinds: tuple[int, ...], mid_x: np.ndarray, mid_y: np.ndarray, radius: float
) -> np.ndarray:
    """Count of point-layer features of the given kinds near each edge."""
    mask = np.isin(npz["pt_kind"], np.asarray(kinds, dtype=np.uint8))
    return box_count(
        npz["pt_x"][mask].astype(np.float64), npz["pt_y"][mask].astype(np.float64),
        mid_x, mid_y, radius,
    )


def node_degree(npz: dict) -> np.ndarray:
    """Out-degree per node, i.e. how many ways you can leave it."""
    n_nodes = len(npz["node_ids"])
    deg = np.zeros(n_nodes, dtype=np.int32)
    np.add.at(deg, npz["edge_u"], 1)
    return deg


def compute(npz: dict, side: dict) -> dict[str, np.ndarray]:
    """Return the busyness index and its components, per directed edge."""
    p = ensure_dirs()
    n = len(npz["edge_u"])
    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    mid_i = (g0 + g1) // 2
    mid_x = npz["coord_x"][mid_i].astype(np.float64)
    mid_y = npz["coord_y"][mid_i].astype(np.float64)
    length_km = np.maximum(npz["edge_len"].astype(np.float64) / 1000.0, 1e-4)

    # Population on a log scale between two anchors, because the step from 50 to
    # 500 people nearby changes a road completely while 20k to 40k does not.
    # POP_LO reads as an empty lane, POP_HI as a town street; a Dutch village
    # edge lands near 1000-3000 within this 1.2 km box.
    estonia = projected_crs() == "EPSG:3301"
    pop = (np.full(n, np.nan, np.float32) if estonia else
           population_near_edges(mid_x, mid_y, load_cbs_grid(p.cache)))
    lo, hi = np.log10(POP_LO), np.log10(POP_HI)
    pop_score = _clip01((np.log10(np.maximum(pop, 1.0)) - lo) / (hi - lo))

    bikes = bicycle_proximity(npz, mid_x, mid_y)

    deg = node_degree(npz)
    ends = (deg[npz["edge_u"]] + deg[npz["edge_v"]]) / 2.0
    junctions_per_km = np.clip((ends - 2.0), 0.0, None) / length_km
    junction_score = _clip01(junctions_per_km / 12.0)

    controls = point_density(npz, (graph_mod.PT_CONTROL, graph_mod.PT_CROSSING), mid_x, mid_y, 150.0)
    roundabout = (npz["edge_flags"] & graph_mod.F_ROUNDABOUT) > 0
    control_score = _clip01(controls / 4.0 + roundabout * 0.5)

    hw_names = {v: k for k, v in side["highway_codes"].items()}
    class_score = np.zeros(n, dtype=np.float32)
    for code, name in hw_names.items():
        class_score[npz["edge_highway"] == code] = CLASS_BUSY.get(name, 0.3)

    dest = point_density(npz, (graph_mod.PT_COFFEE, graph_mod.PT_VIEW, graph_mod.PT_FUEL), mid_x, mid_y, 300.0)
    dest_score = _clip01(dest / 8.0)

    # Built-up proxy: many people nearby plus a place node close by.
    places = point_density(npz, (graph_mod.PT_PLACE,), mid_x, mid_y, 600.0)
    builtup = (_clip01(places / 2.0) if estonia else
               _clip01((pop_score > 0.45).astype(np.float32) * 0.6 + _clip01(places / 2.0) * 0.4))

    parts = {
        "population": pop_score.astype(np.float32),
        "bicycles": bikes.astype(np.float32),
        "junctions": junction_score.astype(np.float32),
        "class": class_score,
        "controls": control_score.astype(np.float32),
        "destinations": dest_score.astype(np.float32),
        "builtup": builtup.astype(np.float32),
    }
    index = np.zeros(n, dtype=np.float32)
    weights = ({key: w / (1 - WEIGHTS["population"]) for key, w in WEIGHTS.items()
                if key != "population"} if estonia else WEIGHTS)
    for key, w in weights.items():
        index += w * parts[key]
    out = {"busyness": _clip01(index).astype(np.float32)}
    out.update({f"busy_{k}": v for k, v in parts.items()})
    out["pop_near"] = pop
    return out


def run(bbox=None) -> None:
    npz, side = graph_mod.load(bbox)
    out = compute(npz, side)
    p = ensure_dirs()
    path = p.cache / ("busyness_bbox.npz" if bbox else "busyness.npz")
    np.savez(path, **out)
    b = out["busyness"]
    log.info(
        "busyness written to %s: mean %.3f, quiet share (<0.15) %.1f%%",
        path.name, float(b.mean()), 100.0 * float((b < 0.15).mean()),
    )


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
