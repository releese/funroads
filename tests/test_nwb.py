"""Offline tests for funroads.nwb with a synthetic GeoPackage and graph."""

from __future__ import annotations

import os
import sqlite3
import struct

import numpy as np
import pytest
import shapely

from funroads import nwb

SLOW = os.environ.get("FUNROADS_SLOW_TESTS") == "1"

HW_CODES = {"residential": 1, "motorway": 2, "tertiary": 3, "living_street": 4}


def gpkg_blob(geom, srs: int = 28992, envelope: bool = True) -> bytes:
    """Hand-build a GeoPackage geometry blob (little-endian header + WKB)."""
    wkb = shapely.to_wkb(geom)
    flags = 0x01
    env = b""
    if envelope:
        flags |= 0x01 << 1  # envelope indicator 1 = XY
        minx, miny, maxx, maxy = geom.bounds
        env = struct.pack("<4d", minx, maxx, miny, maxy)
    return b"GP" + bytes([0, flags]) + struct.pack("<i", srs) + env + wkb


def make_gpkg(path, rows) -> None:
    """rows: (id, geom, wvk, name, maxshd, alt, adv, begin, end, richt, betrw, bst)."""
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE Snelheden (id INTEGER PRIMARY KEY, geom BLOB, WVK_ID INTEGER,"
        " STT_NAAM TEXT, MAXSHD TEXT, MAXSHD_ALT INTEGER, MAXSHD_ADV INTEGER,"
        " BEGINTIJD INTEGER, EINDTIJD INTEGER, KENM_RICHT TEXT, BETRWBHEID TEXT,"
        " BST_CODE TEXT)"
    )
    for r in rows:
        con.execute("INSERT INTO Snelheden VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", r)
    con.commit()
    con.close()


def wkd_row(rid, geom, wvk, name=None, maxshd="60", alt=None, adv=None, begin=None,
            end=None, richt="B", betrw="100%", bst="RB", srs=28992):
    return (rid, gpkg_blob(geom, srs=srs), wvk, name, maxshd, alt, adv, begin, end,
            richt, betrw, bst)


def make_graph(edges):
    """edges: (coords, rev, maxspeed, advisory, hw_name, name)."""
    coord_x, coord_y = [], []
    g0, g1, rev, mx, adv, hw, nm = [], [], [], [], [], [], []
    names = [""]
    for coords, r, m, a, h, n in edges:
        g0.append(len(coord_x))
        for x, y in coords:
            coord_x.append(x)
            coord_y.append(y)
        g1.append(len(coord_x))
        rev.append(r)
        mx.append(m)
        adv.append(a)
        hw.append(HW_CODES[h])
        if n and n not in names:
            names.append(n)
        nm.append(names.index(n) if n else 0)
    k = len(g0)
    npz = {
        "edge_u": np.arange(k, dtype=np.int32),
        "edge_v": np.arange(k, dtype=np.int32),
        "edge_g0": np.asarray(g0, dtype=np.int64),
        "edge_g1": np.asarray(g1, dtype=np.int64),
        "edge_rev": np.asarray(rev, dtype=np.uint8),
        "edge_len": np.zeros(k, dtype=np.float32),
        "edge_maxspeed": np.asarray(mx, dtype=np.uint8),
        "edge_advisory": np.asarray(adv, dtype=np.uint8),
        "edge_highway": np.asarray(hw, dtype=np.uint8),
        "edge_name": np.asarray(nm, dtype=np.int32),
        "coord_x": np.asarray(coord_x, dtype=np.float32),
        "coord_y": np.asarray(coord_y, dtype=np.float32),
    }
    side = {"names": names, "highway_codes": dict(HW_CODES)}
    return npz, side


LINE = shapely.LineString([(995.0, 1008.0), (1105.0, 1008.0)])  # 8 m north of the test road
ROAD = [(1000.0, 1000.0), (1100.0, 1000.0)]


# ---------------------------------------------------------------------------
# GeoPackage blob parsing
# ---------------------------------------------------------------------------


def test_blob_with_envelope():
    geom = shapely.LineString([(1.0, 2.0), (30.0, 40.0)])
    srs, wkb = nwb.gpkg_wkb(gpkg_blob(geom, envelope=True))
    assert srs == 28992
    assert shapely.equals(shapely.from_wkb(wkb), geom)


def test_blob_without_envelope():
    geom = shapely.LineString([(1.0, 2.0), (30.0, 40.0)])
    srs, wkb = nwb.gpkg_wkb(gpkg_blob(geom, envelope=False))
    assert srs == 28992
    assert shapely.equals(shapely.from_wkb(wkb), geom)


def test_blob_non_default_srs():
    geom = shapely.LineString([(1.0, 2.0), (30.0, 40.0)])
    srs, wkb = nwb.gpkg_wkb(gpkg_blob(geom, srs=7415))
    assert srs == 7415
    assert shapely.equals(shapely.from_wkb(wkb), geom)


def test_blob_bad_magic():
    with pytest.raises(ValueError):
        nwb.gpkg_wkb(b"XX" + b"\x00" * 30)


def test_gpkg_geometries_batch():
    geoms = [shapely.LineString([(0, 0), (1, 1)]), shapely.LineString([(5, 5), (9, 5)])]
    arr, srs = nwb.gpkg_geometries([gpkg_blob(g) for g in geoms])
    assert srs == {28992}
    assert len(arr) == 2
    assert shapely.equals(arr[1], geoms[1])


# ---------------------------------------------------------------------------
# Time window rule
# ---------------------------------------------------------------------------


def test_resolve_limit_sunday_daytime():
    # The only pattern in the delivery: 06:00-19:00 -> MAXSHD, otherwise ALT.
    assert nwb.resolve_limit("100", 6, 19, 130, hour=13) == 100
    assert nwb.resolve_limit("100", 6, 19, 130, hour=11) == 100
    assert nwb.resolve_limit("100", 6, 19, 130, hour=17) == 100
    assert nwb.resolve_limit("100", 6, 19, 130, hour=6) == 100
    assert nwb.resolve_limit("100", 6, 19, 130, hour=19) == 130  # end exclusive
    assert nwb.resolve_limit("100", 6, 19, 130, hour=23) == 130
    assert nwb.resolve_limit("100", 6, 19, 130, hour=3) == 130
    # No window: the base value always applies.
    assert nwb.resolve_limit("80", None, None, None) == 80
    assert nwb.resolve_limit("NVT", None, None, None) == 0


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


def test_parallel_edge_within_radius_matches(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, name="Testweg", maxshd="60")])
    npz, side = make_graph([(ROAD, 0, 0, 0, "tertiary", "Testweg")])
    out = nwb.match(npz, side, gpkg)
    assert out["legal_speed"][0] == 60
    assert out["speed_source"][0] == nwb.SRC_WKD
    assert out["wkd_row"][0] == 1
    assert out["speed_conf"][0] > 0.5


def test_far_edge_does_not_match(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="60")])
    far_road = [(1000.0, 1300.0), (1100.0, 1300.0)]  # 292 m away
    npz, side = make_graph([(far_road, 0, 50, 0, "tertiary", None)])
    out = nwb.match(npz, side, gpkg)
    assert out["speed_source"][0] == nwb.SRC_OSM
    assert out["legal_speed"][0] == 50
    assert out["wkd_row"][0] == -1


def test_perpendicular_edge_rejected_by_heading(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="60")])
    crossing = [(1050.0, 990.0), (1050.0, 1030.0)]  # crosses the WKD line at 90 deg
    npz, side = make_graph([(crossing, 0, 50, 0, "tertiary", None)])
    out = nwb.match(npz, side, gpkg)
    assert out["speed_source"][0] == nwb.SRC_OSM
    assert out["wkd_row"][0] == -1


def test_name_mismatch_lowers_confidence(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, name="Testweg", maxshd="60")])
    npz, side = make_graph([
        (ROAD, 0, 0, 0, "tertiary", "Testweg"),
        ([(1000.0, 1016.0), (1100.0, 1016.0)], 0, 0, 0, "tertiary", "Anderspad"),
    ])
    out = nwb.match(npz, side, gpkg)
    assert out["legal_speed"][0] == 60
    assert out["legal_speed"][1] == 60
    assert out["speed_conf"][0] > out["speed_conf"][1] + 0.1


def test_directional_row_only_applies_to_matching_direction(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="60", richt="H")])
    # One geometry, both driving directions; OSM tag 50 as fallback.
    npz, side = make_graph([(ROAD, 0, 50, 0, "tertiary", None),
                            (ROAD, 1, 50, 0, "tertiary", None)])
    out = nwb.match(npz, side, gpkg)
    # Edge 0 drives east, like the digitised WKD line: H applies.
    assert out["speed_source"][0] == nwb.SRC_WKD
    assert out["legal_speed"][0] == 60
    # Edge 1 drives west: the H row must not leak into the other direction.
    assert out["speed_source"][1] == nwb.SRC_OSM
    assert out["legal_speed"][1] == 50


def test_directional_terug_row(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="60", richt="T")])
    npz, side = make_graph([(ROAD, 0, 50, 0, "tertiary", None),
                            (ROAD, 1, 50, 0, "tertiary", None)])
    out = nwb.match(npz, side, gpkg)
    assert out["speed_source"][0] == nwb.SRC_OSM  # east, against T
    assert out["speed_source"][1] == nwb.SRC_WKD  # west, with T
    assert out["legal_speed"][1] == 60


def test_fallback_chain_and_never_zero(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="60")])
    npz, side = make_graph([
        (ROAD, 0, 0, 0, "tertiary", None),                    # WKD 60
        ([(0.0, 0.0), (80.0, 0.0)], 0, 70, 0, "tertiary", None),    # OSM 70
        ([(0.0, 500.0), (80.0, 500.0)], 0, 0, 0, "residential", None),  # class 30
        ([(0.0, 900.0), (80.0, 900.0)], 0, 0, 0, "motorway", None),     # class 100
        ([(0.0, 950.0), (80.0, 950.0)], 0, 0, 0, "living_street", None),  # class 15
    ])
    out = nwb.match(npz, side, gpkg)
    assert out["legal_speed"].tolist() == [60, 70, 30, 100, 15]
    assert out["speed_source"].tolist() == [nwb.SRC_WKD, nwb.SRC_OSM,
                                            nwb.SRC_CLASS, nwb.SRC_CLASS, nwb.SRC_CLASS]
    assert (out["legal_speed"] > 0).all()


def test_determinism(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [
        wkd_row(1, LINE, wvk=42, name="Testweg", maxshd="60"),
        wkd_row(2, shapely.LineString([(995.0, 990.0), (1105.0, 990.0)]), wvk=7, maxshd="80"),
    ])
    npz, side = make_graph([(ROAD, 0, 0, 0, "tertiary", "Testweg"),
                            (ROAD, 1, 50, 0, "tertiary", None)])
    a = nwb.match(npz, side, gpkg)
    b = nwb.match(npz, side, gpkg)
    for key in a:
        assert np.array_equal(a[key], b[key]), key


def test_tie_breaks_by_lowest_wvk(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    # Two identical lines, equidistant, different limits: lowest WVK_ID wins.
    make_gpkg(gpkg, [
        wkd_row(10, LINE, wvk=200, maxshd="30"),
        wkd_row(11, LINE, wvk=100, maxshd="50"),
    ])
    npz, side = make_graph([(ROAD, 0, 0, 0, "tertiary", None)])
    out = nwb.match(npz, side, gpkg)
    assert out["legal_speed"][0] == 50
    assert out["wkd_row"][0] == 11


def test_time_dependent_row_uses_daytime_limit(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="100", alt=130, begin=6, end=19)])
    npz, side = make_graph([(ROAD, 0, 0, 0, "motorway", None)])
    day = nwb.match(npz, side, gpkg)
    assert day["legal_speed"][0] == 100  # Sunday daytime
    night = nwb.match(npz, side, gpkg, hour=22)
    assert night["legal_speed"][0] == 130


def test_advisory_from_wkd(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="80", adv=60)])
    npz, side = make_graph([(ROAD, 0, 0, 0, "tertiary", None)])
    out = nwb.match(npz, side, gpkg)
    assert out["advisory"][0] == 60


def test_advisory_priority_wkd_over_signs_and_osm(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, maxshd="80", adv=60)])
    npz, side = make_graph([(ROAD, 0, 0, 40, "tertiary", None)])
    signs = {"advisory_sign": np.array([50], dtype=np.uint8)}
    out = nwb.match(npz, side, gpkg, signs=signs)
    assert out["advisory"][0] == 60  # WKD wins
    # Without the WKD advisory the sign value wins over the OSM tag.
    gpkg2 = tmp_path / "s2.gpkg"
    make_gpkg(gpkg2, [wkd_row(1, LINE, wvk=42, maxshd="80")])
    out2 = nwb.match(npz, side, gpkg2, signs=signs)
    assert out2["advisory"][0] == 50


def test_report_markdown(tmp_path):
    gpkg = tmp_path / "s.gpkg"
    make_gpkg(gpkg, [wkd_row(1, LINE, wvk=42, name="Testweg", maxshd="60")])
    npz, side = make_graph([(ROAD, 0, 50, 0, "tertiary", "Testweg"),
                            ([(0.0, 0.0), (80.0, 0.0)], 0, 0, 0, "residential", "Woonstraat")])
    out = nwb.match(npz, side, gpkg)
    md = nwb.report(npz, side, out)
    assert "WKD match" in md
    assert "class default" in md
    assert "Testweg" in md


@pytest.mark.skipif(not SLOW, reason="set FUNROADS_SLOW_TESTS=1 to run against real data")
def test_real_bbox_match():
    from funroads import graph as graph_mod

    npz, side = graph_mod.load(bbox=True)
    out = nwb.match(npz, side, nwb.wkd_path())
    assert len(out["legal_speed"]) == len(npz["edge_u"])
    assert (out["legal_speed"] > 0).all()
    assert (out["speed_source"] == nwb.SRC_WKD).mean() > 0.5
