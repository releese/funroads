"""Country isolation and the safety gates of the real Estonia adapter."""
import numpy as np
import pytest
from pyproj import Transformer

from funroads import config, estonia, graph, teeregister
import shapely


@pytest.fixture(autouse=True)
def restore_country():
    config.select_country("nl")
    yield
    config.select_country("nl")


def test_country_paths_and_metric_projection():
    nl = config.paths()
    config.select_country("ee")
    ee = config.paths()
    assert ee.cache == config.ROOT / "data/ee/cache"
    assert ee.raw != nl.raw
    assert ee.manifest != nl.manifest
    assert config.origins().keys() == {"Tallinn", "Tartu"}
    assert config.projected_crs() == "EPSG:3301"
    tf = Transformer.from_crs("EPSG:4326", config.projected_crs(), always_xy=True)
    x, y = tf.transform(27.05, 57.72)
    assert 600000 < x < 750000 and 6300000 < y < 6500000
    config.select_country("nl")
    assert config.paths() == nl
    assert config.projected_crs() == "EPSG:28992"
    assert config.origins().keys() == {"Zaandam", "Haarlem"}
    with pytest.raises(ValueError):
        config.select_country("../nl")


def test_path_validation_rejects_gaps_and_fake_circuits():
    npz = {"edge_u": np.array([0, 1, 2, 5]),
           "edge_v": np.array([1, 2, 0, 6]),
           "edge_way": np.array([100, 101, 102, 103]),
           "edge_len": np.array([100, 120, 130, 140])}
    evidence = estonia.check_path(npz, [0, 1, 2], True)
    assert evidence["continuous"] and evidence["closed"]
    assert evidence["length_m"] == 350
    with pytest.raises(ValueError, match="disconnected"):
        estonia.check_path(npz, [0, 3])
    with pytest.raises(ValueError, match="does not close"):
        estonia.check_path(npz, [0, 1], True)


def test_national_coordinates_and_osm_access():
    assert estonia.inside(27.05, 57.72)  # Võru area
    assert estonia.inside(24.7536, 59.437)  # Tallinn, inside the national bounds
    assert estonia.inside(22.5, 58.95)  # Hiiumaa is inside the extraction rect
    assert not estonia.inside(4.8, 52.4)
    base = {"highway": "secondary", "surface": "asphalt", "maxspeed": "90"}
    assert graph.is_drivable_way(base)
    for key, value in (("access", "private"), ("motorcar", "no"), ("surface", "gravel")):
        assert not graph.is_drivable_way({**base, key: value})


def test_speed_evidence_never_uses_dutch_or_untagged_defaults():
    assert estonia.mapped_speeds({"highway": "tertiary"}) == (0, 0)
    assert estonia.mapped_speeds({"maxspeed:type": "EE:rural"}) == (90, 90)
    assert estonia.mapped_speeds({"source:maxspeed": "EE:urban"}) == (50, 50)
    assert estonia.mapped_speeds({"maxspeed": "50;90", "maxspeed:type": "EE:rural"}) == (0, 0)
    assert estonia.mapped_speeds({"maxspeed": "NL:rural"}) == (0, 0)
    assert estonia.mapped_speeds({"maxspeed:forward": "50", "maxspeed:backward": "90"}) == (50, 90)
    assert estonia.mapped_speeds({"oneway": "yes", "maxspeed:forward": "70"}) == (70, 70)


def test_real_terrain_is_local_metric_and_missing_samples_stay_unknown():
    config.select_country("ee")
    if not (config.paths().raw / "dtm-tiles").is_dir():
        pytest.skip("real national terrain tiles have not been downloaded")
    sampler = estonia.TerrainSampler()
    tf = Transformer.from_crs("EPSG:4326", "EPSG:3301", always_xy=True)
    x, y = tf.transform(27.05, 57.72)
    tile = sampler.tile(int(x // estonia.TILE_M), int(y // estonia.TILE_M))
    assert tile is not None and tile.resx == tile.resy == 25
    height = sampler.sample([x, 0], [y, 0])
    assert 100 < height[0] < 350
    assert np.isnan(height[1])  # (0, 0) has no tile: unknown stays unknown


def register_feature(oid=1, road=89, coords=((0, 0), (1000, 0)), **props):
    return {"geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"oid": oid, "tee_number": road, **props}}


def test_register_surface_uses_codes_not_inspire_and_rejects_ambiguous_types():
    for code in ("31", "32", "41", "61"):
        assert teeregister.surface({"kate_kate_xv": code, "inspire_surfacecategory": "paved"}) == "unpaved"
    for code in ("10", "13", "22", "27"):
        assert teeregister.surface({"kate_kate_xv": code}) == "paved"
    for code in ("99", "23", "25", "26", "29", ""):
        assert teeregister.surface({"kate_kate_xv": code}) is None


def test_register_matching_requires_coverage_reference_and_alignment():
    layer = teeregister.Evidence([register_feature(kpp=50, kpv=90)])
    forward = shapely.LineString([(100, 2), (900, 2)])
    assert layer.match(forward, {"ref": "89"}, teeregister.speeds) == ((50, 90), 1)
    assert layer.match(shapely.reverse(forward), {"ref": "89"}, teeregister.speeds) == ((90, 50), 1)
    assert layer.match(forward, {"ref": "87"}, teeregister.speeds) is None
    assert layer.match(shapely.LineString([(500, -50), (500, 50)]), {}, teeregister.speeds) is None
    assert layer.match(shapely.LineString([(900, 2), (1200, 2)]), {}, teeregister.speeds) is None
    ambiguous = teeregister.Evidence([register_feature(kpp=50, kpv=90),
                                      register_feature(oid=2, road=87, kpp=50, kpv=90)])
    assert ambiguous.match(forward, {}, teeregister.speeds) is None
    assert teeregister.speeds({"kpp": 50, "kpv": 50, "ajavahp_kpajavahemik_xv": "24"}) is None
    assert teeregister.speeds({"kpp": 50, "kpv": None}) is None


def test_evidence_spans_recover_unknowns_but_never_cross_a_blocked_node():
    surfaces = teeregister.Evidence([register_feature(kate_kate_xv="13")])
    speeds = teeregister.Evidence([register_feature(kpp=90, kpv=70)])
    refs, xy = list(range(6)), np.column_stack((np.arange(6) * 100, np.zeros(6)))
    spans, dropped = estonia.supported_spans(refs, xy, {"highway": "secondary", "ref": "89"},
                                            {3}, surfaces, speeds)
    assert [s["refs"] for s in spans] == [[0, 1, 2], [4, 5]]
    assert dropped["blocked_junction_segments"] == 2
    assert spans[0]["tags"]["surface"] == "paved"
    assert spans[0]["tags"]["maxspeed:forward"] == "90"
    assert spans[0]["tags"]["maxspeed:backward"] == "70"
    assert spans[0]["evidence"]["speed_source"] == [2, 2]
    # Explicit OSM directional limits remain primary.
    spans, _ = estonia.supported_spans(refs, xy, {"highway": "secondary", "ref": "89",
                                                "surface": "asphalt", "maxspeed": "50"},
                                       set(), surfaces, speeds)
    assert spans[0]["tags"]["maxspeed:forward"] == "50"
    assert spans[0]["evidence"]["speed_source"] == [1, 1]
    gravel = teeregister.Evidence([register_feature(kate_kate_xv="32")])
    spans, dropped = estonia.supported_spans(refs, xy, {"surface": "asphalt", "maxspeed": "90"},
                                            set(), gravel, speeds)
    assert not spans and dropped["register_unpaved_or_surface_conflict_segments"] == 5


def test_circuit_shape_gate_rejects_a_closed_out_and_back():
    g = {"edge_u": np.array([0, 1, 2, 3]),
         "edge_v": np.array([1, 2, 3, 0]),
         "edge_way": np.arange(4),
         "edge_len": np.full(4, 1000.),
         "edge_g0": np.array([0, 2, 4, 6]),
         "edge_g1": np.array([2, 4, 6, 8]),
         "edge_rev": np.zeros(4),
         "coord_x": np.array([0, 1000, 1000, 1000, 1000, 0, 0, 0]),
         "coord_y": np.array([0, 0, 0, 1000, 1000, 1000, 1000, 0])}
    assert estonia.is_genuine_circuit(g, [0, 1, 2, 3])
    # Same road there and back, still exactly closed on node 0.
    g["edge_v"][1] = 0
    g["coord_x"][2:4] = [1000, 0]
    g["coord_y"][2:4] = [0, 0]
    assert not estonia.is_genuine_circuit(g, [0, 1])
