"""Join nationally mined high-fun stretches into open rides and short loops."""

from __future__ import annotations

import hashlib
import heapq
import json
import logging
from datetime import datetime, timezone

import numpy as np
from pyproj import Transformer

from . import graph, route
from .access import WINDOWS
from .config import ensure_dirs, load_rubric, projected_crs, origins
from .elevation import Sampler

log = logging.getLogger("funroads.linked")


def nearby_paths(csr: route.CSR, cost: np.ndarray, start: int,
                 targets: set[int], max_cost: float = 20000) -> dict[int, list[int]]:
    """One bounded Dijkstra search for all nearby stretch entry points."""
    targets = set(targets)
    if not targets:
        return {}
    dist = {start: 0.0}
    previous: dict[int, tuple[int, int]] = {}
    heap = [(0.0, start)]
    found = {}
    while heap and targets:
        value, node = heapq.heappop(heap)
        if value != dist[node] or value > max_cost:
            continue
        if node in targets:
            path = []
            at = node
            while at != start:
                parent, edge = previous[at]
                path.append(edge)
                at = parent
            found[node] = path[::-1]
            targets.remove(node)
        for k in range(csr.indptr[node], csr.indptr[node + 1]):
            edge = int(csr.edges[k])
            step = float(cost[edge])
            if not np.isfinite(step):
                continue
            other = int(csr.targets[k])
            candidate = value + step
            if candidate <= max_cost and candidate < dist.get(other, np.inf):
                dist[other] = candidate
                previous[other] = (node, edge)
                heapq.heappush(heap, (candidate, other))
    return found


def clean_connector(csr: route.CSR, cost: np.ndarray, npz: dict, scores: dict,
                    outbound: list[int], incoming: list[int],
                    shortest: list[int] | None, max_dull: float,
                    min_fun: float, dull_fun: float = .35,
                    max_retrace: float = .20) -> list[int] | None:
    """Try the cheapest connector, then one that avoids the anchored roads."""
    length, fun, slices = npz["edge_len"], scores["fun"], npz["edge_g0"]
    access = npz.get("edge_access", np.full(len(fun), 255, np.uint8))
    used = set(slices[outbound]) | set(slices[incoming])
    if set(slices[outbound]) & set(slices[incoming]):
        return None

    def valid(connector: list[int]) -> bool:
        if set(slices[connector]) & used or float(length[connector].sum()) > 4000:
            return False
        edges = outbound + connector + incoming
        total = float(length[edges].sum())
        if not 2000 <= total <= 80000 or not int(np.bitwise_and.reduce(access[edges])):
            return False
        dull = (fun[edges] < dull_fun) | scores["excluded"][edges].astype(bool)
        return (float(length[edges][dull].sum()) / total <= max_dull
                and float(np.dot(fun[edges], length[edges])) / total >= min_fun
                # Last: geometry is the slow check. It rejects anchors that are
                # the two carriageways of one road.
                and route.retrace_share(npz, edges) <= max_retrace)

    if shortest is not None and valid(shortest):
        return shortest
    # When the shortest route retraces an anchor, blocking the anchor is enough;
    # blocking its entire route can also remove the only clean approach road.
    blocked = used.copy()
    if shortest is not None and not (set(slices[shortest]) & used):
        blocked.update(slices[shortest])
    alternate_cost = cost.copy()
    alternate_cost[np.isin(slices, list(blocked))] = np.inf
    start = int(npz["edge_v"][outbound[-1]])
    end = int(npz["edge_u"][incoming[0]])
    alternate = nearby_paths(csr, alternate_cost, start, {end}).get(end)
    return alternate if alternate is not None and valid(alternate) else None


def linked_candidates(npz: dict, scores: dict, rubric: dict,
                      areas: list[route.Area]) -> list[dict]:
    """Join two or three distinct stretches; close only chained rides."""
    csr = route.CSR(npz)
    fun, length = scores["fun"], npz["edge_len"]
    access = npz.get("edge_access", np.full(len(fun), 255, np.uint8))
    cost = length.astype(np.float64) * (
        1 + float(rubric["connectors"]["lambda"]) * (1 - fun)
    ) ** float(rubric["connectors"]["gamma"])
    cost[access == 0] = np.inf
    threshold = float(rubric["routing"]["stretch_fun_threshold"])
    bridge_max = float(rubric["routing"]["sprint_bridge_share_max"])
    min_fun = float(rubric["routing"]["linked_min_fun"])
    open_max = float(rubric["routing"]["linked_open_connector_share_max"])
    loop_max = min(float(rubric["routing"]["linked_loop_connector_share_max"]),
                   float(rubric["routing"]["connector_share_max"]))
    quality = {"min_fun": min_fun,
               "dull_fun": float(rubric["routing"]["linked_low_fun_below"]),
               "max_retrace": float(rubric["routing"]["linked_retrace_share_max"])}
    reuse = float(rubric["connectors"]["linked_loop_reuse_penalty"])
    result = []
    for area in areas:
        oriented = []
        qualified = []
        for st in area.stretches:
            directions = []
            if route.sprint_quality(fun[st.edges], length[st.edges], threshold, bridge_max):
                directions.append((st, st.edges))
            back = route.reverse_stretch(npz, st.edges)
            if (back and not scores["excluded"][back].any()
                    and route.sprint_quality(fun[back], length[back], threshold, bridge_max)):
                directions.append((st, back))
            if directions:
                best = max(float(np.dot(fun[edges], length[edges])) for _, edges in directions)
                qualified.append((st, directions, best))
        for _, directions, _ in sorted(
                qualified, key=lambda item: (-item[2], item[0].edges[0]))[:5]:
            oriented.extend(directions)
        pairs = []
        for first, outbound in oriented:
            targets = {}
            endpoint = int(npz["edge_v"][outbound[-1]])
            for j, (second, incoming) in enumerate(oriented):
                if first is second:
                    continue
                node = int(npz["edge_u"][incoming[0]])
                if np.hypot(csr.nx[node] - csr.nx[endpoint],
                            csr.ny[node] - csr.ny[endpoint]) <= 5000:
                    targets.setdefault(node, []).append(j)
            paths = nearby_paths(csr, cost, endpoint, set(targets))
            for node, shortest in paths.items():
                for j in targets[node]:
                    second, incoming = oriented[j]
                    connector = clean_connector(csr, cost, npz, scores, outbound, incoming,
                                                shortest, open_max, **quality)
                    if connector is None:
                        continue
                    edges = outbound + connector + incoming
                    mask = int(np.bitwise_and.reduce(access[edges]))
                    pairs.append((edges, mask, area.idx, (first, second)))
        # Only the strongest local pairs need an expensive alternate return.
        pairs.sort(key=lambda p: (-float((fun[p[0]] * length[p[0]]).sum()), tuple(p[0])))
        triples = []
        for paired, _, area_id, anchors in pairs[:8]:
            endpoint = int(npz["edge_v"][paired[-1]])
            targets = {}
            for st, incoming in oriented:
                if st is anchors[0] or st is anchors[1]:
                    continue
                node = int(npz["edge_u"][incoming[0]])
                if np.hypot(csr.nx[node] - csr.nx[endpoint],
                            csr.ny[node] - csr.ny[endpoint]) <= 5000:
                    targets.setdefault(node, []).append((st, incoming))
            used_slices = set(npz["edge_g0"][paired])
            for node, shortest in nearby_paths(csr, cost, endpoint, set(targets)).items():
                for st, incoming in targets[node]:
                    if used_slices & set(npz["edge_g0"][incoming]):
                        continue
                    connector = clean_connector(csr, cost, npz, scores, paired, incoming,
                                                shortest, open_max, **quality)
                    if connector is None:
                        continue
                    edges = paired + connector + incoming
                    mask = int(np.bitwise_and.reduce(access[edges]))
                    triples.append((edges, mask, area_id, (*anchors, st)))
        triples.sort(key=lambda p: (-float((fun[p[0]] * length[p[0]]).sum()), tuple(p[0])))
        used = set()
        for edges, mask, area_id, anchors in sorted(
                pairs[:8] + triples[:4],
                key=lambda p: (-float((fun[p[0]] * length[p[0]]).sum()), tuple(p[0]))):
            key = tuple(sorted(int(npz["edge_g0"][e]) for e in edges))
            if key in used:
                continue
            used.add(key)
            result.append({"edges": edges, "mask": mask, "area": area_id,
                           "type": "open", "anchors": [st.edges for st in anchors]})
        for edges, _, area_id, anchors in triples[:2] + pairs[:LOOP_PAIRS]:
            loop = close_loop(csr, cost, npz, scores, access, edges,
                              max_dull=loop_max, reuse=reuse, **quality)
            if loop:
                result.append({**loop, "area": area_id, "type": "circuit",
                               "anchors": [st.edges for st in anchors]})
    return result


LOOP_PAIRS = 6


def close_loop(csr: route.CSR, cost: np.ndarray, npz: dict, scores: dict,
               access: np.ndarray, edges: list[int],
               max_return: float = np.inf, max_dull: float = .20,
               min_fun: float = .45, dull_fun: float = .35,
               max_retrace: float = .20, reuse: float = 15.0) -> dict | None:
    """Return to the start on different roads, or None if that would be dull,
    mostly retraced, too long, or never legal in one shared access window."""
    length, fun, g0 = npz["edge_len"], scores["fun"], npz["edge_g0"]
    used = np.isin(g0, g0[edges])
    multiplier = np.where(used, reuse, 1.0)
    end = int(npz["edge_v"][edges[-1]])
    start = int(npz["edge_u"][edges[0]])
    def checked(return_path: list[int] | None) -> dict | None:
        if return_path is None or (end != start and not return_path):
            return None
        if float(length[return_path].sum()) > max_return:
            return None
        if (route.shared_share(edges, return_path, g0, length) > .30
                or route.shared_share(return_path, edges, g0, length) > .30):
            return None
        full = edges + return_path
        full_mask = int(np.bitwise_and.reduce(access[full]))
        total = float(length[full].sum())
        if not full_mask or not 3000 <= total <= 80000:
            return None
        dull = (fun[full] < dull_fun) | scores["excluded"][full].astype(bool)
        share = float(length[full][dull].sum()) / total
        if share > max_dull or float(np.dot(fun[full], length[full])) / total < min_fun:
            return None
        if route.retrace_share(npz, full) > max_retrace:
            return None
        return {"edges": full, "mask": full_mask, "connector_share": share}

    if end == start:
        return checked([])
    # Never start the return by turning round in the road where the chain ends:
    # that is a U-turn at an unverified place, not a loop.
    first_cost = cost.copy()
    first_cost[route.reverse_stretch(npz, [edges[-1]])] = np.inf
    shortest = csr.astar(first_cost, multiplier, end, start)
    accepted = checked(shortest)
    if accepted:
        return accepted
    rejected = np.isin(g0, g0[shortest]) if shortest else np.zeros(len(g0), bool)
    # Block the chain and the rejected return. Chains usually end mid-road, so
    # blocking the rejected return often removes the only exit; then retry
    # with that return merely penalised.
    for blocked in (True, False):
        alternate_cost = cost.copy()
        alternate_cost[rejected] = np.inf if blocked else alternate_cost[rejected] * reuse
        alternate_cost[used] = np.inf
        # ponytail: bound the search to nearby returns; longer alternatives
        # need a measured use case before we pay for a country-wide failed search.
        accepted = checked(nearby_paths(csr, alternate_cost, end, {start},
                                        max_cost=30000).get(start))
        if accepted or not rejected.any():
            return accepted
    return None


def ride_name(anchor_roads: list[str], loop: bool) -> str:
    """Name a ride by its anchors in driving order, so two rides ending on the
    same road stay distinguishable and a connector road never names a ride."""
    names = [n for i, n in enumerate(anchor_roads) if i == 0 or n != anchor_roads[i - 1]]
    base = (" → ".join(names) if len(names) > 1
            else f"{names[0]} ({len(anchor_roads)} stretches)" if names else "Unnamed")
    return base + (" Loop" if loop else " Ride")


def assemble(candidates: list[dict], npz: dict, side: dict, feats: dict,
             scores: dict, rubric: dict, sampler=None) -> dict:
    """Choose distinct rides before expanding their geometry for the catalogue."""
    length, g0 = npz["edge_len"], npz["edge_g0"]
    nx, ny = npz["node_x"], npz["node_y"]
    selected = []
    counts: dict[tuple[int, str], int] = {}

    def box(edges):
        nodes = np.concatenate([npz["edge_u"][edges], npz["edge_v"][edges]])
        return nx[nodes].min(), ny[nodes].min(), nx[nodes].max(), ny[nodes].max()

    def overlap(a: dict, b: dict) -> float:
        """Containment either way by segment, or by geometry so the same road
        driven on its other carriageway is still a duplicate."""
        segments = min(route.shared_share(a["edges"], b["edges"], g0, length),
                       route.shared_share(b["edges"], a["edges"], g0, length))
        ba, bb = a["box"], b["box"]
        if segments > .7 or ba[0] > bb[2] + 25 or bb[0] > ba[2] + 25 \
                or ba[1] > bb[3] + 25 or bb[1] > ba[3] + 25:
            return segments
        return max(segments, min(route.near_share(npz, a["edges"], b["edges"]),
                                 route.near_share(npz, b["edges"], a["edges"])))

    for candidate in sorted(candidates, key=lambda c: (
            -float((scores["fun"][c["edges"]] * length[c["edges"]]).sum()),
            c["area"], c["type"], tuple(c["edges"]))):
        group = candidate["area"], candidate["type"]
        if counts.get(group, 0) >= 2:
            continue
        candidate = {**candidate, "box": box(candidate["edges"])}
        if any(old["type"] == candidate["type"] and overlap(candidate, old) > .7
               for old in selected):
            continue
        selected.append(candidate)
        counts[group] = counts.get(group, 0) + 1
    tf = Transformer.from_crs(projected_crs(), "EPSG:4326", always_xy=True)
    to_rd = Transformer.from_crs("EPSG:4326", projected_crs(), always_xy=True)
    centers = {name: to_rd.transform(*point)
               for name, point in origins().items()}
    rides = []
    for item in selected:
        edges = item["edges"]
        stats = route.circuit_stats(npz, feats, scores, edges, rubric)
        x, y, distance = route.route_geometry(npz, edges)
        keep = np.unique(np.linspace(0, len(x) - 1, min(len(x), 400)).astype(int))
        lon, lat = tf.transform(x[keep], y[keep])
        identifier = hashlib.sha256(np.asarray(edges, dtype="<i8").tobytes()).hexdigest()[:16]
        roads = route.route_roads(npz, side, scores, edges)
        anchor_roads = [
            (route.route_roads(npz, side, scores, anchor) or [{"name": "Unnamed stretch"}])[0]["name"]
            for anchor in item["anchors"]
        ]
        profile_line, seg, elev, curv = route.route_profiles(npz, feats, scores, edges, sampler, profile_max=16)
        midpoint = int(np.searchsorted(distance, distance[-1] / 2))
        rides.append({
            "id": f"linked-{identifier}", "type": item["type"], "area": item["area"],
            # "Loop", not "Circuit": national circuits are a different, 40-120 km product.
            "name": ride_name(anchor_roads, item["type"] == "circuit"),
            "km": stats["km"], "fun_km": stats["fun_km"],
            "connector_share": round(stats["connector_share"], 3),
            "retrace_share": round(route.retrace_share(npz, edges), 3),
            "score": stats["score"], "drive_min": stats["drive_min"],
            "roads": roads,
            "anchor_roads": anchor_roads,
            "climb_m": stats["climb_m"],
            "corner_count": route._corner_count(feats, edges),
            "corners": route.route_corners(npz, feats, edges),
            "stops": route.route_warnings(npz, feats, edges),
            "seg": seg, "elev": elev, "curv": curv,
            "why": route.why_strings(npz, feats, stats, edges,
                                     "Joins scored stretches on a legal route"),
            "distance_km": {name: round(float(np.hypot(
                x[midpoint] - cx, y[midpoint] - cy)) / 1000, 1)
                for name, (cx, cy) in centers.items()},
            "windows": sorted(label for bit, (label, _) in enumerate(WINDOWS)
                              if item["mask"] & (1 << bit)),
            "line": profile_line if projected_crs() == "EPSG:3301" else
                    [[round(float(a), 6), round(float(b), 6)] for a, b in zip(lon, lat)],
        })
    profiles = {}
    nearby = {name: {} for name in centers}
    for name, dim in (("scenic", "scenery"), ("technical", "corners"),
                      ("quiet", "quiet")):
        # Themes sort *completed* rides, never alter road eligibility.
        ordered = sorted((r for r in rides if r["km"] >= 6 and r["score"]["total"] >= 45),
                         key=lambda r: (-r["score"][dim], -r["fun_km"], r["id"]))
        def diverse(items):
            chosen, areas = [], set()
            for item in items:
                if item["area"] not in areas:
                    chosen.append(item["id"])
                    areas.add(item["area"])
                if len(chosen) == 12:
                    break
            return chosen
        profiles[name] = diverse(ordered)
        for center in centers:
            nearby[center][name] = diverse(
                r for r in ordered if r["distance_km"][center] <= 100)
    return {"rides": rides, "profiles": profiles, "nearby_100km": nearby}


def run() -> None:
    p = ensure_dirs()
    bbox = not (p.cache / "scores.npz").exists()
    suffix = "_bbox" if bbox else ""
    npz, side = graph.load(bbox)
    with np.load(p.cache / f"features{suffix}.npz") as z:
        feats = {k: z[k] for k in z.files}
    with np.load(p.cache / f"scores{suffix}.npz") as z:
        scores = {k: z[k] for k in z.files}
    rubric = load_rubric()
    access = npz.get("edge_access", np.full(len(scores["fun"]), 255, np.uint8))
    stretches = []
    seen_masks = set()
    for bit, _ in enumerate(WINDOWS):
        available = (access & (1 << bit)) != 0
        signature = np.packbits(available).tobytes()
        if signature in seen_masks:
            continue
        seen_masks.add(signature)
        stretches += route.find_stretches(
            npz, np.where(available, scores["fun"], 0),
            scores["excluded"].astype(bool), rubric)
    unique = {}
    for st in stretches:
        key = tuple(sorted(int(npz["edge_g0"][e]) for e in st.edges))
        unique.setdefault(key, st)
    areas = route.cluster_areas(list(unique.values()), rubric, min_fun_km=0)
    log.info("linking %d national stretches in %d areas", len(unique), len(areas))
    data = assemble(linked_candidates(npz, scores, rubric, areas),
                    npz, side, feats, scores, rubric, Sampler(p.cache, offline=True))
    source_time = max((p.cache / f"{part}{suffix}.npz").stat().st_mtime
                      for part in ("features", "scores"))
    data["meta"] = {"generated": datetime.fromtimestamp(
        source_time, timezone.utc).isoformat(timespec="seconds"),
        "note": "National high-fun anchors; sampled access windows, not live permission"}
    path = p.cache / f"linked{suffix}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    tmp.replace(path)
    log.info("linked rides written to %s: %d", path, len(data["rides"]))


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
