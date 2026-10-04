"""Offline tests for funroads.signs with a synthetic gzipped CSV and graph."""

from __future__ import annotations

import csv
import gzip
import os

import numpy as np
import pytest

from funroads import signs

SLOW = os.environ.get("FUNROADS_SLOW_TESTS") == "1"

HEADER = ["id", "externalId", "validated", "validatedOn", "rvvCode", "blackCode",
          "zoneCode", "status", "textSigns", "latitude", "longitude", "rdX", "rdY",
          "placement", "side", "bearing", "nenTurningDirection", "fraction",
          "drivingDirection", "roadName", "roadType", "roadNumber", "roadSectionId",
          "nwbVersion", "countyName", "countyCode", "townName", "bgtCode", "imageUrl",
          "firstSeenOn", "lastSeenOn", "removedOn", "placedOn", "expectedPlacedOn",
          "expectedRemovedOn", "trafficOrderUrl"]


def sign_row(rid, code, x, y, black="", zone="", status="PLACED", removed="",
             bearing="", dd="", text="", road="Testweg"):
    row = {k: "" for k in HEADER}
    row.update({"id": rid, "rvvCode": code, "blackCode": black, "zoneCode": zone,
                "status": status, "textSigns": text, "rdX": x, "rdY": y,
                "bearing": bearing, "drivingDirection": dd, "removedOn": removed,
                "roadName": road})
    return row


def make_csv(path, rows):
    with gzip.open(path, "wt", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=HEADER)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)


def make_graph():
    """One 100 m east-west geometry driven in both directions (e0 east, e1 west)."""
    npz = {
        "edge_u": np.array([0, 1], dtype=np.int32),
        "edge_v": np.array([1, 0], dtype=np.int32),
        "edge_g0": np.array([0, 0], dtype=np.int64),
        "edge_g1": np.array([2, 2], dtype=np.int64),
        "edge_rev": np.array([0, 1], dtype=np.uint8),
        "edge_highway": np.array([1, 1], dtype=np.uint8),
        "coord_x": np.array([0.0, 100.0], dtype=np.float32),
        "coord_y": np.array([0.0, 0.0], dtype=np.float32),
    }
    return npz


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def test_parse_keeps_placed_not_removed(tmp_path):
    csv_gz = tmp_path / "s.csv.gz"
    make_csv(csv_gz, [
        sign_row(1, "J2", 10, 10),                                  # kept
        sign_row(2, "J2", 20, 20, removed="2025-01-01"),            # removed -> drop
        sign_row(3, "J2", 30, 30, status="EXPECTED"),               # not PLACED -> drop
        sign_row(4, "B6", 40, 40),                                  # code not kept -> drop
        sign_row(5, "J2", 50, 50),                                  # kept
    ])
    out = signs.parse(csv_gz)
    assert len(out["x"]) == 2
    # `row` is the 0-based data row index in the CSV, for traceability.
    assert out["row"].tolist() == [0, 4]


def test_parse_black_code_and_zone(tmp_path):
    csv_gz = tmp_path / "s.csv.gz"
    make_csv(csv_gz, [
        sign_row(1, "A1", 10, 10, black="30", zone="ZB"),
        sign_row(2, "A1", 20, 20, black=""),                        # no readable number
        sign_row(3, "A4", 30, 30, black="60"),
        sign_row(4, "A1", 40, 40, black="Unknown"),
    ])
    out = signs.parse(csv_gz)
    assert out["black_value"].tolist() == [30, 0, 60, 0]
    assert out["zone"].tolist() == [signs.ZONE_ENTRY, 0, 0, 0]


def test_parse_bearing_and_camera_text(tmp_path):
    csv_gz = tmp_path / "s.csv.gz"
    make_csv(csv_gz, [
        sign_row(1, "J2", 10, 10, bearing="90"),
        sign_row(2, "J2", 20, 20, bearing=""),
        sign_row(3, "onbekend", 30, 30, text="VRIJ(Trajectcontrole)"),
    ])
    out = signs.parse(csv_gz)
    assert out["bearing"][0] == pytest.approx(90.0)
    assert np.isnan(out["bearing"][1])
    # The camera-keyword row is kept despite its code not being in the keep list.
    assert out["camera"].tolist() == [0, 0, 1]


def test_parse_bad_coordinates_dropped(tmp_path):
    csv_gz = tmp_path / "s.csv.gz"
    make_csv(csv_gz, [
        sign_row(1, "J2", "", ""),
        sign_row(2, "J2", 10, 10),
    ])
    out = signs.parse(csv_gz)
    assert len(out["x"]) == 1


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


def parsed(tmp_path, rows):
    csv_gz = tmp_path / "s.csv.gz"
    make_csv(csv_gz, rows)
    return signs.parse(csv_gz)


def test_bend_sign_counted_once_for_correct_direction(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [sign_row(1, "J2", 50, 6, bearing="90")])  # faces eastward traffic
    out = signs.match_to_edges(npz, s)
    assert out["bend_signs"][0] == 1   # e0 drives east, bearing 90
    assert out["bend_signs"][1] == 0
    assert out["bend_severity"][0] == pytest.approx(signs.SEVERITY_SINGLE)


def test_opposite_bearing_hits_other_direction(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [sign_row(1, "J2", 50, 6, bearing="270")])
    out = signs.match_to_edges(npz, s)
    assert out["bend_signs"][0] == 0
    assert out["bend_signs"][1] == 1


def test_series_bend_has_higher_severity(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [sign_row(1, "J4", 50, 6, bearing="90")])
    out = signs.match_to_edges(npz, s)
    assert out["bend_severity"][0] == pytest.approx(signs.SEVERITY_SERIES)


def test_advisory_plate_raises_bend_severity(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [
        sign_row(1, "J2", 50, 6, bearing="90"),
        sign_row(2, "A4", 52, 6, black="60", bearing="90"),
    ])
    out = signs.match_to_edges(npz, s)
    expected = min(signs.SEVERITY_SINGLE + signs.SEVERITY_ADVISORY_BONUS, 1.0)
    assert out["bend_severity"][0] == pytest.approx(expected)
    assert out["advisory_sign"][0] == 60


def test_limit_sign_and_zone(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [
        sign_row(1, "A1", 20, 6, black="30", zone="ZB", bearing="90"),
        sign_row(2, "A1", 30, 6, black="60", zone="ZB", bearing="270"),
    ])
    out = signs.match_to_edges(npz, s)
    assert out["limit_sign"][0] == 30
    assert out["zone30"][0] == 1
    assert out["limit_sign"][1] == 60
    assert out["zone60"][1] == 1


def test_sign_100m_away_ignored(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [sign_row(1, "J2", 50, 120, bearing="90")])
    out = signs.match_to_edges(npz, s)
    assert out["bend_signs"].sum() == 0


def test_conflicting_bearing_dropped(tmp_path):
    npz = make_graph()
    # Road runs east-west; a sign for northbound traffic belongs to a crossing road.
    s = parsed(tmp_path, [sign_row(1, "J2", 50, 6, bearing="0")])
    out = signs.match_to_edges(npz, s)
    assert out["bend_signs"].sum() == 0


def test_duplicate_signs_counted(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [sign_row(1, "J2", 50, 6, bearing="90"),
                          sign_row(2, "J2", 51, 6, bearing="90")])
    out = signs.match_to_edges(npz, s)
    assert out["bend_signs"][0] == 2


def test_no_bearing_goes_to_lowest_edge_index(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [sign_row(1, "H1", 10, 5)])
    out = signs.match_to_edges(npz, s)
    # Without a bearing the sign attaches to edge 0; the built-up heuristic
    # then flags the surrounding geometry anyway.
    assert out["builtup"][0] == 1
    assert out["builtup"][1] == 1  # both directions within builtup_radius of the H1


def test_determinism(tmp_path):
    npz = make_graph()
    s = parsed(tmp_path, [
        sign_row(1, "J2", 50, 6, bearing="90"),
        sign_row(2, "A1", 20, 6, black="30", zone="ZB", bearing="90"),
        sign_row(3, "J4", 60, 6, bearing="270"),
    ])
    a = signs.match_to_edges(npz, s)
    b = signs.match_to_edges(npz, s)
    for key in a:
        assert np.array_equal(a[key], b[key]), key


@pytest.mark.skipif(not SLOW, reason="set FUNROADS_SLOW_TESTS=1 to run against real data")
def test_real_bbox_signs():
    from funroads import graph as graph_mod

    npz, side = graph_mod.load(bbox=True)
    s = signs.parse(signs.signs_path())
    out = signs.match_to_edges(npz, s)
    assert len(out["bend_signs"]) == len(npz["edge_u"])
    assert (out["bend_signs"] > 0).sum() > 100
    assert (out["limit_sign"] > 0).sum() > 100
