"""NDW traffic signs ("verkeersborden actueel beeld") matched onto the graph.

Input is `data/raw/verkeersborden_actueel_beeld.csv.gz`, 1,973,164 rows, kept
gzipped and streamed. Only `status == 'PLACED'` rows with an empty `removedOn`
are used (the file only contains PLACED rows; 2,589 of them carry a removal
date). Positions come from `rdX`/`rdY`, which are already RD New metres, so no
reprojection is needed.

RVV 1990 codes used, and the evidence for each
----------------------------------------------
Every code below was checked by counting it in the delivery and by fetching
the `imageUrl` of a sample row and looking at the photo.

* Bend warnings (red triangle): **J2** bend to the right (3,868 rows), **J3**
  bend to the left (3,525), **J4** series of bends, first right (1,334),
  **J5** series of bends, first left (1,360). Photos confirm: J2 a single
  right-hand curve, J3 a single left-hand curve, J4/J5 an S-shape. The other
  triangles are not bends and are excluded, verified from their photos: J1
  uneven road (1,779), J6 steep descent "4 %" (<100), J7 steep ascent "5 %",
  J8 dangerous crossroads (8,703, an X), J37 general danger "!" (20,208),
  J38 speed hump (12,239, e.g. with a "4x" plate), J21 children, J24 cyclists.
* Advisory speed: **A4**, the blue square with a number and "km/h"
  (5,349 rows, all with a numeric `blackCode`: 30 -> 3,180, 50 -> 590,
  15 -> 499, 40 -> 444, 60 -> 391, 70, 80, 90, 20). The photo of the sample
  row is a blue square "30 km/h", not the round red A1. **A5** (507 rows) is
  the end of an advisory speed and is parsed but not used.
* Speed limit: **A1** (155,981 rows) with the number in `blackCode`
  (30 -> 94,751, 60 -> 34,584, 50 -> 9,673, 15 -> 6,089, 100 -> 3,856,
  70 -> 3,554, 80 -> 1,519, 120 -> 695, 5, 10, 20, 90, 130, plus 752 blank and
  12 "Unknown"). Photo: round sign with a red ring, "50".
* End of a limit: **A2** (70,281, `blackCode` repeats the limit that ends) and
  **A3** end of all limits (22,519). Parsed, used only for reporting.
* Built-up area: **H1** entry (29,045) and **H2** exit (24,639); `blackCode`
  carries the place name ("Nijkerk", "Geldermalsen gem. West Betuwe").
* Zones: `zoneCode` is `ZB` zone entry (118,928 rows overall), `ZE` zone end
  (78,575), plus `ZO` (39,284) and `ZH` (7,889) which occur on signs inside a
  zone. A zone-30 entry is therefore `rvvCode == 'A1' and blackCode == '30'
  and zoneCode == 'ZB'` (A1 x ZB is 102,024 rows in total).
* Speed cameras: **the delivery has no RVV code for speed enforcement.** The
  full code histogram contains no camera sign, and a text search over
  `textSigns` for flits/traject/camera/controle only returns parking and
  general camera-surveillance plates. `camera` is therefore filled from a
  keyword match on `textSigns` (`CAMERA_TEXT`) and is expected to stay at or
  near zero; OSM `highway=speed_camera` (already in the graph point layer) is
  the better source.

Bearing convention (measured, not assumed)
------------------------------------------
`bearing` is the compass direction of the *traffic the sign governs*, not the
direction the plate faces. Measured on the Haarlem/Zaandam bbox graph over
signs sitting within 12 m of a one-way edge, comparing `bearing` with the
driving heading of that edge (share within +-60 deg of 0 deg vs of 180 deg):

    A1 n=2162 0.83 / 0.12    A4 n=125 0.91 / 0.07    J2 n=90 0.97 / 0.02
    J3 n=66   0.92 / 0.08    J24 n=283 0.89 / 0.05   J37 n=238 0.86 / 0.05
    H1 n=241  0.74 / 0.19    C2 n=2639 0.04 / 0.89

C2 is the control: it forbids entry, so it governs the direction opposite to
the one-way flow, and it is the only code that lands on 180 deg. A sign is
therefore attached to the driving direction whose heading is closest to
`bearing`, and dropped when neither direction is within `dir_tol` (60 deg),
which keeps signs that belong to a crossing street off this road. The `side`
field is the same angle rounded to a compass octant (measured agreement 100 %),
so it adds nothing.

Output `data/cache/signs.npz` (or `signs_bbox.npz`), aligned with the directed
edges: `bend_signs`, `bend_severity`, `advisory_sign`, `limit_sign`, `camera`,
`builtup`, `zone30`, `zone60`.

The `builtup` flag is deliberately approximate: every edge geometry passing
within `builtup_radius` (300 m) of any H1 entry sign is flagged, plus the edges
the H1 signs attach to directly. H2 exit signs are parsed but not propagated,
and motorway-like classes are cleared afterwards. This over-covers the town
edge (a road leaving town is flagged for 300 m past the sign) and misses towns
whose entry sign sits more than 25 m from an edge; it is a scenery feature,
not a legal classification.
"""

from __future__ import annotations

import csv
import gzip
import logging
import re
import time
from pathlib import Path

import numpy as np
import shapely
from shapely import STRtree

from .config import ensure_dirs
from .nwb import build_edge_lines, _tangents

log = logging.getLogger("funroads.signs")

BEND_CODES = ("J2", "J3", "J4", "J5")
SERIES_BEND_CODES = ("J4", "J5")
ADVISORY_CODES = ("A4",)
LIMIT_CODES = ("A1",)
END_CODES = ("A2", "A3", "A5")
BUILTUP_IN = ("H1",)
BUILTUP_OUT = ("H2",)

DEFAULT_CODES = frozenset(BEND_CODES + ADVISORY_CODES + LIMIT_CODES + END_CODES
                          + BUILTUP_IN + BUILTUP_OUT)

# No RVV code marks a speed camera in this delivery, so fall back to the text
# plates. See the module docstring.
CAMERA_TEXT = re.compile(r"trajectcontrole|snelheidscontrole|radarcontrole|flits", re.IGNORECASE)

ZONE_CODES = {"": 0, "ZB": 1, "ZE": 2, "ZO": 3, "ZH": 4}
ZONE_ENTRY = 1

# Bend severity scale, documented: a single bend warning is 0.5, a series of
# bends (J4/J5) is 0.8, and +0.2 when an advisory-speed sign (A4) lands on the
# same edge, i.e. the bend is signed with a speed plate. Capped at 1.0. The
# per-edge value is the maximum over the signs assigned to that edge.
SEVERITY_SINGLE = 0.5
SEVERITY_SERIES = 0.8
SEVERITY_ADVISORY_BONUS = 0.2

_NUMERIC = re.compile(r"^\s*(\d{1,3})\s*$")

# Classes that never sit inside a built-up area.
NON_BUILTUP_CLASSES = ("motorway", "motorway_link", "trunk", "trunk_link")


def signs_path(base: Path | None = None) -> Path:
    return (base or ensure_dirs().raw) / "verkeersborden_actueel_beeld.csv.gz"


def parse(csv_gz: Path, keep_codes: set[str] | None = None) -> dict[str, np.ndarray]:
    """Stream the gzipped NDW CSV and return arrays for the kept sign rows.

    Kept rows are `status == 'PLACED'`, no `removedOn`, and either an rvvCode in
    `keep_codes` (default `DEFAULT_CODES`) or a camera keyword in `textSigns`.
    """
    codes = DEFAULT_CODES if keep_codes is None else frozenset(keep_codes)
    xs: list[float] = []
    ys: list[float] = []
    code_txt: list[str] = []
    black: list[int] = []
    zone: list[int] = []
    bearing: list[float] = []
    ddir: list[int] = []
    camera: list[int] = []
    rows: list[int] = []

    with gzip.open(csv_gz, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        col = {name: i for i, name in enumerate(header)}
        need = ("rvvCode", "blackCode", "zoneCode", "status", "textSigns", "rdX", "rdY",
                "bearing", "drivingDirection", "removedOn")
        missing = [c for c in need if c not in col]
        if missing:
            raise ValueError(f"{csv_gz} lacks columns {missing}")
        i_code, i_black, i_zone = col["rvvCode"], col["blackCode"], col["zoneCode"]
        i_status, i_text, i_x, i_y = col["status"], col["textSigns"], col["rdX"], col["rdY"]
        i_bear, i_dd, i_rm = col["bearing"], col["drivingDirection"], col["removedOn"]
        width = len(header)
        for n, row in enumerate(reader):
            if len(row) < width or row[i_status] != "PLACED" or row[i_rm]:
                continue
            code = row[i_code]
            is_cam = bool(CAMERA_TEXT.search(row[i_text])) if row[i_text] else False
            if code not in codes and not is_cam:
                continue
            try:
                x = float(row[i_x])
                y = float(row[i_y])
            except ValueError:
                continue
            if not (np.isfinite(x) and np.isfinite(y)):
                continue
            xs.append(x)
            ys.append(y)
            code_txt.append(code)
            m = _NUMERIC.match(row[i_black] or "")
            black.append(min(int(m.group(1)), 255) if m else 0)
            zone.append(ZONE_CODES.get(row[i_zone], 0))
            try:
                bearing.append(float(row[i_bear]) % 360.0)
            except ValueError:
                bearing.append(np.nan)
            dd = row[i_dd]
            ddir.append(1 if dd == "H" else 2 if dd == "T" else 0)
            camera.append(1 if is_cam else 0)
            rows.append(n)

    uniq = sorted(set(code_txt))
    lookup = {c: i for i, c in enumerate(uniq)}
    out = {
        "x": np.asarray(xs, dtype=np.float64),
        "y": np.asarray(ys, dtype=np.float64),
        "code_id": np.asarray([lookup[c] for c in code_txt], dtype=np.int16),
        "code_names": np.asarray(uniq, dtype="U12"),
        "black_value": np.asarray(black, dtype=np.uint8),
        "zone": np.asarray(zone, dtype=np.uint8),
        "bearing": np.asarray(bearing, dtype=np.float32),
        "driving_dir": np.asarray(ddir, dtype=np.uint8),
        "camera": np.asarray(camera, dtype=np.uint8),
        "row": np.asarray(rows, dtype=np.int64),
    }
    log.info("signs: kept %d rows from %s", len(out["x"]), csv_gz.name)
    return out


def _code_mask(signs: dict, names: tuple[str, ...]) -> np.ndarray:
    table = list(signs["code_names"])
    ids = [table.index(n) for n in names if n in table]
    if not ids:
        return np.zeros(len(signs["x"]), dtype=bool)
    return np.isin(signs["code_id"], np.asarray(ids, dtype=np.int16))


def _bearing_of(lines, lengths, geom_idx, pts, rev) -> np.ndarray:
    """Compass bearing of travel along `geom_idx` at the nearest point to `pts`."""
    s = shapely.line_locate_point(lines[geom_idx], pts)
    tan = _tangents(lines[geom_idx], lengths[geom_idx], s)
    tan = tan * np.where(rev, -1.0, 1.0)[:, None]
    return np.degrees(np.arctan2(tan[:, 0], tan[:, 1])) % 360.0


def _wrap180(a: np.ndarray) -> np.ndarray:
    return np.abs(((np.asarray(a) + 180.0) % 360.0) - 180.0)


def _reduce_min(n_edges: int, edges: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Smallest value per edge, 0 where no value was contributed."""
    out = np.zeros(n_edges, dtype=np.uint8)
    if not len(edges):
        return out
    # 255 is a safe sentinel: no posted limit or advisory speed comes near it.
    tmp = np.full(n_edges, 255, dtype=np.uint16)
    np.minimum.at(tmp, edges, values.astype(np.uint16))
    touched = tmp < 255
    out[touched] = tmp[touched].astype(np.uint8)
    return out


def match_to_edges(
    npz: dict,
    signs: dict,
    radius: float = 25.0,
    *,
    dir_tol: float = 60.0,
    builtup_radius: float = 300.0,
) -> dict[str, np.ndarray]:
    """Assign every sign to at most one directed edge and reduce to edge arrays.

    A sign goes to the nearest edge geometry within `radius` (ties by lowest
    directed edge index) and then to the driving direction whose heading is
    closest to the sign `bearing`; without a bearing the lower edge index wins.
    Signs that disagree with both directions by more than `dir_tol` are dropped.
    """
    n_edges = len(npz["edge_u"])
    lines, geom_of_edge, glen = build_edge_lines(npz)
    rev_all = np.asarray(npz["edge_rev"]).astype(bool)

    # The one or two directed edges of each geometry, lowest index first.
    order = np.argsort(geom_of_edge, kind="stable")
    g_sorted = geom_of_edge[order]
    starts = np.flatnonzero(np.concatenate(([True], g_sorted[1:] != g_sorted[:-1])))
    counts = np.diff(np.append(starts, len(order)))
    first = np.full(len(lines), -1, dtype=np.int64)
    second = np.full(len(lines), -1, dtype=np.int64)
    first[g_sorted[starts]] = order[starts]
    two = counts >= 2
    second[g_sorted[starts[two]]] = order[starts[two] + 1]

    out = {
        "bend_signs": np.zeros(n_edges, dtype=np.uint8),
        "bend_severity": np.zeros(n_edges, dtype=np.float32),
        "advisory_sign": np.zeros(n_edges, dtype=np.uint8),
        "limit_sign": np.zeros(n_edges, dtype=np.uint8),
        "camera": np.zeros(n_edges, dtype=np.uint8),
        "builtup": np.zeros(n_edges, dtype=np.uint8),
        "zone30": np.zeros(n_edges, dtype=np.uint8),
        "zone60": np.zeros(n_edges, dtype=np.uint8),
    }
    n_signs = len(signs["x"])
    if n_signs == 0 or n_edges == 0:
        return out

    pts = shapely.points(np.column_stack([signs["x"], signs["y"]]))
    tree = STRtree(lines)
    pair = tree.query(pts, predicate="dwithin", distance=radius)
    if pair.size == 0:
        return out
    pi, gi = pair[0], pair[1]
    dist = shapely.distance(pts[pi], lines[gi])
    keep = dist <= radius
    pi, gi, dist = pi[keep], gi[keep], dist[keep]
    if not len(pi):
        return out

    # Nearest geometry per sign; ties by the lowest directed edge index.
    pick = np.lexsort((first[gi], dist, pi))
    pi_s = pi[pick]
    firsts = np.flatnonzero(np.concatenate(([True], pi_s[1:] != pi_s[:-1])))
    sel = pick[firsts]
    s_idx = pi[sel]
    g_idx = gi[sel]

    e1 = first[g_idx]
    e2 = second[g_idx]
    p_sel = pts[s_idx]
    b1 = _bearing_of(lines, glen, g_idx, p_sel, rev_all[e1])
    has2 = e2 >= 0
    b2 = np.full(len(s_idx), np.nan)
    if has2.any():
        b2[has2] = _bearing_of(lines, glen, g_idx[has2], p_sel[has2], rev_all[e2[has2]])

    sb = signs["bearing"][s_idx].astype(np.float64)
    known = np.isfinite(sb)
    d1 = np.where(known, _wrap180(sb - b1), 0.0)
    d2 = np.where(known & has2, _wrap180(sb - b2), 999.0)
    take2 = known & has2 & (d2 < d1)
    edge = np.where(take2, e2, e1)
    best = np.where(take2, d2, d1)
    ok = ~known | (best <= dir_tol)
    edge, s_idx, best = edge[ok], s_idx[ok], best[ok]
    log.info("signs: %d of %d assigned to an edge within %.0f m", len(edge), n_signs, radius)

    is_bend = _code_mask(signs, BEND_CODES)[s_idx]
    is_series = _code_mask(signs, SERIES_BEND_CODES)[s_idx]
    is_adv = _code_mask(signs, ADVISORY_CODES)[s_idx]
    is_limit = _code_mask(signs, LIMIT_CODES)[s_idx]
    is_h1 = _code_mask(signs, BUILTUP_IN)[s_idx]
    value = signs["black_value"][s_idx]
    zone = signs["zone"][s_idx]
    cam = signs["camera"][s_idx]

    counts_bend = np.bincount(edge[is_bend], minlength=n_edges)
    out["bend_signs"] = np.minimum(counts_bend, 255).astype(np.uint8)
    out["camera"] = np.minimum(np.bincount(edge[cam > 0], minlength=n_edges), 255).astype(np.uint8)

    # When a road carries several plates the most restrictive one wins.
    adv = is_adv & (value > 0)
    out["advisory_sign"] = _reduce_min(n_edges, edge[adv], value[adv])
    lim = is_limit & (value > 0)
    out["limit_sign"] = _reduce_min(n_edges, edge[lim], value[lim])

    zone_entry = zone == ZONE_ENTRY
    z30 = is_limit & zone_entry & (value == 30)
    z60 = is_limit & zone_entry & (value == 60)
    out["zone30"][edge[z30]] = 1
    out["zone60"][edge[z60]] = 1

    sev = np.where(is_series[is_bend], SEVERITY_SERIES, SEVERITY_SINGLE)
    if len(sev):
        np.maximum.at(out["bend_severity"], edge[is_bend], sev.astype(np.float32))
    bonus = (out["bend_severity"] > 0) & (out["advisory_sign"] > 0)
    out["bend_severity"][bonus] = np.minimum(
        out["bend_severity"][bonus] + SEVERITY_ADVISORY_BONUS, 1.0)

    out["builtup"][edge[is_h1]] = 1
    h1_mask = _code_mask(signs, BUILTUP_IN)
    if h1_mask.any() and builtup_radius > 0:
        h1_pts = shapely.points(np.column_stack([signs["x"][h1_mask], signs["y"][h1_mask]]))
        near = tree.query(h1_pts, predicate="dwithin", distance=builtup_radius)
        if near.size:
            gnear = np.unique(near[1])
            flag = np.zeros(len(lines), dtype=bool)
            flag[gnear] = True
            out["builtup"][flag[geom_of_edge]] = 1
    return out


def drop_motorway_builtup(npz: dict, side: dict, out: dict) -> None:
    """Clear the built-up flag on motorway-like classes (they never are)."""
    codes = side.get("highway_codes", {})
    bad = [codes[c] for c in NON_BUILTUP_CLASSES if c in codes]
    if bad:
        out["builtup"][np.isin(np.asarray(npz["edge_highway"]), bad)] = 0


def cache_file(bbox=None) -> Path:
    p = ensure_dirs()
    return p.cache / ("signs_bbox.npz" if bbox else "signs.npz")


def load(bbox=None) -> dict[str, np.ndarray]:
    with np.load(cache_file(bbox)) as z:
        return {k: z[k] for k in z.files}


def run(bbox=None) -> None:
    """Parse NDW signs, match them to graph edges, write data/cache/signs.npz."""
    from . import graph as graph_mod

    p = ensure_dirs()
    npz, side = graph_mod.load(bbox)
    t0 = time.perf_counter()
    signs = parse(signs_path(p.raw))
    if bbox:
        cx, cy = np.asarray(npz["coord_x"]), np.asarray(npz["coord_y"])
        inside = ((signs["x"] >= cx.min() - 100) & (signs["x"] <= cx.max() + 100)
                  & (signs["y"] >= cy.min() - 100) & (signs["y"] <= cy.max() + 100))
        signs = {k: (v[inside] if k != "code_names" else v) for k, v in signs.items()}
        log.info("signs: %d inside the graph bbox", len(signs["x"]))
    out = match_to_edges(npz, signs)
    drop_motorway_builtup(npz, side, out)
    dest = cache_file(bbox)
    np.savez(dest, **out)
    log.info(
        "signs written to %s in %.1fs: %d bend, %d advisory, %d limit, %d built-up, "
        "%d zone30, %d zone60, %d camera",
        dest, time.perf_counter() - t0,
        int((out["bend_signs"] > 0).sum()), int((out["advisory_sign"] > 0).sum()),
        int((out["limit_sign"] > 0).sum()), int(out["builtup"].sum()),
        int(out["zone30"].sum()), int(out["zone60"].sum()), int(out["camera"].sum()),
    )


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
