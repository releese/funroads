"""Rebuild only existing circuits from cached graph paths, preserving route IDs.

Run from the repository with PYTHONPATH=src. Outputs are staged here; --publish
replaces routes/evidence only after all checks. No fetch or scoring; sprints and
linked rides stay unchanged. Old candidate mining recovers Dutch graph paths.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
from pyproj import Transformer

from funroads import config, estonia, graph, route
from funroads.access import WINDOWS
from funroads.elevation import Sampler

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                    encoding="utf-8")


def original_candidates(country, npz, scores, rubric, published):
    """Replay pre-cleanup construction solely to recover Dutch path evidence."""
    csr = route.CSR(npz)
    clean = route.clean_circuit_spurs
    route.clean_circuit_spurs = lambda _, edges: edges
    try:
        if country == "ee":
            stretches = route.find_stretches(npz, scores["fun"], scores["excluded"].astype(bool), rubric)
            areas = route.cluster_areas(stretches, rubric)
            cost = npz["edge_len"].astype(float) * (
                1 + rubric["connectors"]["lambda"] * (1 - scores["fun"])
            ) ** rubric["connectors"]["gamma"]
            return route.build_variants(csr, areas, cost, npz, rubric)
        fun = scores["fun"].astype(float)
        base = npz["edge_len"].astype(float) * (
            1 + float(rubric["connectors"]["lambda"]) * (1 - fun)
        ) ** float(rubric["connectors"]["gamma"])
        access = npz["edge_access"]
        tf = Transformer.from_crs("EPSG:4326", config.projected_crs(), always_xy=True)
        wanted = set()
        for item in published:
            x, y = tf.transform(item["start"]["lon"], item["start"]["lat"])
            node = int(np.argmin((csr.nx - x) ** 2 + (csr.ny - y) ** 2))
            wanted.add(node)
        circuits, seen = [], set()
        for bit, _ in enumerate(WINDOWS):
            opened = (access & (1 << bit)) != 0
            signature = np.packbits(opened).tobytes()
            if signature in seen:
                continue
            seen.add(signature)
            subset = route.find_stretches(npz, np.where(opened, fun, 0.0),
                                          scores["excluded"].astype(bool), rubric)
            areas = route.cluster_areas(subset, rubric)
            # Only reconstruct the ten published areas, not thousands of
            # unrelated candidates. Match paths, not window-dependent area IDs.
            areas = [area for area in areas if area.best.start_node in wanted]
            circuits.extend(route.build_variants(csr, areas, np.where(opened, base, np.inf),
                                                  npz, rubric))
        return list({tuple(c.edges): c for c in circuits}.values())
    finally:
        route.clean_circuit_spurs = clean


def rebuild(country):
    config.select_country(country)
    cache = config.paths().cache
    old = json.loads((HERE / "before" / country / "routes.json").read_text(encoding="utf-8"))
    doc = copy.deepcopy(old)
    npz, side = graph.load()
    with np.load(cache / "features.npz") as z:
        feats = dict(z)
    with np.load(cache / "scores.npz") as z:
        scores = dict(z)
    rubric = config.load_rubric()
    candidates = original_candidates(country, npz, scores, rubric, old["routes"])
    sampler = estonia.TerrainSampler() if country == "ee" else Sampler(cache, offline=True)
    evidence, selected, changes = [], [], []
    for item in old["routes"]:
        area_idx = int(item["area_id"].split("-")[1]) - 1
        matching = ([c for c in candidates if c.area.idx == area_idx]
                    if country == "ee" else candidates)
        matches = []
        for c in matching:
            line, *_ = route.route_profiles(npz, feats, scores, c.edges, None)
            if line == item["line"]:
                matches.append(c)
        if len(matches) != 1:
            raise ValueError(f"Cannot uniquely reconstruct {country}:{item['id']}")
        original = copy.copy(matches[0])
        original.area = copy.copy(original.area)
        original.area.idx = area_idx
        edges = route.clean_circuit_spurs(npz, original.edges)
        if not edges:
            raise ValueError(f"Published circuit collapsed: {item['id']}")
        checks = estonia.check_path(npz, edges, True)
        cleaned = copy.copy(original)
        cleaned.edges = edges
        if edges != original.edges:
            cleaned.out_and_back = route.retrace_share(npz, edges) > route.OUT_AND_BACK_SHARE
        stats = route.circuit_stats(npz, feats, scores, edges, rubric)
        if stats["km"] < route.SOFT_MIN_KM or stats["connector_share"] > route.MAX_CONNECTOR_SHARE:
            raise ValueError(f"Cleaned circuit fails quality: {item['id']}")
        if country == "ee" and not estonia.is_genuine_circuit(npz, edges):
            raise ValueError(f"Cleaned circuit fails Estonia shape gate: {item['id']}")
        assert int(npz["edge_u"][edges[0]]) == int(npz["edge_u"][original.edges[0]])
        assert route.clean_circuit_spurs(npz, edges) == edges
        selected.append((cleaned, stats))
        evidence.append({"family": "circuit", "id": item["id"], **checks})
        changes.append({"id": item["id"], "removed_edges": len(original.edges) - len(edges),
                        "before_km": item["km"], "after_km": stats["km"],
                        "before_min": item["drive_min"], "after_min": stats["drive_min"],
                        "before_retrace": route.retrace_share(npz, original.edges),
                        "after_retrace": route.retrace_share(npz, edges)})
    rebuilt = route.assemble(selected, [], npz, side, feats, scores, rubric, sampler,
                             old["meta"]["generated"])["routes"]
    for item, new, change in zip(doc["routes"], rebuilt, changes):
        assert item["id"] == new["id"] and item["start"] == new["start"]
        if not change["removed_edges"]:
            continue
        if country == "ee":
            new["distance_km"] = item["distance_km"]
            new["why"].extend(item["why"][-3:])
            new["retrace_share"] = round(change["after_retrace"], 3)
        item.clear()
        item.update(new)
    assert doc["sprints"] == old["sprints"]
    assert [(r["id"], r["name"], r["start"]) for r in doc["routes"]] == [
        (r["id"], r["name"], r["start"]) for r in old["routes"]]
    if country == "ee":
        doc["meta"]["pipeline_sha256"]["route.py"] = sha(ROOT / "src/funroads/route.py")
        doc["meta"]["circuit_cleanup"] = {
            "date": "2026-10-04", "scope": "existing circuits only, no reranking",
            "near_retrace_min": .80, "radius_m": 25,
        }
        before_evidence = json.loads((HERE / "before/ee/route-evidence.json").read_text())
        replacements = {r["id"]: r for r in evidence}
        evidence = [replacements[r["id"]] if r["family"] == "circuit" else r
                    for r in before_evidence]
        write(HERE / "staged/ee/route-evidence.json", evidence)
    else:
        write(HERE / "staged/nl/route-evidence.json", evidence)
    write(HERE / "staged" / country / "routes.json", doc)
    print(country, json.dumps(changes), flush=True)
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    baseline = json.loads((HERE / "baseline-hashes.json").read_text())
    for file, expected in baseline.items():
        assert sha(ROOT / file) == expected, f"Input changed: {file}"
    changes = {country: rebuild(country) for country in ("ee", "nl")}
    write(HERE / "changes.json", changes)
    if args.publish:
        # Linked rides and sprints are intentionally left unchanged.
        for country, cache in [("nl", ROOT / "data/cache"), ("ee", ROOT / "data/ee/cache")]:
            for name in ["routes.json"] + (["route-evidence.json"] if country == "ee" else []):
                source = HERE / "staged" / country / name
                target = cache / name
                temporary = target.with_suffix(".circuit-cleanup.tmp")
                temporary.write_bytes(source.read_bytes())
                temporary.replace(target)
        for file, expected in baseline.items():
            if not file.endswith("/routes.json"):
                assert sha(ROOT / file) == expected, f"Untouched input changed: {file}"
        print("Published circuit-only rebuild. Sprints, linked rides and graph/scoring inputs unchanged.")


if __name__ == "__main__":
    main()
