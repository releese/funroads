"""A high-fun road can be offered both as a sprint and as a short circuit."""

import numpy as np

from funroads import options
from funroads.config import load_rubric


def test_sprint_anchor_can_also_close_as_short_circuit():
    g = {
        "edge_u": np.array([0, 1, 1, 2], np.int32),
        "edge_v": np.array([1, 0, 2, 0], np.int32),
        "edge_g0": np.array([0, 0, 2, 4]),
        "edge_g1": np.array([2, 2, 4, 6]),
        "edge_rev": np.array([0, 1, 0, 0], np.uint8),
        "edge_len": np.array([1100., 1100., 1300., 1300.], np.float32),
        "edge_access": np.array([255, 255, 255, 255], np.uint8),
        "edge_name": np.array([1, 1, 2, 2], np.int32),
        "node_x": np.array([100000., 101100., 100550.]),
        "node_y": np.array([490000., 490000., 490900.]),
        "coord_x": np.array([100000., 101100., 101100., 100550., 100550., 100000.]),
        "coord_y": np.array([490000., 490000., 490000., 490900., 490900., 490000.]),
    }
    scores = {"fun": np.array([.7, .7, .4, .4], np.float32),
              "excluded": np.zeros(4, np.uint8)}
    for dim in ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery"):
        scores[f"score_{dim}"] = np.full(4, .5, np.float32)
    feats = {"legal_speed": np.full(4, 60), "controls": np.zeros(4),
             "climb_m": np.zeros(4)}
    results = options.compare(g, {"names": ["", "Example", "Side street"]},
                              feats, scores, "Example", load_rubric())
    assert len(results) == 1
    assert len(results[0]["sprint_windows"]) == 8
    assert len(results[0]["short_circuits"]) == 1
    circuit = results[0]["short_circuits"][0]
    assert circuit["km"] == 3.7
    assert [r["name"] for r in circuit["roads"]] == ["Side street", "Example"]
    assert len(circuit["windows"]) == 8
    g["edge_access"][3] = 0
    assert options.compare(g, {"names": ["", "Example", "Side street"]},
                           feats, scores, "Example", load_rubric())[0]["short_circuits"] == []
