"""Compare a mined sprint with short legal loops anchored on that same road.

This is an on-demand country-wide operation. The 100 km home radius is only
used in the report view, never to filter the shared national stretch miner.
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from . import graph, route
from .access import WINDOWS
from .config import load_rubric, paths


def compare(npz: dict, side: dict, feats: dict, scores: dict,
            road_name: str, rubric: dict) -> list[dict]:
    if road_name not in side["names"]:
        return []
    name_id = side["names"].index(road_name)
    fun = scores["fun"]
    access = npz.get("edge_access", np.full(len(fun), 255, np.uint8))
    length = npz["edge_len"]
    lam = float(rubric["connectors"]["lambda"])
    gamma = float(rubric["connectors"]["gamma"])
    base = length.astype(np.float64) * (1 + lam * (1 - fun)) ** gamma
    csr = route.CSR(npz)
    out = []
    seen: set[tuple[int, ...]] = set()
    for bit, _ in enumerate(WINDOWS):
        open_edges = (access & (1 << bit)) != 0
        available = np.where(open_edges, fun, 0)
        stretches = route.find_stretches(npz, available, scores["excluded"].astype(bool), rubric)
        candidates = [s for s in stretches if any(npz["edge_name"][e] == name_id for e in s.edges)]
        if not candidates:
            continue
        # Stretch exclusions are not connector exclusions: 30 km/h urban
        # streets can make a short, legal return, but count as dull distance.
        cost = np.where(open_edges, base, np.inf)
        for stretch in candidates:
            key = tuple(sorted(int(npz["edge_g0"][e]) for e in stretch.edges))
            if key in seen:
                continue
            seen.add(key)
            reverse = route.reverse_stretch(npz, stretch.edges)
            if not reverse:
                continue
            if (np.any(scores["fun"][reverse] < rubric["routing"]["stretch_fun_threshold"])
                    or np.any(scores["excluded"][reverse])):
                continue
            mask = int(np.bitwise_and.reduce(access[stretch.edges + reverse]))
            if not mask & (1 << bit):
                continue
            alternatives = []
            for driven in (stretch.edges, reverse):
                mult = np.ones(len(cost), dtype=np.float64)
                mult[driven + route.reverse_stretch(npz, driven)] = 15.0
                back = csr.astar(cost, mult, int(npz["edge_v"][driven[-1]]),
                                 int(npz["edge_u"][driven[0]]))
                if not back:
                    continue
                if route.shared_share(driven, back, npz["edge_g0"], length) > .30:
                    continue
                full = driven + back
                stats = route.circuit_stats(npz, feats, scores, full, rubric)
                if not 2 <= stats["km"] <= 25 or stats["connector_share"] > .45:
                    continue
                from pyproj import Transformer

                tf = Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True)
                x, y, _ = route.route_geometry(npz, full)
                if len(x) > 400:
                    keep = np.unique(np.linspace(0, len(x) - 1, 400).astype(int))
                    x, y = x[keep], y[keep]
                lon, lat = tf.transform(x, y)
                path_mask = int(np.bitwise_and.reduce(access[full]))
                alternatives.append({
                    "type": "short_circuit", "km": stats["km"],
                    "fun_km": stats["fun_km"], "score": stats["score"]["total"],
                    "connector_share": round(stats["connector_share"], 2),
                    "roads": route.route_roads(npz, side, scores, full),
                    "line": [[round(float(a), 6), round(float(b), 6)]
                             for a, b in zip(lon, lat)],
                    "windows": sorted(window for i, (window, _) in enumerate(WINDOWS)
                                      if path_mask & (1 << i)),
                })
            alternatives.sort(key=lambda a: (a["connector_share"], -a["fun_km"], a["km"]))
            out.append({
                "road": road_name, "anchor_km": round(stretch.length_m / 1000, 2),
                "sprint_windows": sorted(window for i, (window, _) in enumerate(WINDOWS)
                                         if mask & (1 << i)),
                "short_circuits": alternatives,
            })
    return sorted(out, key=lambda item: (-item["anchor_km"], item["road"]))


def run(road_name: str) -> None:
    p = paths()
    npz, side = graph.load()
    with np.load(p.cache / "features.npz") as z:
        feats = {k: z[k] for k in ("legal_speed", "controls", "climb_m")}
    with np.load(p.cache / "scores.npz") as z:
        scores = {k: z[k] for k in z.files}
    results = compare(npz, side, feats, scores, road_name, load_rubric())
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("road", help="OSM road name to compare nationally")
    run(parser.parse_args().road)
