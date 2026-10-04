import numpy as np
from shapely import LineString, STRtree

from funroads.calibrate import physical_edges, precision_at_km, read_reference, route_overlap


def test_physical_precision_is_length_weighted_and_stable():
    graph = {"edge_g0": np.array([0, 0, 2, 4]),
             "edge_len": np.array([500, 500, 500, 500])}
    scores = {"excluded": np.array([0, 0, 1, 0])}
    assert physical_edges(graph, scores).tolist() == [0, 3]
    assert precision_at_km(np.array([0.9, 0.9, 0.1]),
                           np.array([False, True, True]),
                           np.array([500, 500, 500]), 0.75) == 1 / 3


def test_reference_parses_osm_way_ids_from_pinned_kmz():
    from funroads.config import paths

    routes, lines = read_reference(paths().raw / "roadcurvature_nl_c1000.kmz")
    assert len(routes) == len(lines) == 835
    assert routes[0]["name"] == "Meije"
    assert 278467915 in routes[0]["ways"]


def test_spatial_overlap_uses_metre_distance():
    from pyproj import Transformer

    x, y = Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True).transform(
        [5.0, 5.001], [52.0, 52.0]
    )
    route = [[5.0, 52.0], [5.001, 52.0]]
    assert route_overlap(route, STRtree([LineString(zip(x, y))])) == 1.0
    assert route_overlap(route, STRtree([LineString([(0, 0), (10, 0)])])) == 0.0
