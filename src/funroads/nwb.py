"""Legal speed limits from the NWB/WKD speed dossier, matched onto the graph.

Input
-----
`data/cache/wkd/<date>/Snelheden.gpkg`, the RWS "Wegkenmerken Dossier"
maximum-speed delivery: 1,675,226 LINESTRING features in EPSG:28992 (verified:
`gpkg_contents.srs_id = 28992` and `gpkg_geometry_columns = ('Snelheden',
'geom', 'LINESTRING', 28992, 0, 0)`). GeoPackage blobs are parsed here rather
than through GDAL, because the project has no GDAL/geopandas: header is `GP`,
a version byte, a flags byte (bit 0 = little endian, bits 1-3 = envelope code,
bit 4 = empty), an int32 srs_id and then an optional envelope of 0/32/48/48/64
bytes, followed by plain WKB which shapely reads.

Columns used (all verified against the delivery, counts as of 01-09-2026)
------------------------------------------------------------------------
* `MAXSHD`   TEXT legal limit. Values seen: 30 (787,176), NVT (356,956),
  50 (240,546), 60 (164,784), 80 (57,024), 15 (33,769), 100 (14,267),
  NOA (10,458), 70 (6,545), 130 (2,760), 5, 90, 20, 40. `NVT` (not
  applicable) and `NOA` (not researched) rows are dropped.
* `MAXSHD_ADV` advisory speed, only 828 non-null rows: used for `advisory`.
* `BEGINTIJD`/`EINDTIJD`/`MAXSHD_ALT` time window. In the whole delivery only
  one pattern exists: BEGINTIJD=6, EINDTIJD=19 with MAXSHD='100' and
  MAXSHD_ALT in {130 (4,676), 120 (1,946)} - the motorway day limit. The rule
  implemented is: `MAXSHD` applies inside [BEGINTIJD, EINDTIJD), `MAXSHD_ALT`
  outside it, evaluated at `SUNDAY_HOUR` = 13:00 (the middle of the 11:00-17:00
  window this project drives in), so Dutch motorways come out at 100.
* `KENM_RICHT` direction the attribute applies to: B = beide (both,
  1,504,634), H = heen (with the digitisation direction of the line, 170,315),
  T = terug (against it, 277). An `H` row is only accepted for a driving
  direction that runs along the line, a `T` row only for one that runs against
  it. Note this is the *NWB wegvak* direction, not the OSM way direction, so
  the test is done geometrically on the local tangent, not on ids.
* `BETRWBHEID` reliability, '100%' (1,592,737) or '50%' (82,489): feeds the
  confidence, it never rejects a row.
* `BST_CODE` lane subtype. Only car carriageways are kept:
  RB, HR, NRB, PAR, ERF, OPR, AFR, PST, TRB, DST, VBD, VBI, VBK, VBR, VBS,
  VBW, GRB, TN, OVB, CADO, WIS (~1.29 M rows). Dropped: FP (fietspad,
  308,325 rows, 0.00 % of them carry a limit), VP (voetpad), BUS (busbaan),
  VZ (veerverbinding, 25 % limits), RP (ruiterpad), VDA/VDF/VDV (no limits at
  all), VV, and the parking classes PP (avg 49 m stubs), PKB, PKP, BVP, PR,
  PC. PAR (avg 142 m, street-named) is kept as parallel carriageway.
* `STT_NAAM` street name and `WVK_ID` for name agreement and tie-breaking.

Matching
--------
For every directed edge three sample points are taken at 25 %, 50 % and 75 %
along the driving-direction geometry. A shapely `STRtree` over the kept WKD
lines is queried with `predicate="dwithin"` for all sample points of a chunk at
once, so no Python loop ever touches a shapely object. For each (sample, WKD
row) candidate the code computes

* the perpendicular distance (accepted when <= `radius`, default 25 m),
* the angle between the edge tangent in driving direction and the WKD tangent
  at the nearest point; accepted when it is within `heading_tol` (40 deg) of
  0 deg or of 180 deg, because WKD digitisation order is not driving order,
* whether the normalised names agree (casefold, drop everything that is not
  alphanumeric): both known and equal -> vote weight 3, one side unknown -> 2,
  both known and different -> 1. A name mismatch therefore lowers the vote and
  the confidence but never rejects a candidate outright, because OSM and NWB
  frequently name the same road differently.

Candidates are then grouped by (edge, resolved limit) and the group with the
largest summed weight wins. Every tie is broken deterministically, in order:
larger weight, then smaller distance, then smaller WVK_ID, then smaller WKD
rowid. The winning group's best row is reported in `wkd_row`.

Confidence is `0.35*distance + 0.25*heading + 0.20*name + 0.10*reliability +
0.10*vote share`, each term in 0..1.

Output `data/cache/speeds.npz` (or `speeds_bbox.npz`), all arrays aligned with
the directed edge arrays of the graph:
`legal_speed` uint8, `speed_source` uint8 (0 unknown, 1 OSM, 2 WKD, 3 class
default), `speed_conf` float32, `advisory` uint8, `wkd_row` int64 (-1 when
unmatched). `legal_speed` is never 0: what neither WKD nor OSM covers falls
back to the class default table below.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from pathlib import Path

import numpy as np
import shapely
from shapely import STRtree

from .config import ensure_dirs

log = logging.getLogger("funroads.nwb")

# Speed source codes, also written into the npz.
SRC_UNKNOWN = 0
SRC_OSM = 1
SRC_WKD = 2
SRC_CLASS = 3

# Hour of day the limits are resolved for: a Sunday drive between 11:00 and
# 17:00, so the middle of that window.
SUNDAY_HOUR = 13

# Car carriageway subtypes, see the module docstring for the evidence.
KEEP_BST = (
    "RB", "HR", "NRB", "PAR", "ERF", "OPR", "AFR", "PST", "TRB", "DST",
    "VBD", "VBI", "VBK", "VBR", "VBS", "VBW", "GRB", "TN", "OVB", "CADO", "WIS",
)

# MAXSHD values that mean "no limit recorded".
NO_LIMIT = frozenset({"NVT", "NOA", "", None})

# Fallback limits per OSM highway class, km/h. Links inherit their parent.
CLASS_DEFAULT = {
    "motorway": 100, "motorway_link": 100,
    "trunk": 100, "trunk_link": 100,
    "primary": 80, "primary_link": 80,
    "secondary": 80, "secondary_link": 80,
    "tertiary": 80, "tertiary_link": 80,
    "unclassified": 80,
    "road": 50,
    "residential": 30,
    "living_street": 15,
}

# KENM_RICHT encoding used inside this module.
RICHT_BOTH = 0
RICHT_FORWARD = 1   # 'H', applies along the digitisation direction
RICHT_BACKWARD = 2  # 'T', applies against it

_ENVELOPE_BYTES = (0, 32, 48, 48, 64)


# ---------------------------------------------------------------------------
# GeoPackage binary
# ---------------------------------------------------------------------------


def gpkg_wkb(blob: bytes) -> tuple[int, bytes]:
    """Split a GeoPackage geometry blob into (srs_id, WKB tail)."""
    if len(blob) < 8 or blob[0:2] != b"GP":
        raise ValueError("not a GeoPackage geometry blob")
    flags = blob[3]
    order = "little" if flags & 0x01 else "big"
    env = (flags >> 1) & 0x07
    if env >= len(_ENVELOPE_BYTES):
        raise ValueError(f"unsupported envelope indicator {env}")
    srs_id = int.from_bytes(blob[4:8], order, signed=True)
    return srs_id, blob[8 + _ENVELOPE_BYTES[env]:]


def gpkg_geometries(blobs) -> tuple[np.ndarray, set[int]]:
    """Parse many GeoPackage blobs. Returns (geometry array, srs ids seen)."""
    wkbs = []
    srs: set[int] = set()
    for b in blobs:
        s, w = gpkg_wkb(b)
        srs.add(s)
        wkbs.append(w)
    if not wkbs:
        return np.empty(0, dtype=object), srs
    return shapely.from_wkb(wkbs), srs


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def normalise_name(name: str | None) -> str:
    """Casefold and strip everything that is not alphanumeric."""
    if not name:
        return ""
    return "".join(ch for ch in str(name).casefold() if ch.isalnum())


def resolve_limit(maxshd, begintijd, eindtijd, maxshd_alt, hour: int = SUNDAY_HOUR) -> int:
    """Legal limit in km/h at `hour`, honouring the WKD time window.

    `MAXSHD` is valid inside [BEGINTIJD, EINDTIJD) and `MAXSHD_ALT` outside it.
    Returns 0 when nothing usable is recorded.
    """
    if maxshd in NO_LIMIT:
        base = 0
    else:
        try:
            base = int(str(maxshd).strip())
        except ValueError:
            base = 0
    if begintijd is None or eindtijd is None or maxshd_alt in (None, ""):
        return base
    b, e = int(begintijd), int(eindtijd)
    if b == e:
        inside = True
    elif b < e:
        inside = b <= hour < e
    else:  # window wraps past midnight
        inside = hour >= b or hour < e
    return base if inside else int(maxshd_alt)


def _richt_code(value: str | None) -> int:
    if value == "H":
        return RICHT_FORWARD
    if value == "T":
        return RICHT_BACKWARD
    return RICHT_BOTH


def _reliability(value: str | None) -> float:
    if not value:
        return 0.75
    txt = str(value).strip().rstrip("%")
    try:
        return max(0.0, min(float(txt) / 100.0, 1.0))
    except ValueError:
        return 0.75


# ---------------------------------------------------------------------------
# WKD loading
# ---------------------------------------------------------------------------


def wkd_path(base: Path | None = None) -> Path:
    """Newest Snelheden.gpkg under data/cache/wkd/<date>/."""
    root = (base or ensure_dirs().cache) / "wkd"
    found = sorted(root.glob("*/Snelheden.gpkg"))
    if not found:
        raise FileNotFoundError(f"no Snelheden.gpkg under {root}")
    return found[-1]


def load_wkd(
    gpkg: Path,
    bbox: tuple[float, float, float, float] | None = None,
    bst_codes: tuple[str, ...] = KEEP_BST,
    table: str = "Snelheden",
    hour: int = SUNDAY_HOUR,
) -> dict:
    """Read the speed rows that carry a limit for cars.

    `bbox` is (minx, miny, maxx, maxy) in RD New metres and is pushed down into
    the GeoPackage R-tree when one is present.
    """
    con = sqlite3.connect(f"file:{gpkg}?mode=ro", uri=True)
    try:
        cols = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        needed = ["id", "WVK_ID", "STT_NAAM", "MAXSHD", "MAXSHD_ALT", "MAXSHD_ADV",
                  "BEGINTIJD", "EINDTIJD", "KENM_RICHT", "BETRWBHEID", "BST_CODE", "geom"]
        missing = [c for c in needed if c not in cols]
        if missing:
            raise ValueError(f"{gpkg} lacks columns {missing}")
        where = ["MAXSHD IS NOT NULL", "MAXSHD NOT IN ('NVT','NOA')"]
        params: list = []
        if bst_codes:
            where.append("BST_CODE IN (%s)" % ",".join("?" * len(bst_codes)))
            params.extend(bst_codes)
        rtree = f"rtree_{table}_geom"
        has_rtree = bool(con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (rtree,)).fetchone())
        if bbox is not None and has_rtree:
            where.append(
                f"id IN (SELECT id FROM {rtree} WHERE maxx>=? AND minx<=? AND maxy>=? AND miny<=?)")
            params.extend([bbox[0], bbox[2], bbox[1], bbox[3]])
        sql = f"SELECT {', '.join(needed)} FROM {table} WHERE {' AND '.join(where)} ORDER BY id"
        rows = con.execute(sql, params).fetchall()
    finally:
        con.close()

    n = len(rows)
    rowid = np.empty(n, dtype=np.int64)
    wvk = np.empty(n, dtype=np.int64)
    speed = np.zeros(n, dtype=np.uint8)
    adv = np.zeros(n, dtype=np.uint8)
    richt = np.zeros(n, dtype=np.uint8)
    rel = np.zeros(n, dtype=np.float32)
    names: list[str] = []
    blobs: list[bytes] = []
    keep = np.ones(n, dtype=bool)
    for i, r in enumerate(rows):
        rowid[i] = r[0]
        wvk[i] = r[1] if r[1] is not None else -1
        names.append(normalise_name(r[2]))
        limit = resolve_limit(r[3], r[6], r[7], r[4], hour=hour)
        if not 0 < limit <= 255:
            keep[i] = False
            limit = 0
        speed[i] = limit
        adv[i] = int(r[5]) if r[5] not in (None, "") and 0 < int(r[5]) <= 255 else 0
        richt[i] = _richt_code(r[8])
        rel[i] = _reliability(r[9])
        blobs.append(r[11])

    geoms, srs = gpkg_geometries(blobs)
    if srs - {28992}:
        log.warning("WKD geometries carry unexpected srs ids %s (expected 28992)", sorted(srs))
    if n and not keep.all():
        idx = np.flatnonzero(keep)
        rowid, wvk, speed, adv, richt, rel = (a[idx] for a in (rowid, wvk, speed, adv, richt, rel))
        names = [names[i] for i in idx]
        geoms = geoms[idx]
    log.info("WKD: %d rows kept from %s", len(rowid), gpkg.name)
    return {
        "rowid": rowid, "wvk": wvk, "speed": speed, "advisory": adv,
        "richt": richt, "reliability": rel, "name": names, "geom": geoms,
        "srs": sorted(srs),
    }


# ---------------------------------------------------------------------------
# Graph geometry
# ---------------------------------------------------------------------------


def build_edge_lines(npz: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Build one shapely LineString per undirected geometry slice.

    Returns (lines, geom_of_edge, lengths). `geom_of_edge[e]` indexes `lines`
    for directed edge `e`; both directions of a segment share one line.
    """
    g0 = np.asarray(npz["edge_g0"], dtype=np.int64)
    g1 = np.asarray(npz["edge_g1"], dtype=np.int64)
    uniq, first, inverse = np.unique(g0, return_index=True, return_inverse=True)
    starts = uniq
    ends = g1[first]
    counts = (ends - starts).astype(np.int64)
    if (counts < 2).any():
        raise ValueError("graph contains a geometry slice with fewer than two points")
    total = int(counts.sum())
    # Flat index array over coord_x/coord_y for all slices, concatenated.
    seg_start = np.zeros(len(counts), dtype=np.int64)
    np.cumsum(counts[:-1], out=seg_start[1:])
    offset = np.repeat(starts - seg_start, counts)
    idx = offset + np.arange(total, dtype=np.int64)
    coords = np.empty((total, 2), dtype=np.float64)
    coords[:, 0] = np.asarray(npz["coord_x"])[idx]
    coords[:, 1] = np.asarray(npz["coord_y"])[idx]
    line_idx = np.repeat(np.arange(len(counts), dtype=np.int64), counts)
    lines = shapely.linestrings(coords, indices=line_idx)
    return lines, inverse.astype(np.int64), shapely.length(lines)


def _tangents(lines: np.ndarray, lengths: np.ndarray, s: np.ndarray, delta: float = 5.0) -> np.ndarray:
    """Unit tangent of `lines` at arc position `s`, in digitisation direction."""
    half = np.minimum(delta, np.maximum(lengths / 2.0, 1e-6))
    s0 = np.clip(s - half, 0.0, lengths)
    s1 = np.clip(s + half, 0.0, lengths)
    p0 = shapely.get_coordinates(shapely.line_interpolate_point(lines, s0))
    p1 = shapely.get_coordinates(shapely.line_interpolate_point(lines, s1))
    vec = p1 - p0
    norm = np.hypot(vec[:, 0], vec[:, 1])
    bad = norm < 1e-9
    if bad.any():
        # Degenerate window (a closed or zero-length line): fall back to the
        # chord between the line's own endpoints.
        e0 = shapely.get_coordinates(shapely.line_interpolate_point(lines[bad], np.zeros(int(bad.sum()))))
        e1 = shapely.get_coordinates(shapely.line_interpolate_point(lines[bad], lengths[bad]))
        vec[bad] = e1 - e0
        norm = np.hypot(vec[:, 0], vec[:, 1])
    norm = np.where(norm < 1e-9, 1.0, norm)
    return vec / norm[:, None]


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

SAMPLE_FRACTIONS = (0.25, 0.5, 0.75)
_NAME_WEIGHT = np.array([1.0, 2.0, 3.0], dtype=np.float64)   # mismatch, unknown, match
_NAME_CONF = np.array([0.15, 0.5, 1.0], dtype=np.float64)


def match(
    npz: dict,
    side: dict,
    gpkg: Path,
    signs: dict | None = None,
    *,
    radius: float = 25.0,
    heading_tol: float = 40.0,
    chunk: int = 100_000,
    wkd: dict | None = None,
    hour: int = SUNDAY_HOUR,
) -> dict[str, np.ndarray]:
    """Match WKD limits onto every directed edge and build the output arrays.

    `wkd` may hold an already-loaded dossier (used by the tests); otherwise it
    is read from `gpkg`, restricted to the graph's bounding box.
    """
    n_edges = len(npz["edge_u"])
    lines, geom_of_edge, geom_len = build_edge_lines(npz)
    edge_rev = np.asarray(npz["edge_rev"]).astype(bool)

    if wkd is None:
        cx, cy = np.asarray(npz["coord_x"]), np.asarray(npz["coord_y"])
        bbox = (float(cx.min()) - 100.0, float(cy.min()) - 100.0,
                float(cx.max()) + 100.0, float(cy.max()) + 100.0)
        wkd = load_wkd(Path(gpkg), bbox=bbox, hour=hour)

    # Shared name table: comparing small ints beats comparing strings per pair.
    name_ids: dict[str, int] = {"": 0}
    graph_names = [normalise_name(s) for s in side.get("names", [""])]
    for nm in graph_names:
        if nm and nm not in name_ids:
            name_ids[nm] = len(name_ids)
    for nm in wkd["name"]:
        if nm and nm not in name_ids:
            name_ids[nm] = len(name_ids)
    edge_name_id = np.array([name_ids[n] for n in graph_names], dtype=np.int32)[
        np.asarray(npz["edge_name"], dtype=np.int64)]
    wkd_name_id = np.array([name_ids[n] for n in wkd["name"]], dtype=np.int32)

    w_geom = wkd["geom"]
    w_speed = wkd["speed"].astype(np.int64)
    w_len = shapely.length(w_geom) if len(w_geom) else np.zeros(0)
    tree = STRtree(w_geom) if len(w_geom) else None

    best_speed = np.zeros(n_edges, dtype=np.uint8)
    best_conf = np.zeros(n_edges, dtype=np.float32)
    best_row = np.full(n_edges, -1, dtype=np.int64)
    best_wkd_idx = np.full(n_edges, -1, dtype=np.int64)

    cos_tol = float(np.cos(np.radians(heading_tol)))
    t0 = time.perf_counter()
    for start in range(0, n_edges, chunk):
        stop = min(start + chunk, n_edges)
        ei = np.arange(start, stop, dtype=np.int64)
        if tree is None:
            break
        gi = geom_of_edge[ei]
        e_lines = lines[gi]
        e_len = geom_len[gi]
        rev = edge_rev[ei]
        sign = np.where(rev, -1.0, 1.0)[:, None]

        pts_list, tan_list = [], []
        for frac in SAMPLE_FRACTIONS:
            f = np.where(rev, 1.0 - frac, frac)
            s = f * e_len
            pts_list.append(shapely.line_interpolate_point(e_lines, s))
            tan_list.append(_tangents(e_lines, e_len, s) * sign)
        pts = np.concatenate(pts_list)
        tans = np.concatenate(tan_list)
        sample_edge = np.tile(ei, len(SAMPLE_FRACTIONS))

        pair = tree.query(pts, predicate="dwithin", distance=radius)
        if pair.size == 0:
            continue
        si, wi = pair[0], pair[1]
        cand_pts = pts[si]
        dist = shapely.distance(cand_pts, w_geom[wi])
        ok = dist <= radius
        if not ok.all():
            si, wi, cand_pts, dist = si[ok], wi[ok], cand_pts[ok], dist[ok]
        if not len(si):
            continue

        s_w = shapely.line_locate_point(w_geom[wi], cand_pts)
        w_tan = _tangents(w_geom[wi], w_len[wi], s_w)
        e_tan = tans[si]
        cosang = e_tan[:, 0] * w_tan[:, 0] + e_tan[:, 1] * w_tan[:, 1]
        along = cosang >= 0.0
        aligned = np.abs(cosang) >= cos_tol

        richt = wkd["richt"][wi]
        dir_ok = (richt == RICHT_BOTH) | ((richt == RICHT_FORWARD) & along) | (
            (richt == RICHT_BACKWARD) & ~along)
        good = aligned & dir_ok
        if not good.any():
            continue
        si, wi, dist, cosang = si[good], wi[good], dist[good], cosang[good]

        e_idx = sample_edge[si]
        en = edge_name_id[e_idx]
        wn = wkd_name_id[wi]
        both = (en > 0) & (wn > 0)
        name_state = np.where(both & (en == wn), 2, np.where(both, 0, 1)).astype(np.int64)
        weight = _NAME_WEIGHT[name_state]

        speeds = w_speed[wi]
        key = e_idx * 256 + speeds
        # Deterministic ordering inside a (edge, speed) group: nearest first,
        # then lowest WVK_ID, then lowest WKD rowid.
        order = np.lexsort((wkd["rowid"][wi], wkd["wvk"][wi], dist, key))
        key_s = key[order]
        starts_idx = np.flatnonzero(np.concatenate(([True], key_s[1:] != key_s[:-1])))
        grp_weight = np.add.reduceat(weight[order], starts_idx)
        head = starts_idx  # first row of every group = its representative
        g_edge = e_idx[order][head]
        g_speed = speeds[order][head]
        g_dist = dist[order][head]
        g_cos = np.abs(cosang[order][head])
        g_wi = wi[order][head]
        g_name = name_state[order][head]

        edge_weight = np.zeros(stop - start, dtype=np.float64)
        np.add.at(edge_weight, g_edge - start, grp_weight)

        # Winner per edge: most weight, then nearest, then lowest WVK_ID/rowid.
        pick = np.lexsort((wkd["rowid"][g_wi], wkd["wvk"][g_wi], g_dist, -grp_weight, g_edge))
        ge_sorted = g_edge[pick]
        firsts = np.flatnonzero(np.concatenate(([True], ge_sorted[1:] != ge_sorted[:-1])))
        w_pick = pick[firsts]
        win_edge = g_edge[w_pick]
        win_speed = g_speed[w_pick]
        win_wi = g_wi[w_pick]

        d_term = 1.0 - np.minimum(g_dist[w_pick], radius) / radius
        ang = np.degrees(np.arccos(np.clip(g_cos[w_pick], 0.0, 1.0)))
        h_term = 1.0 - np.minimum(ang, heading_tol) / heading_tol
        n_term = _NAME_CONF[g_name[w_pick]]
        r_term = wkd["reliability"][win_wi].astype(np.float64)
        share = grp_weight[w_pick] / np.maximum(edge_weight[win_edge - start], 1e-9)
        conf = 0.35 * d_term + 0.25 * h_term + 0.20 * n_term + 0.10 * r_term + 0.10 * share

        best_speed[win_edge] = win_speed.astype(np.uint8)
        best_conf[win_edge] = conf.astype(np.float32)
        best_row[win_edge] = wkd["rowid"][win_wi]
        best_wkd_idx[win_edge] = win_wi

        if (start // chunk) % 5 == 0 or stop == n_edges:
            log.info("matched %d/%d edges (%.0f%%, %.1fs elapsed)",
                     stop, n_edges, 100.0 * stop / max(n_edges, 1), time.perf_counter() - t0)

    # ---- assemble the output ------------------------------------------------
    legal = class_defaults(npz, side)
    source = np.full(n_edges, SRC_CLASS, dtype=np.uint8)
    osm = np.asarray(npz["edge_maxspeed"], dtype=np.uint8)
    has_osm = osm > 0
    legal[has_osm] = osm[has_osm]
    source[has_osm] = SRC_OSM
    has_wkd = best_speed > 0
    legal[has_wkd] = best_speed[has_wkd]
    source[has_wkd] = SRC_WKD

    advisory = np.zeros(n_edges, dtype=np.uint8)
    osm_adv = np.asarray(npz["edge_advisory"], dtype=np.uint8)
    advisory[osm_adv > 0] = osm_adv[osm_adv > 0]
    if signs is not None and "advisory_sign" in signs:
        sign_adv = np.asarray(signs["advisory_sign"], dtype=np.uint8)
        if len(sign_adv) == n_edges:
            advisory[sign_adv > 0] = sign_adv[sign_adv > 0]
    if has_wkd.any():
        w_adv = np.zeros(n_edges, dtype=np.uint8)
        matched = best_wkd_idx >= 0
        w_adv[matched] = wkd["advisory"][best_wkd_idx[matched]]
        advisory[w_adv > 0] = w_adv[w_adv > 0]

    if (legal == 0).any():
        raise AssertionError("legal_speed contains zeros; the class default table is incomplete")
    return {
        "legal_speed": legal,
        "speed_source": source,
        "speed_conf": best_conf,
        "advisory": advisory,
        "wkd_row": best_row,
    }


def class_defaults(npz: dict, side: dict) -> np.ndarray:
    """Fallback limit per directed edge from the OSM highway class."""
    codes = side.get("highway_codes", {})
    table = np.full(max(codes.values(), default=0) + 1, 50, dtype=np.uint8)
    for name, code in codes.items():
        table[code] = CLASS_DEFAULT.get(name, 50)
    hw = np.asarray(npz["edge_highway"], dtype=np.int64)
    hw = np.clip(hw, 0, len(table) - 1)
    return table[hw]


# ---------------------------------------------------------------------------
# Report and driver
# ---------------------------------------------------------------------------


def report(npz: dict, side: dict, out: dict[str, np.ndarray], limit: int = 12) -> str:
    """Human readable match report (markdown)."""
    n = len(out["legal_speed"])
    src = out["speed_source"]
    names = side.get("names", [""])
    edge_name = np.asarray(npz["edge_name"], dtype=np.int64)
    lines = ["# Speed limit match report", "",
             f"Directed edges: **{n}**", ""]

    lines += ["## Source", "", "| source | edges | share |", "| --- | ---: | ---: |"]
    for code, label in ((SRC_WKD, "WKD match"), (SRC_OSM, "OSM maxspeed"),
                        (SRC_CLASS, "class default"), (SRC_UNKNOWN, "unknown")):
        k = int((src == code).sum())
        lines.append(f"| {label} | {k} | {100.0 * k / max(n, 1):.1f} % |")
    conf = out["speed_conf"][src == SRC_WKD]
    if len(conf):
        lines += ["", f"Mean WKD confidence: **{conf.mean():.3f}**, "
                      f"median {np.median(conf):.3f}, "
                      f"share above 0.8: {100.0 * (conf > 0.8).mean():.1f} %"]

    lines += ["", "## Legal limit distribution", "", "| km/h | edges | share |", "| ---: | ---: | ---: |"]
    vals, counts = np.unique(out["legal_speed"], return_counts=True)
    for v, c in zip(vals, counts):
        lines.append(f"| {int(v)} | {int(c)} | {100.0 * c / max(n, 1):.1f} % |")

    osm = np.asarray(npz["edge_maxspeed"], dtype=np.int64)
    both = (src == SRC_WKD) & (osm > 0)
    diff = both & (osm != out["legal_speed"].astype(np.int64))
    lines += ["", "## WKD vs OSM", "",
              f"Edges with both a WKD match and an OSM tag: **{int(both.sum())}**",
              f"Disagreements: **{int(diff.sum())}** "
              f"({100.0 * diff.sum() / max(both.sum(), 1):.1f} % of those)"]
    if diff.any():
        idx = np.flatnonzero(diff)
        gap = np.abs(osm[idx] - out["legal_speed"][idx].astype(np.int64))
        worst = idx[np.argsort(-gap, kind="stable")[:limit]]
        lines += ["", "| road | WKD | OSM | class |", "| --- | ---: | ---: | --- |"]
        inv = {v: k for k, v in side.get("highway_codes", {}).items()}
        for e in worst:
            nm = names[int(edge_name[e])] or "(unnamed)"
            cls = inv.get(int(npz["edge_highway"][e]), "?")
            lines.append(f"| {nm} | {int(out['legal_speed'][e])} | {int(osm[e])} | {cls} |")

    adv = out["advisory"]
    lines += ["", "## Advisory speeds", "",
              f"Edges with an advisory speed: **{int((adv > 0).sum())}**"]
    vals, counts = np.unique(adv[adv > 0], return_counts=True)
    if len(vals):
        lines += ["", "| km/h | edges |", "| ---: | ---: |"]
        lines += [f"| {int(v)} | {int(c)} |" for v, c in zip(vals, counts)]
    lines.append("")
    return "\n".join(lines)


def cache_file(bbox=None) -> Path:
    p = ensure_dirs()
    return p.cache / ("speeds_bbox.npz" if bbox else "speeds.npz")


def load(bbox=None) -> dict[str, np.ndarray]:
    with np.load(cache_file(bbox)) as z:
        return {k: z[k] for k in z.files}


def run(bbox=None) -> None:
    """Match WKD speed limits onto graph edges and write data/cache/speeds.npz."""
    from . import graph as graph_mod

    p = ensure_dirs()
    npz, side = graph_mod.load(bbox)
    signs = None
    sign_file = p.cache / ("signs_bbox.npz" if bbox else "signs.npz")
    if sign_file.exists():
        with np.load(sign_file) as z:
            signs = {k: z[k] for k in z.files}
        log.info("using sign advisory speeds from %s", sign_file.name)
    t0 = time.perf_counter()
    out = match(npz, side, wkd_path(p.cache), signs=signs)
    dest = cache_file(bbox)
    np.savez(dest, **out)
    md = report(npz, side, out)
    (p.reports / "speed_match.md").write_text(md, encoding="utf-8")
    log.info(
        "speeds written to %s in %.1fs: %d WKD, %d OSM, %d class default",
        dest, time.perf_counter() - t0,
        int((out["speed_source"] == SRC_WKD).sum()),
        int((out["speed_source"] == SRC_OSM).sum()),
        int((out["speed_source"] == SRC_CLASS).sum()),
    )


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
