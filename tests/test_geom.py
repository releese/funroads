"""Geometry tests: the curvature and corner model must be right on shapes we
can verify by hand, otherwise every fun score downstream is fiction.
"""

from __future__ import annotations

import numpy as np
import pytest

from funroads import geom


def circle(radius: float, sweep_deg: float = 180.0, n: int = 400, ccw: bool = True):
    t = np.linspace(0.0, np.radians(sweep_deg), n)
    if not ccw:
        t = -t
    return radius * np.cos(t), radius * np.sin(t)


def test_resample_constant_step_and_endpoints():
    x = np.array([0.0, 100.0, 100.0])
    y = np.array([0.0, 0.0, 50.0])
    xs, ys, s = geom.resample(x, y, step=10.0)
    assert s[0] == 0.0
    assert s[-1] == pytest.approx(150.0)
    steps = np.diff(s)
    assert np.allclose(steps, steps[0])
    assert steps[0] == pytest.approx(150.0 / (len(s) - 1))
    # Endpoints preserved.
    assert (xs[0], ys[0]) == pytest.approx((0.0, 0.0))
    assert (xs[-1], ys[-1]) == pytest.approx((100.0, 50.0))


def test_resample_handles_duplicate_vertices():
    x = np.array([0.0, 0.0, 50.0])
    y = np.array([0.0, 0.0, 0.0])
    xs, ys, s = geom.resample(x, y, step=10.0)
    assert s[-1] == pytest.approx(50.0)
    assert np.all(np.diff(xs) > 0)


def test_resample_short_edge_keeps_two_samples():
    xs, ys, s = geom.resample(np.array([0.0, 4.0]), np.array([0.0, 0.0]), step=10.0)
    assert len(xs) == 2
    assert s[-1] == pytest.approx(4.0)


@pytest.mark.parametrize("radius", [25.0, 60.0, 150.0, 400.0])
def test_curvature_on_synthetic_circle(radius):
    """Curvature of a circle of radius R must come out as 1/R."""
    x, y = circle(radius, sweep_deg=120.0, n=600)
    xs, ys, _ = geom.resample(x, y, step=5.0)
    k = geom.curvature(xs, ys)
    inner = k[2:-2]
    est = 1.0 / np.abs(np.median(inner))
    assert est == pytest.approx(radius, rel=0.02)


def test_curvature_sign_distinguishes_left_from_right():
    x, y = circle(80.0, sweep_deg=90.0, ccw=True)
    xs, ys, _ = geom.resample(x, y, step=5.0)
    k_left = geom.curvature(xs, ys)
    x, y = circle(80.0, sweep_deg=90.0, ccw=False)
    xs, ys, _ = geom.resample(x, y, step=5.0)
    k_right = geom.curvature(xs, ys)
    assert np.median(k_left[2:-2]) > 0
    assert np.median(k_right[2:-2]) < 0


def test_curvature_of_straight_line_is_zero():
    xs = np.linspace(0, 500, 51)
    ys = np.zeros_like(xs)
    assert np.allclose(geom.curvature(xs, ys), 0.0)


def test_corner_speed_matches_physics():
    # v = sqrt(a_lat * g * R): a 50 m radius at 0.45 g is about 53 km/h.
    v = geom.corner_speed(50.0, a_lat=0.45)
    assert float(v) == pytest.approx(np.sqrt(0.45 * 9.80665 * 50.0) * 3.6, rel=1e-9)
    assert 50 < float(v) < 56
    # Monotone in radius.
    assert geom.corner_speed(200.0) > geom.corner_speed(50.0)


@pytest.mark.parametrize(
    "radius,sweep",
    [(60.0, 90.0), (150.0, 45.0), (300.0, 30.0), (35.0, 120.0)],
)
def test_detect_corners_recovers_radius_and_turn(radius, sweep):
    """Both the radius and the total turn must come back within a few percent."""
    x, y = circle(radius, sweep_deg=sweep, n=1200)
    xs, ys, s = geom.resample(x, y, step=10.0)
    c = geom.detect_corners(xs, ys, s)
    assert len(c) == 1
    assert c.radius[0] == pytest.approx(radius, rel=0.12)
    assert c.heading[0] == pytest.approx(sweep, rel=0.06)
    assert c.sign[0] == 1


def test_detect_corners_rejects_heavy_node_jitter():
    """Lateral vertex noise up to 1 m must not manufacture corners.

    Noise can produce a locally tight radius, so the coherence check is what
    rejects it: the wiggles cancel instead of adding up to a net turn.
    """
    spurious = 0
    for sigma in (0.4, 0.6, 1.0):
        for seed in range(4):
            rng = np.random.default_rng(seed)
            xs = np.arange(0, 1501, 10.0)
            ys = rng.normal(0.0, sigma, size=xs.shape)
            rx, ry, s = geom.resample(xs, ys, step=10.0)
            spurious += len(geom.detect_corners(rx, ry, s))
    assert spurious == 0


def test_detect_corners_keeps_a_real_corner_under_jitter():
    """A genuine 70 m bend must still be found when the trace is noisy."""
    x, y = circle(70.0, sweep_deg=90.0, n=1200)
    rng = np.random.default_rng(11)
    x = x + rng.normal(0.0, 0.5, size=x.shape)
    y = y + rng.normal(0.0, 0.5, size=y.shape)
    xs, ys, s = geom.resample(x, y, step=10.0)
    c = geom.detect_corners(xs, ys, s)
    assert len(c) >= 1
    assert c.radius[int(np.argmax(c.heading))] == pytest.approx(70.0, rel=0.35)


def test_detect_corners_ignores_a_straight_road():
    xs = np.linspace(0, 2000, 201)
    ys = np.zeros_like(xs)
    s = xs.copy()
    assert len(geom.detect_corners(xs, ys, s)) == 0


def test_detect_corners_on_an_esses_sequence():
    """Three alternating bends must be found as three corners with alternating sign."""
    pieces_x, pieces_y = [], []
    cx, cy, ang = 0.0, 0.0, 0.0
    for sign in (1, -1, 1):
        t = np.linspace(0, np.pi / 2, 200)
        r = 70.0
        # Arc starting at (cx, cy) with heading ang, turning by 90 deg.
        if sign > 0:
            ox, oy = cx - r * np.sin(ang), cy + r * np.cos(ang)
            px = ox + r * np.sin(ang + t)
            py = oy - r * np.cos(ang + t)
            ang += np.pi / 2
        else:
            ox, oy = cx + r * np.sin(ang), cy - r * np.cos(ang)
            px = ox - r * np.sin(ang - t)
            py = oy + r * np.cos(ang - t)
            ang -= np.pi / 2
        pieces_x.append(px)
        pieces_y.append(py)
        cx, cy = px[-1], py[-1]
    x = np.concatenate(pieces_x)
    y = np.concatenate(pieces_y)
    xs, ys, s = geom.resample(x, y, step=10.0)
    c = geom.detect_corners(xs, ys, s)
    assert len(c) == 3
    assert list(c.sign) == [1, -1, 1]
    assert geom.esses_share(c) > 0.5


def test_esses_share_zero_for_same_direction_corners():
    c = geom.Corners(
        s=np.array([100.0, 300.0]),
        radius=np.array([80.0, 80.0]),
        sign=np.array([1, 1], dtype=np.int8),
        heading=np.array([60.0, 60.0]),
        length=np.array([50.0, 50.0]),
    )
    assert geom.esses_share(c) == 0.0


def test_straight_share_prefers_mid_length_links():
    # One corner in the middle of a 700 m edge leaves two ~330 m straights.
    c = geom.Corners(
        s=np.array([350.0]),
        radius=np.array([60.0]),
        sign=np.array([1], dtype=np.int8),
        heading=np.array([90.0]),
        length=np.array([40.0]),
    )
    assert geom.straight_share(700.0, c) > 0.85
    # A 3 km edge with no corners is a transit road, not a fun link.
    empty = geom.Corners(np.zeros(0), np.zeros(0), np.zeros(0, np.int8), np.zeros(0), np.zeros(0))
    assert geom.straight_share(3000.0, empty) == 0.0


def test_elevation_stats_on_a_known_ramp():
    s = np.arange(0, 1001, 10, dtype=float)
    z = s * 0.05  # a steady 5 percent climb
    climb, descent, grade = geom.elevation_stats(s, z)
    assert climb == pytest.approx(50.0, rel=0.02)
    assert descent == pytest.approx(0.0, abs=1e-6)
    assert grade == pytest.approx(5.0, rel=0.05)


def test_elevation_stats_smooths_lidar_noise():
    """A flat road with lidar noise must not report a double-digit grade."""
    rng = np.random.default_rng(3)
    s = np.arange(0, 1001, 10, dtype=float)
    z = rng.normal(0.0, 0.15, size=s.shape)
    climb, descent, grade = geom.elevation_stats(s, z)
    assert grade < 1.0
    assert climb < 5.0


def test_elevation_stats_handles_nan_gaps():
    s = np.arange(0, 501, 10, dtype=float)
    z = s * 0.02
    z[10:15] = np.nan
    climb, descent, grade = geom.elevation_stats(s, z)
    assert climb == pytest.approx(10.0, rel=0.05)
    assert np.isfinite(grade)


def test_smooth_preserves_length_and_mean():
    v = np.array([0.0, 10.0, 0.0, 10.0, 0.0])
    out = geom.smooth(v, 3)
    assert len(out) == len(v)
    assert out.mean() == pytest.approx(v.mean(), rel=0.3)
