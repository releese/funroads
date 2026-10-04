"""Linked rides must collect distinct high-fun stretches on legal roads."""

import json
import shutil
from types import SimpleNamespace

import numpy as np

from funroads import graph, linked, route
from funroads.config import load_rubric, paths


def _network():
    g = {
        "edge_u": np.array([0, 1, 2, 3], np.int32),
        "edge_v": np.array([1, 2, 3, 0], np.int32),
        "edge_len": np.array([1100., 600., 1200., 2200.], np.float32),
        "edge_access": np.full(4, 255, np.uint8),
        "edge_g0": np.array([0, 2, 4, 6], np.int32),
        "edge_g1": np.array([2, 4, 6, 8], np.int32),
        "edge_rev": np.zeros(4, np.uint8),
        "node_x": np.array([100000., 101100., 101700., 101700.]),
        "node_y": np.array([490000., 490000., 490000., 491200.]),
        "coord_x": np.array([100000., 101100., 101100., 101700.,
                             101700., 101700., 101700., 100000.]),
        "coord_y": np.array([490000., 490000., 490000., 490000.,
                             490000., 491200., 491200., 490000.]),
        "edge_name": np.array([1, 2, 3, 4], np.int32),
    }
    scores = {"fun": np.array([.7, .4, .75, .45], np.float32),
              "excluded": np.zeros(4, np.uint8)}
    for dim in ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery"):
        scores["score_" + dim] = np.full(4, .5, np.float32)
    feats = {"legal_speed": np.full(4, 60), "climb_m": np.zeros(4),
             "controls": np.zeros(4), "head_per_km": np.zeros(4),
             "n_hairpin": np.zeros(4), "n_sweet": np.zeros(4),
             "n_flowing": np.zeros(4),
             "corner_edge": np.array([], dtype=np.int32),
             "corner_s": np.array([]), "corner_r": np.array([]),
             "corner_sign": np.array([]), "corner_v": np.array([]),
             "corner_engaged": np.array([], dtype=bool)}
    one = route.Stretch([0], 1100., .77, (100550., 490000.), 0, 1)
    two = route.Stretch([2], 1200., .9, (101700., 490600.), 2, 3)
    area = route.Area(0, [one, two], (101100., 490300.), 1.67)
    return g, scores, feats, area


def _straight(g):
    """Straight-line geometry from node coordinates; edges that share a slice
    id keep sharing one physical slice, drawn in the first edge's direction."""
    xs, ys, g0, rev, first = [], [], [], [], {}
    for e, key in enumerate(g["edge_g0"].tolist()):
        u, v = int(g["edge_u"][e]), int(g["edge_v"][e])
        if key not in first:
            first[key] = (len(xs), u)
            xs += [g["node_x"][u], g["node_x"][v]]
            ys += [g["node_y"][u], g["node_y"][v]]
        at, u0 = first[key]
        g0.append(at)
        rev.append(int(u != u0))
    g["edge_g0"] = np.array(g0, np.int32)
    g["edge_g1"] = g["edge_g0"] + 2
    g["edge_rev"] = np.array(rev, np.uint8)
    g["coord_x"], g["coord_y"] = np.array(xs), np.array(ys)
    g["edge_name"] = np.arange(1, len(g0) + 1, dtype=np.int32)
    return g


def test_linked_ride_collects_two_stretches_and_closes_without_retracing():
    g, scores, feats, area = _network()
    rubric = load_rubric()
    candidates = linked.linked_candidates(g, scores, rubric, [area])
    assert any(c["type"] == "open" and c["edges"] == [0, 1, 2]
               for c in candidates)
    assert any(c["type"] == "circuit" and c["edges"] == [0, 1, 2, 3]
               for c in candidates)
    side = {"names": ["", "One", "Link", "Two", "Return"]}
    data = linked.assemble(candidates, g, side, feats, scores, rubric)
    assert linked.assemble(linked.linked_candidates(g, scores, rubric, [area]),
                           g, side, feats, scores, rubric) == data
    assert data["rides"]
    assert set(data["profiles"]) == {"scenic", "technical", "quiet"}
    assert all(len(r["windows"]) == 8 for r in data["rides"])
    assert len({r["id"] for r in data["rides"]}) == len(data["rides"])
    g["edge_access"][3] = 0
    candidates = linked.linked_candidates(g, scores, rubric, [area])
    assert any(c["type"] == "open" for c in candidates)
    assert not any(c["type"] == "circuit" for c in candidates)
    g["edge_access"][:] = [2, 1, 2, 2]
    candidates = linked.linked_candidates(g, scores, rubric, [area])
    assert not any(c["edges"] == [0, 1, 2] for c in candidates)
    assert all(c["mask"] == int(np.bitwise_and.reduce(g["edge_access"][c["edges"]]))
               for c in candidates)


def test_single_stretch_is_not_mislabeled_as_a_linked_loop():
    g, scores, _, area = _network()
    only = route.Area(0, [area.stretches[0]], area.centroid, .77)
    candidates = linked.linked_candidates(g, scores, load_rubric(), [only])
    assert candidates == []


def test_linked_anchors_must_meet_sprint_quality_without_requiring_reverse():
    g, scores, _, area = _network()  # these anchors have no reverse edges
    assert any(c["type"] == "open" for c in linked.linked_candidates(
        g, scores, load_rubric(), [area]))
    scores["fun"][0] = .54
    assert linked.linked_candidates(g, scores, load_rubric(), [area]) == []


def test_reverse_anchor_can_qualify_when_forward_does_not():
    g, scores, _, _ = _network()
    g["edge_u"] = np.array([0, 1, 0, 2, 3], np.int32)
    g["edge_v"] = np.array([1, 0, 2, 3, 2], np.int32)
    g["edge_g0"] = np.array([0, 0, 2, 4, 4], np.int32)
    g["edge_len"] = np.array([1100., 1100., 600., 1200., 1200.])
    g["edge_access"] = np.full(5, 255, np.uint8)
    # Node 2 sits north of node 0, so 1 -> 0 -> 2 turns a corner rather than
    # driving back along the reversed anchor.
    g["node_x"] = np.array([100000., 101100., 100000., 101700.])
    g["node_y"] = np.array([490000., 490000., 491200., 491200.])
    _straight(g)
    scores["fun"] = np.array([.54, .72, .5, .75, .75])
    scores["excluded"] = np.zeros(5, np.uint8)
    one = route.Stretch([0], 1100., .594, (100550., 490000.), 0, 1)
    two = route.Stretch([3], 1200., .9, (101700., 490600.), 2, 3)
    area = route.Area(0, [one, two], (101100., 490300.), 1.49)
    candidates = linked.linked_candidates(g, scores, load_rubric(), [area])
    assert any(c["type"] == "open" and c["edges"] == [1, 2, 3]
               for c in candidates)
    assert all(0 not in c["edges"] for c in candidates if c["type"] == "open")


def test_connector_retries_without_retracing_anchors():
    g, scores, _, _ = _network()
    g["edge_u"] = np.array([0, 2, 1, 0, 1, 3], np.int32)
    g["edge_v"] = np.array([1, 4, 0, 2, 3, 2], np.int32)
    g["edge_len"] = np.array([1100., 1200., 1100., 100., 400., 400.])
    g["edge_g0"] = np.array([0, 2, 0, 6, 8, 10], np.int32)
    g["edge_access"] = np.full(6, 255, np.uint8)
    g["node_x"] = np.array([0., 100., 200., 150., 300.])
    g["node_y"] = np.array([0., 0., 0., 100., 0.])
    _straight(g)
    scores["fun"] = np.array([.7, .75, .7, .5, .6, .6])
    scores["excluded"] = np.zeros(6, np.uint8)
    csr = route.CSR(g)
    cost = np.array([1., 1., 1., 1., 3., 3.])
    shortest = linked.nearby_paths(csr, cost, 1, {2})[2]
    assert shortest == [2, 3]  # cheapest connector retraces the first anchor
    assert linked.clean_connector(csr, cost, g, scores, [0], [1], shortest,
                                  .2, .45) == [4, 5]
    g["edge_access"][5] = 0
    assert linked.clean_connector(csr, cost, g, scores, [0], [1], shortest,
                                  .2, .45) is None


def test_loop_retries_when_cheapest_return_is_too_dull():
    g, scores, _, _ = _network()
    g["edge_u"] = np.append(g["edge_u"], [3, 4])
    g["edge_v"] = np.append(g["edge_v"], [4, 0])
    g["edge_len"] = np.append(g["edge_len"], [1200., 1200.])
    g["edge_g0"] = np.append(g["edge_g0"], [8, 10])
    g["edge_access"] = np.append(g["edge_access"], [255, 255])
    g["node_x"] = np.append(g["node_x"], [100000.])
    g["node_y"] = np.append(g["node_y"], [491200.])
    _straight(g)
    scores["fun"] = np.append(scores["fun"], [.55, .55])
    scores["fun"][3] = .25
    scores["excluded"] = np.append(scores["excluded"], [0, 0])
    cost = np.array([1., 1., 1., 1., 10., 10.])
    loop = linked.close_loop(route.CSR(g), cost, g, scores, g["edge_access"],
                             [0, 1, 2])
    assert loop is not None
    assert loop["edges"] == [0, 1, 2, 4, 5]


def test_three_stretches_can_be_chained_before_closing():
    g, scores, _, area = _network()
    g["edge_u"] = np.append(g["edge_u"], [3, 4, 5])
    g["edge_v"] = np.append(g["edge_v"], [4, 5, 0])
    g["edge_len"] = np.append(g["edge_len"], [400., 1200., 2000.])
    g["edge_g0"] = np.append(g["edge_g0"], [8, 10, 12])
    g["edge_access"] = np.append(g["edge_access"], [255, 255, 255])
    g["node_x"] = np.append(g["node_x"], [102100., 103300.])
    g["node_y"] = np.append(g["node_y"], [491200., 491200.])
    _straight(g)
    scores["fun"] = np.append(scores["fun"], [.4, .75, .45])
    scores["excluded"] = np.append(scores["excluded"], [0, 0, 0])
    three = route.Stretch([5], 1200., .9, (102700., 491200.), 4, 5)
    area.stretches.append(three)
    candidates = linked.linked_candidates(g, scores, load_rubric(), [area])
    assert any(c["type"] == "open" and len(c["anchors"]) == 3 for c in candidates)
    assert any(c["type"] == "circuit" and len(c["anchors"]) == 3 for c in candidates)


def test_loop_rejects_dull_return_even_when_open_chain_is_good():
    g, scores, _, area = _network()
    scores["fun"][3] = .3  # 43% dull return; the pair remains an open ride
    candidates = linked.linked_candidates(g, scores, load_rubric(), [area])
    assert any(c["type"] == "open" for c in candidates)
    assert not any(c["type"] == "circuit" for c in candidates)


def test_excluded_road_counts_against_open_connector_share():
    g, scores, _, area = _network()
    scores["excluded"][1] = 1
    candidates = linked.linked_candidates(g, scores, load_rubric(), [area])
    assert candidates
    assert all(1 not in c["edges"] for c in candidates if c["type"] == "open")
    assert all(c["connector_share"] <= .2 for c in candidates if c["type"] == "circuit")


def _graph(nodes, edges, slices=None):
    """Small graph from node coordinates and (u, v, length, fun) edges."""
    g = {
        "edge_u": np.array([e[0] for e in edges], np.int32),
        "edge_v": np.array([e[1] for e in edges], np.int32),
        "edge_len": np.array([e[2] for e in edges], np.float64),
        "edge_access": np.full(len(edges), 255, np.uint8),
        "edge_g0": np.array(slices if slices is not None else range(len(edges)), np.int32),
        "node_x": np.array([n[0] for n in nodes], np.float64),
        "node_y": np.array([n[1] for n in nodes], np.float64),
    }
    scores = {"fun": np.array([e[3] for e in edges], np.float32),
              "excluded": np.zeros(len(edges), np.uint8)}
    return _straight(g), scores


def _dual_carriageway():
    # Two one-way carriageways 16 m apart joined by a short turning link.
    return _graph([(0, 0), (2000, 0), (2000, 16), (0, 16)],
                  [(0, 1, 2000, .8), (2, 3, 2000, .8), (1, 2, 30, .5)])


def test_retrace_share_sees_the_parallel_carriageway():
    g, _ = _dual_carriageway()
    assert route.retrace_share(g, [0, 2, 1]) > .8
    assert route.retrace_share(g, [0]) == 0.0
    assert route.shared_share([0], [1], g["edge_g0"], g["edge_len"]) == 0.0
    assert route.near_share(g, [1], [0]) == 1.0


def test_two_carriageways_of_one_road_are_not_two_anchors():
    g, scores = _dual_carriageway()
    csr = route.CSR(g)
    cost = g["edge_len"].copy()
    assert linked.clean_connector(csr, cost, g, scores, [0], [1], [2], .2, .45,
                                  max_retrace=1.0) == [2]
    assert linked.clean_connector(csr, cost, g, scores, [0], [1], [2], .2, .45) is None


def test_loop_does_not_start_by_turning_round_at_the_chain_end():
    # The chain ends on a two-way spur (edges 1/2). Turning round on it and
    # returning via node 4 is cheapest; the loop must take the real return.
    g, scores = _graph(
        [(0, 0), (3000, 0), (3000, 200), (0, 3000), (1500, -1000)],
        [(0, 1, 3000, .7), (1, 2, 200, .7), (2, 1, 200, .7),
         (1, 4, 1800, .7), (4, 0, 1800, .7), (2, 3, 4300, .7), (3, 0, 3000, .7)],
        slices=[0, 1, 1, 3, 4, 5, 6])
    loop = linked.close_loop(route.CSR(g), g["edge_len"].copy(), g, scores,
                             g["edge_access"], [0, 1])
    assert loop is not None
    assert loop["edges"] == [0, 1, 5, 6]


def test_loop_fallback_penalises_a_rejected_return_that_holds_the_only_exit():
    # Edge 1 is the only way on from the chain end. The cheapest return over
    # edge 2 is dull; blocking edges 1 and 2 would leave no return at all.
    g, scores = _graph(
        [(0, 0), (2000, 0), (2500, 500), (2500, 2500)],
        [(0, 1, 2000, .7), (1, 2, 700, .7), (2, 0, 2550, .1),
         (2, 3, 2000, .7), (3, 0, 3540, .7)])
    loop = linked.close_loop(route.CSR(g), g["edge_len"].copy(), g, scores,
                             g["edge_access"], [0])
    assert loop is not None
    assert loop["edges"] == [0, 1, 3, 4]


def test_rides_are_named_by_their_anchors():
    assert linked.ride_name(["Bentveldsweg", "Duinlustweg"], False) == "Bentveldsweg → Duinlustweg Ride"
    assert linked.ride_name(["Lekdijk", "Lekdijk"], True) == "Lekdijk (2 stretches) Loop"
    assert linked.ride_name(["A", "B", "A"], False) == "A → B → A Ride"


def test_bbox_linked_catalogue_is_byte_identical(tmp_path, monkeypatch):
    source = paths().cache
    cache = tmp_path / "cache"
    (cache / "graph_bbox").mkdir(parents=True)
    for name in ("graph.npz", "graph_side.json"):
        shutil.copy2(source / "graph_bbox" / name, cache / "graph_bbox" / name)
    for name in ("features_bbox.npz", "scores_bbox.npz"):
        shutil.copy2(source / name, cache / name)
    monkeypatch.setattr(linked, "ensure_dirs", lambda: SimpleNamespace(cache=cache))
    monkeypatch.setattr(graph, "ensure_dirs", lambda: SimpleNamespace(cache=cache))
    linked.run()
    first = (cache / "linked_bbox.json").read_bytes()
    data = json.loads(first)
    assert data["rides"]
    assert data["nearby_100km"]["Haarlem"]
    assert all(r["windows"] and r["line"] for r in data["rides"])
    assert all(r["connector_share"] <= .2 for r in data["rides"] if r["type"] == "circuit")
    assert all(r["retrace_share"] <= .2 for r in data["rides"])
    assert {"climb_m", "corner_count", "corners", "stops", "why", "elev", "curv", "seg"} <= set(
        data["rides"][0]
    )
    linked.run()
    assert (cache / "linked_bbox.json").read_bytes() == first
