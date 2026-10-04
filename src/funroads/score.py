"""Apply the fun rubric to every edge.

Each dimension is scored on an absolute piecewise-linear scale taken from
config/fun.yaml, not on a national percentile. That is deliberate: percentiles
would make the flattest country in Europe look hilly, because everything is
judged only against its neighbours. Absolute anchors mean a straight, flat,
busy road scores near zero on its own merits, and the same rubric can later be
pointed at the Eifel without silently changing meaning.

Nothing in here rewards driving over the limit. Corners only count when the
comfortable speed through them is below the legal limit, and the speed
dimension rewards the 60-80 km/h band where a back road flows, not top speed.
"""

from __future__ import annotations

import logging

import numpy as np

from . import graph as graph_mod
from .config import ensure_dirs, load_rubric

log = logging.getLogger("funroads.score")

DIMENSIONS = ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery")


def piecewise(points: list[list[float]], values: np.ndarray) -> np.ndarray:
    """Interpolate an anchor table, clamped flat outside its range."""
    pts = np.asarray(points, dtype=np.float64)
    xs, ys = pts[:, 0], pts[:, 1]
    return np.interp(np.asarray(values, dtype=np.float64), xs, ys).astype(np.float32)


def _straight_score(anchor: dict, share: np.ndarray) -> np.ndarray:
    """Reward a middling share of medium-length straights between corners."""
    lo = float(anchor["ideal_min"])
    hi = float(anchor["ideal_max"])
    below = float(anchor["below"])
    above = float(anchor["above"])
    peak = float(anchor["peak"])
    s = np.asarray(share, dtype=np.float64)
    out = np.full(len(s), peak, dtype=np.float64)
    left = s < lo
    out[left] = below + (peak - below) * (s[left] / max(lo, 1e-9))
    right = s > hi
    out[right] = peak - (peak - above) * np.clip((s[right] - hi) / max(1.0 - hi, 1e-9), 0, 1)
    return out.astype(np.float32)


def _surface_score(npz: dict, feats: dict, rubric: dict) -> np.ndarray:
    """Surface quality seen from a low, stiff car."""
    base_tbl = rubric["surface_base"]
    pen = rubric["low_car_penalties"]
    code_to_key = {
        graph_mod.SURFACE_ASPHALT: "asphalt",
        graph_mod.SURFACE_CONCRETE: "concrete",
        graph_mod.SURFACE_PAVED: "paved",
        # graph.SURFACE_STONES is paving_stones/bricks: the common Dutch klinker
        # road. Bumpy in a stiff 997 but very drivable, and many scenic dike
        # roads are klinker, so it must not be scored like cobblestone.
        graph_mod.SURFACE_STONES: "paving_stones",
        graph_mod.SURFACE_SETT: "sett",
        graph_mod.SURFACE_LOOSE: "unpaved",
    }
    n = len(npz["edge_u"])
    score = np.full(n, float(base_tbl.get("default", 0.6)), dtype=np.float64)
    surf = npz["edge_surface"]
    for code, key in code_to_key.items():
        if key in base_tbl:
            score[surf == code] = float(base_tbl[key])

    # Rough surfaces are worse than the tag alone suggests in a stiff car.
    smooth = npz["edge_smooth"]
    score[smooth == 3] *= 0.85   # intermediate
    score[smooth >= 4] *= 0.6    # bad and worse

    bumps = feats.get("bumps", np.zeros(n, np.int32)).astype(np.float64)
    score *= np.power(float(pen["speed_bump_each"]), np.minimum(bumps, 12))
    calm_way = npz["edge_calm"].astype(bool)
    score[calm_way] *= float(pen["table_each"])

    width = npz["edge_width"]
    score[(width > 0) & (width < 3.0)] *= float(pen["very_narrow_below_3m"])
    score[(width >= 3.0) & (width < 4.0)] *= float(pen["narrow_below_4m"])

    cams = feats.get("cameras", np.zeros(n, np.int32)).astype(np.float64)
    score *= np.power(float(pen["camera_each"]), np.minimum(cams, 6))
    return np.clip(score, 0.0, 1.0).astype(np.float32)


def _exclusions(npz: dict, side: dict, feats: dict, rubric: dict) -> np.ndarray:
    """True where an edge may not be part of a fun stretch."""
    n = len(npz["edge_u"])
    ex = np.zeros(n, dtype=bool)
    hw_names = {v: k for k, v in side["highway_codes"].items()}

    # Loose surfaces never reach the graph, but the code is kept for clarity.
    ex |= npz["edge_surface"] == graph_mod.SURFACE_LOOSE
    # Cobbles shake a 997 to pieces and are never the point of a drive.
    ex |= npz["edge_surface"] == graph_mod.SURFACE_SETT

    # Motorways and trunk roads are connectors only, never fun stretches.
    motorway = (npz["edge_flags"] & graph_mod.F_MOTORWAY) > 0
    ex |= motorway

    # Speed bumps every few hundred metres: a residential rat run.
    length_km = np.maximum(npz["edge_len"] / 1000.0, 1e-4)
    bumps_per_km = feats.get("bumps", np.zeros(n, np.int32)) / length_km
    ex |= bumps_per_km > 3.0

    # Built-up residential streets: 30 km/h, parked cars, children.
    residential = np.zeros(n, dtype=bool)
    for code, name in hw_names.items():
        if name in ("residential", "living_street"):
            residential |= npz["edge_highway"] == code
    busy = feats.get("busyness", np.zeros(n, np.float32))
    ex |= residential & (busy > 0.45)
    ex |= feats["legal_speed"] <= 30
    # Short junction stubs are NOT excluded: they score low on their own (no
    # room for a corner) but must stay legal to cross, or every crossroad ends
    # a stretch. find_stretches bridges them within stretch_split_gap_m.
    return ex


def compute(npz: dict, side: dict, feats: dict) -> dict[str, np.ndarray]:
    rubric = load_rubric()
    anchors = rubric["anchors"]
    weights = rubric["weights"]
    n = len(npz["edge_u"])

    parts: dict[str, np.ndarray] = {}
    # Curviness (sustained heading change per km) is the backbone; engaged
    # corners (bends tight enough to demand braking) sharpen it. Neither alone
    # is enough: curviness misses how hard each bend is, engagement misses the
    # flowing sweepers in between.
    curviness = piecewise(anchors["curviness"]["points"], feats["head_per_km"])
    engaged = piecewise(anchors["corners"]["points"], feats["engaged_per_km"])
    blend = rubric.get("corner_blend", {"curviness": 0.55, "engaged": 0.45})
    parts["corners"] = (float(blend["curviness"]) * curviness
                        + float(blend["engaged"]) * engaged).astype(np.float32)

    # Flow blends three things: how often you must stop, whether the corners
    # link into esses, and whether the straights between them are useful.
    length_km = np.maximum(npz["edge_len"].astype(np.float64) / 1000.0, 1e-4)
    stops = feats.get("controls", np.zeros(n, np.int32)).astype(np.float64)
    roundabout = (npz["edge_flags"] & graph_mod.F_ROUNDABOUT) > 0
    stops_per_km = (stops + roundabout) / length_km
    flow_stops = piecewise(anchors["flow"]["points"], stops_per_km)
    flow_esses = piecewise(anchors["esses"]["points"], feats["esses"])
    flow_straight = _straight_score(anchors["straights"], feats["straight_share"])
    parts["flow"] = (0.45 * flow_stops + 0.35 * flow_esses + 0.20 * flow_straight).astype(np.float32)

    parts["quiet"] = piecewise(anchors["quiet"]["points"], feats.get("busyness", np.zeros(n, np.float32)))
    parts["speed"] = piecewise(anchors["speed"]["points"], feats["legal_speed"])

    relief = (feats["climb_m"] + feats["descent_m"]) / length_km
    elev_relief = piecewise(anchors["elevation"]["points"], relief)
    elev_grade = piecewise(anchors["grade"]["points"], feats["max_grade"])
    parts["elevation"] = np.maximum(elev_relief, elev_grade)
    # Where the elevation model gave nothing, stay neutral instead of scoring 0,
    # so missing coverage cannot look like flat ground.
    no_elev = feats.get("elev_ok", np.ones(n, np.uint8)) == 0
    if no_elev.any():
        parts["elevation"][no_elev] = float(np.median(parts["elevation"][~no_elev])) if (~no_elev).any() else 0.0

    parts["surface"] = _surface_score(npz, feats, rubric)
    parts["scenery"] = piecewise(anchors["scenery"]["points"], feats["scenery"])

    total = np.zeros(n, dtype=np.float64)
    wsum = 0.0
    for dim in DIMENSIONS:
        w = float(weights[dim])
        wsum += w
        total += w * parts[dim].astype(np.float64)
    total /= max(wsum, 1e-9)

    excluded = _exclusions(npz, side, {**feats, "legal_speed": feats["legal_speed"]}, rubric)
    fun = np.where(excluded, 0.0, total).astype(np.float32)

    out = {f"score_{k}": v for k, v in parts.items()}
    out["fun"] = fun
    out["excluded"] = excluded.astype(np.uint8)
    kept = fun[~excluded]
    pcts = np.percentile(kept, [50, 90, 99]) if kept.size else np.zeros(3)
    log.info(
        "scored %d edges: %.1f%% excluded, fun p50 %.3f p90 %.3f p99 %.3f",
        n, 100.0 * float(excluded.mean()), pcts[0], pcts[1], pcts[2],
    )
    return out


def run() -> None:
    p = ensure_dirs()
    bbox = not (p.cache / "features.npz").exists()
    npz, side = graph_mod.load(bbox)
    path = p.cache / ("features_bbox.npz" if bbox else "features.npz")
    with np.load(path) as z:
        feats = {k: z[k] for k in z.files}
    out = compute(npz, side, feats)
    out_path = p.cache / ("scores_bbox.npz" if bbox else "scores.npz")
    np.savez(out_path, **out)
    log.info("scores written to %s", out_path.name)


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
