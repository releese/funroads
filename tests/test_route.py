"""Routing correctness and determinism tests."""

from __future__ import annotations

import heapq
import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from funroads import config, graph, route
from funroads.config import load_rubric, paths


def _bbox_inputs():
    p = paths()
    npz, side = graph.load(True)
    with np.load(p.cache / "features_bbox.npz") as z:
        feats = {k: z[k] for k in z.files}
    with np.load(p.cache / "scores_bbox.npz") as z:
        scores = {k: z[k] for k in z.files}
    return npz, side, feats, scores


def _dijkstra_cost(csr: route.CSR, cost: np.ndarray, start: int, goal: int) -> float:
    dist = {start: 0.0}
    heap = [(0.0, start)]
    while heap:
        value, node = heapq.heappop(heap)
        if value != dist[node]:
            continue
        if node == goal:
            return value
        for k in range(csr.indptr[node], csr.indptr[node + 1]):
            edge = int(csr.edges[k])
            target = int(csr.targets[k])
            candidate = value + float(cost[edge])
            if candidate < dist.get(target, np.inf):
                dist[target] = candidate
                heapq.heappush(heap, (candidate, target))
    return np.inf


def test_astar_matches_dijkstra_on_bbox_random_pairs():
    npz, _, _, scores = _bbox_inputs()
    csr = route.CSR(npz)
    rubric = load_rubric()
    fun = scores["fun"].astype(np.float64)
    cost = npz["edge_len"].astype(np.float64) * (
        1.0 + float(rubric["connectors"]["lambda"]) * (1.0 - fun)
    ) ** float(rubric["connectors"]["gamma"])
    mult = np.ones(len(cost))
    rng = np.random.default_rng(997)
    checked = 0
    for start, goal in rng.integers(0, csr.n_nodes, size=(30, 2)):
        expected = _dijkstra_cost(csr, cost, int(start), int(goal))
        path = csr.astar(cost, mult, int(start), int(goal))
        actual = float(cost[path].sum()) if path else np.inf
        if start == goal:
            actual = 0.0
        assert np.isclose(actual, expected)
        checked += np.isfinite(expected)
    assert checked >= 10


def test_bbox_stretch_extraction_is_stable_and_nontrivial():
    npz, side, _, scores = _bbox_inputs()
    stretches = route.find_stretches(
        npz, scores["fun"], scores["excluded"].astype(bool), load_rubric()
    )
    assert stretches
    assert min(stretch.length_m for stretch in stretches) >= 1000.0
    names = {
        road["name"]
        for stretch in stretches
        for road in route.route_roads(npz, side, scores, stretch.edges)
    }
    assert names & {"Sint Aagtendijk", "Zeedijk", "Reyndersweg"}


def _chain(stub_fun: float, stub_excluded: bool, stub_len: float = 20.0):
    """0 -600m fun- 1 -stub- 2 -600m fun- 3, one direction only."""
    npz = {
        "edge_u": np.array([0, 1, 2], np.int32),
        "edge_v": np.array([1, 2, 3], np.int32),
        "edge_len": np.array([600., stub_len, 600.]),
        "edge_rev": np.zeros(3, np.uint8),
        "edge_g0": np.array([0, 2, 4], np.int64),
        "node_x": np.array([0., 600., 620., 1220.]),
        "node_y": np.zeros(4),
    }
    fun = np.array([.7, stub_fun, .7])
    excluded = np.array([False, stub_excluded, False])
    return npz, fun, excluded


def test_stretch_bridges_a_short_legal_junction_stub():
    npz, fun, excluded = _chain(.4, False)
    stretches = route.find_stretches(npz, fun, excluded, load_rubric())
    assert [s.edges for s in stretches] == [[0, 1, 2]]


def test_stretch_never_bridges_excluded_closed_or_long_gaps():
    rubric = load_rubric()
    npz, fun, excluded = _chain(.4, True)
    assert route.find_stretches(npz, fun, excluded, rubric) == []
    npz, fun, excluded = _chain(0.0, False)  # closed in this access window
    assert route.find_stretches(npz, fun, excluded, rubric) == []
    gap = float(rubric["routing"]["stretch_split_gap_m"])
    npz, fun, excluded = _chain(.4, False, stub_len=gap + 1)
    assert route.find_stretches(npz, fun, excluded, rubric) == []


def test_reverse_needs_fun_only_where_the_way_out_was_fun():
    forward, reverse = [0, 1, 2], [5, 4, 3]
    fun = np.array([.7, .4, .7, .7, .3, .7])
    excluded = np.zeros(6, bool)
    assert route.reverse_is_fun(forward, reverse, fun, excluded, .55)
    fun[3] = .5
    assert not route.reverse_is_fun(forward, reverse, fun, excluded, .55)
    fun[3] = .7
    excluded[4] = True
    assert not route.reverse_is_fun(forward, reverse, fun, excluded, .55)


def test_sprint_quality_requires_average_and_bounded_bridge_length():
    length = np.array([600., 200., 600.])
    assert route.sprint_quality(np.array([.7, .4, .7]), length, .55, .25)
    assert not route.sprint_quality(np.array([.56, .1, .56]), length, .55, .25)
    assert not route.sprint_quality(np.array([.9, .4, .9]), np.array([600., 500., 600.]), .55, .25)


def test_reuse_penalty_avoids_same_road_in_reverse():
    npz = {
        "edge_u": np.array([0, 1, 2, 1, 2, 3, 3, 4], np.int32),
        "edge_v": np.array([1, 2, 3, 0, 1, 2, 4, 0], np.int32),
        "edge_len": np.array([1, 1, 1, 1, 1, 1, 1.1, 1.1], np.float64),
        "edge_g0": np.array([0, 1, 2, 0, 1, 2, 6, 7], np.int64),
        "edge_rev": np.zeros(8, np.uint8),
        "node_x": np.array([0, 1, 2, 3, 1], np.float64),
        "node_y": np.array([0, 0, 0, 0, 1], np.float64),
    }
    anchor = route.Stretch([0], 1.0, 1.0, (0.0, 0.0), 0, 1)
    far = route.Stretch([2], 1.0, 1.0, (3.0, 0.0), 2, 3)
    area = route.Area(0, [anchor, far], (1.5, 0.0), 2.0)
    circuit = route.build_circuit(
        route.CSR(npz), area, npz["edge_len"], np.ones(8), npz, load_rubric()
    )
    assert circuit is not None
    assert circuit.edges[:3] == [0, 1, 2]
    assert circuit.edges[3:] == [6, 7]
    assert not circuit.out_and_back


def _circuit_graph(nodes, pairs, shapes=None, slices=None):
    """Metric geometry for circuit cleanup, including separate carriageways."""
    shapes = shapes or [[nodes[u], nodes[v]] for u, v in pairs]
    offsets = np.concatenate([[0], np.cumsum([len(s) for s in shapes])])
    xy = np.asarray([point for shape in shapes for point in shape], dtype=float)
    return {
        "edge_u": np.array([u for u, _ in pairs]),
        "edge_v": np.array([v for _, v in pairs]),
        "edge_g0": np.array(slices) if slices is not None else offsets[:-1],
        "edge_g1": offsets[1:],
        "edge_rev": np.zeros(len(pairs), np.uint8),
        "edge_len": np.array([np.hypot(*np.diff(np.asarray(s), axis=0).T).sum()
                              for s in shapes]),
        "coord_x": xy[:, 0], "coord_y": xy[:, 1],
        "node_x": np.array([x for x, _ in nodes], dtype=float),
        "node_y": np.array([y for _, y in nodes], dtype=float),
    }


@pytest.mark.parametrize("country", ["nl", "ee"])
def test_circuit_cleanup_removes_nested_exact_spurs_in_both_countries(country):
    original_country = config.COUNTRY
    try:
        config.select_country(country)
        g = _circuit_graph(
            [(0, 0), (1000, 0), (1200, 0), (1400, 0), (1000, 1000)],
            [(0, 1), (1, 2), (2, 3), (3, 2), (2, 1), (1, 4), (4, 0)])
        g["edge_g0"][[3, 4]] = g["edge_g0"][[2, 1]]
        edges = list(range(7))
        assert route.clean_circuit_spurs(g, edges) == [0, 5, 6]
        assert edges == list(range(7))
    finally:
        config.select_country(original_country)


def test_circuit_cleanup_removes_a_tail_with_separate_carriageways():
    # The small divided section prevents exact reverse-pair cancellation.
    nodes = [(0, 0), (1000, 0), (3000, 0), (4000, 0), (1000, 2000)]
    pairs = [(0, 1), (1, 2), (2, 3), (3, 2), (2, 1), (1, 4), (4, 0)]
    shapes = [[nodes[u], nodes[v]] for u, v in pairs]
    shapes[4] = [nodes[2], (2900, 10), (1100, 10), nodes[1]]
    g = _circuit_graph(nodes, pairs, shapes)
    g["edge_g0"][3] = g["edge_g0"][2]
    edges = route.clean_circuit_spurs(g, list(range(7)))
    assert edges == [0, 5, 6]
    assert route.clean_circuit_spurs(g, edges) == edges
    assert g["edge_v"][edges[-1]] == g["edge_u"][edges[0]]


def test_circuit_cleanup_preserves_real_loops_and_start_access():
    nodes = [(0, 0), (1000, 0), (2000, 0), (2000, 1000), (1000, 1000)]
    # A shared junction between two real loops is not a reason to delete one.
    pairs = [(0, 1), (1, 2), (2, 3), (3, 1), (1, 4), (4, 0)]
    g = _circuit_graph(nodes, pairs)
    assert route.clean_circuit_spurs(g, list(range(6))) == list(range(6))
    # Preserve an access stem when the specified start lies outside the loop.
    pairs = [(0, 1), (1, 2), (2, 3), (3, 1), (1, 0)]
    g = _circuit_graph(nodes, pairs)
    assert route.clean_circuit_spurs(g, list(range(5))) == list(range(5))


def test_circuit_cleanup_rejects_gaps_and_collapsed_out_and_backs():
    g = _circuit_graph([(0, 0), (1000, 0)], [(0, 1), (1, 0)])
    g["edge_g0"][1] = g["edge_g0"][0]
    assert route.clean_circuit_spurs(g, [0, 1]) == []
    with pytest.raises(ValueError, match="continuous and closed"):
        route.clean_circuit_spurs(g, [0])
    anchor = route.Stretch([0], 1000., 1., (0., 0.), 0, 1)
    area = route.Area(0, [anchor], (0., 0.), 1.)
    assert route.build_circuit(route.CSR(g), area, g["edge_len"],
                               np.ones(2), g, load_rubric()) is None


@pytest.mark.parametrize("label,expected_km,removed_edges", [
    ("short", 71.796648, 2),
    ("long", 45.632875, 22),
])
def test_circuit_cleanup_fixes_the_real_kuigatsi_examples(label, expected_km, removed_edges):
    # Frozen pre-cleanup graph paths, independent of regenerating the catalogue.
    with np.load(Path(__file__).parent / "fixtures/circuit-spurs.npz") as z:
        g = {k[len(label) + 1:]: z[k] for k in z.files if k.startswith(label + "_")}
    original = list(range(len(g["edge_u"])))
    edges = route.clean_circuit_spurs(g, original)
    assert len(original) - len(edges) == removed_edges
    assert float(g["edge_len"][edges].astype(float).sum()) / 1000 == pytest.approx(expected_km)
    assert np.array_equal(g["edge_v"][edges[:-1]], g["edge_u"][edges[1:]])
    assert g["edge_u"][edges[0]] == g["edge_u"][original[0]]
    assert g["edge_v"][edges[-1]] == g["edge_u"][edges[0]]
    assert route.retrace_share(g, edges) == 0.0
    assert route.clean_circuit_spurs(g, edges) == edges


def test_closed_window_edges_are_not_connectors():
    npz = {
        "edge_u": np.array([0, 0, 1], np.int32),
        "edge_v": np.array([2, 1, 2], np.int32),
        "node_x": np.array([0, 1, 2], np.float64),
        "node_y": np.zeros(3),
    }
    csr = route.CSR(npz)
    cost = np.array([np.inf, 1.0, 1.0])
    assert csr.astar(cost, np.ones(3), 0, 2) == [1, 2]
    assert csr.dijkstra_times(cost, 0, {2})[2] == 2.0


def test_sprint_requires_legal_reverse_edges():
    npz = {
        "edge_g0": np.array([0, 0, 2, 2, 4]),
        "edge_u": np.array([0, 1, 1, 2, 2]),
        "edge_v": np.array([1, 0, 2, 1, 3]),
    }
    assert route.reverse_stretch(npz, [0, 2]) == [3, 1]
    assert route.reverse_stretch(npz, [0, 2, 4]) == []


def test_sprint_requires_a_shared_access_window():
    npz = {
        "edge_g0": np.array([0, 0]),
        "edge_g1": np.array([2, 2]),
        "edge_u": np.array([0, 1]),
        "edge_v": np.array([1, 0]),
        "edge_rev": np.array([0, 1]),
        "edge_len": np.array([1100., 1100.]),
        "edge_name": np.array([1, 1]),
        "coord_x": np.array([100000., 101100.]),
        "coord_y": np.array([490000., 490000.]),
        "edge_access": np.array([16, 32]),
    }
    feats = {"head_per_km": np.array([110., 110.]),
             "engaged_per_km": np.array([0., 0.]),
             "legal_speed": np.array([60., 60.]),
             "climb_m": np.zeros(2), "n_hairpin": np.zeros(2),
             "n_sweet": np.zeros(2), "n_flowing": np.zeros(2),
             "corner_edge": np.array([], dtype=np.int32),
             "corner_s": np.array([]), "corner_r": np.array([]),
             "corner_sign": np.array([]), "corner_v": np.array([]),
             "corner_engaged": np.array([], dtype=bool)}
    scores = {"fun": np.array([.6, .6]), "excluded": np.zeros(2, np.uint8)}
    scores.update({f"score_{k}": np.array([.8, .8]) for k in
                   ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery")})
    stretch = route.Stretch([0], 1100., .66, (100550., 490000.), 0, 1)
    args = ([stretch], npz, {"names": ["", "Test road"]}, feats, scores, load_rubric())
    assert route.mine_sprints(*args) == []
    npz["edge_access"][1] = 16
    result = route.mine_sprints(*args)
    assert len(result) == 1
    assert result[0]["windows"] == ["2026-09-28 08:00"]
    assert result[0]["name"] == "Test road Sprint"
    assert result[0]["drive_min"] >= 1
    scores["fun"][1] = .4
    assert route.mine_sprints(*args) == []


def test_distance_chunks_never_reference_an_empty_edge_slice():
    for distances in (np.array([0., 100., 200.]), np.array([0., 1000., 1010.])):
        for start, end in route._chunk_edges(distances, 40):
            assert 0 <= start <= end < len(distances) - 1
    assert route._chunk_edges(np.array([0., 100.]), 40)[-1] == (0, 0)


def test_two_runs_write_byte_identical_routes_json(tmp_path, monkeypatch):
    source = paths()
    cache = tmp_path / "cache"
    (cache / "graph_bbox").mkdir(parents=True)
    shutil.copy2(source.cache / "graph_bbox" / "graph.npz", cache / "graph_bbox" / "graph.npz")
    shutil.copy2(source.cache / "graph_bbox" / "graph_side.json", cache / "graph_bbox" / "graph_side.json")
    shutil.copy2(source.cache / "features_bbox.npz", cache / "features_bbox.npz")
    shutil.copy2(source.cache / "scores_bbox.npz", cache / "scores_bbox.npz")
    fake_paths = SimpleNamespace(cache=cache, reports=tmp_path)
    monkeypatch.setattr(route, "ensure_dirs", lambda: fake_paths)
    monkeypatch.setattr(graph, "ensure_dirs", lambda: fake_paths)
    monkeypatch.setattr(route, "SOFT_MIN_KM", 0.0)

    route.run()
    first = (cache / "routes.json").read_bytes()
    data = json.loads(first)
    assert data["routes"]
    assert set(data) == {"meta", "home", "areas", "toproads", "routes", "sprints"}
    assert data["sprints"]
    assert len({sprint["id"] for sprint in data["sprints"]}) == len(data["sprints"])
    assert all(item["windows"] and item["line"] for item in data["sprints"])
    assert all(item["fun"] >= .55 for item in data["sprints"])
    assert {"climb_m", "corner_count", "corners", "stops", "why", "elev", "curv", "seg"} <= set(
        data["sprints"][0]
    )
    assert {"line", "seg", "elev", "curv", "corners", "stops", "roads", "links", "windows"} <= set(
        data["routes"][0]
    )
    assert data["routes"][0]["windows"]
    route.run()
    assert (cache / "routes.json").read_bytes() == first
