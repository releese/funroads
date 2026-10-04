"""Centreline geometry: resampling, curvature, corner detection, corner speed.

All functions work in RD New metres (EPSG:28992) and are pure numpy, so they
are deterministic and directly unit-testable against synthetic shapes.

The corner model
----------------
1. The polyline is resampled at a fixed step (10 m by default).
2. Curvature is estimated at every interior sample from the circumcircle of
   the three neighbouring samples, signed by the cross product so that a left
   bend and a right bend can be told apart.
3. Curvature is smoothed over a short window, because OSM node placement is
   noisy at the metre level and raw three-point curvature is very jumpy.
4. Consecutive samples whose radius is below `r_max` and whose sign agrees are
   grouped into a corner. A corner is kept when its total heading change is at
   least `min_heading_deg`, which throws away straightening jitter.
5. The corner radius is a robust low percentile of the radii inside the group,
   which represents the tightest part without following a single noisy sample.

The comfortable corner speed follows from lateral grip:
    v = sqrt(a_lat * g * R)
`a_lat` is a fraction of g that a driver would hold on a public road, not the
limit of the car. A corner counts as engaging when that speed is below the
legal limit, i.e. the corner forces you to brake and steer rather than just
holding the limit.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

G = 9.80665


def resample(x: np.ndarray, y: np.ndarray, step: float = 10.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Resample a polyline at a constant step.

    Returns (xs, ys, s) where s is the distance along the line. The first and
    last vertex are always kept, so short edges still yield two samples.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if len(x) < 2:
        return x.copy(), y.copy(), np.zeros(len(x))
    seg = np.hypot(np.diff(x), np.diff(y))
    # Dense sub-metre vertex jitter can make measured path length many times
    # longer than the road itself. Simplify only that pathological case; normal
    # bends and sparsely sampled OSM geometry retain every input vertex.
    span = max(float(np.ptp(x)), float(np.ptp(y)), float(np.hypot(x[-1] - x[0], y[-1] - y[0])))
    positive = seg[seg > 0]
    if (len(x) > 3 and len(positive) and np.median(positive) < step / 3
            and float(seg.sum()) > 2.0 * max(span, step)):
        import shapely

        simplified = shapely.simplify(
            shapely.LineString(np.column_stack([x, y])),
            tolerance=step * 0.3,
            preserve_topology=False,
        )
        coords = np.asarray(simplified.coords)
        x, y = coords[:, 0], coords[:, 1]
        seg = np.hypot(np.diff(x), np.diff(y))
    s_in = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(s_in[-1])
    if total <= 0:
        return x[:1].copy(), y[:1].copy(), np.zeros(1)
    n = max(int(np.floor(total / step)) + 1, 2)
    s = np.linspace(0.0, total, n)
    # np.interp needs strictly increasing xp; duplicate vertices break that.
    keep = np.concatenate([[True], seg > 0])
    return np.interp(s, s_in[keep], x[keep]), np.interp(s, s_in[keep], y[keep]), s


def curvature(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Signed curvature (1/m) per sample from the circumcircle of neighbours.

    Positive means a left-hand bend in the direction of travel. The first and
    last sample get 0, because a three point estimate needs both neighbours.
    """
    n = len(xs)
    k = np.zeros(n, dtype=np.float64)
    if n < 3:
        return k
    x0, y0 = xs[:-2], ys[:-2]
    x1, y1 = xs[1:-1], ys[1:-1]
    x2, y2 = xs[2:], ys[2:]
    # Twice the signed triangle area == cross product of the two leg vectors.
    cross = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)
    a = np.hypot(x1 - x0, y1 - y0)
    b = np.hypot(x2 - x1, y2 - y1)
    c = np.hypot(x2 - x0, y2 - y0)
    denom = a * b * c
    with np.errstate(divide="ignore", invalid="ignore"):
        k_inner = np.where(denom > 0, 2.0 * cross / denom, 0.0)
    k[1:-1] = np.nan_to_num(k_inner)
    return k


def smooth(values: np.ndarray, window: int = 3) -> np.ndarray:
    """Centred moving average with edge padding, window forced odd."""
    v = np.asarray(values, dtype=np.float64)
    if window <= 1 or len(v) < 3:
        return v.copy()
    w = window if window % 2 == 1 else window + 1
    half = w // 2
    padded = np.pad(v, half, mode="edge")
    kernel = np.ones(w) / w
    return np.convolve(padded, kernel, mode="valid")


def heading(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Heading in radians per segment between consecutive samples."""
    return np.arctan2(np.diff(ys), np.diff(xs))


def heading_change(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Signed heading change in radians at each interior sample, wrapped."""
    h = heading(xs, ys)
    if len(h) < 2:
        return np.zeros(0)
    d = np.diff(h)
    return (d + np.pi) % (2 * np.pi) - np.pi


def corner_speed(radius: np.ndarray | float, a_lat: float = 0.45) -> np.ndarray | float:
    """Comfortable corner speed in km/h for a radius in metres."""
    r = np.asarray(radius, dtype=np.float64)
    v = np.sqrt(np.maximum(a_lat * G * r, 0.0)) * 3.6
    return v


def _net_turn_deg(head: np.ndarray, lo: int, hi: int) -> float:
    """Absolute net change of direction between the tangents bounding [lo, hi]."""
    if len(head) < 2:
        return 0.0
    a = int(np.clip(lo, 0, len(head) - 1))
    b = int(np.clip(hi - 1, 0, len(head) - 1))
    if b <= a:
        return 0.0
    d = (head[b] - head[a] + np.pi) % (2 * np.pi) - np.pi
    return float(abs(np.degrees(d)))


@dataclass
class Corners:
    """Corners detected on one edge, in driving order."""

    s: np.ndarray        # distance along the edge to the tightest point (m)
    radius: np.ndarray   # robust radius of the corner (m)
    sign: np.ndarray     # +1 left, -1 right
    heading: np.ndarray  # total heading change over the corner (degrees, absolute)
    length: np.ndarray   # arc length of the corner (m)

    def __len__(self) -> int:
        return len(self.s)


def detect_corners(
    xs: np.ndarray,
    ys: np.ndarray,
    s: np.ndarray,
    r_max: float = 600.0,
    min_heading_deg: float = 25.0,
    smooth_window: int = 5,
    gap_tolerance: int = 1,
    radius_percentile: float = 20.0,
    min_coherence: float = 0.55,
) -> Corners:
    """Detect corners on a resampled centreline.

    `min_coherence` is the share of the integrated turn that must survive as a
    net change of direction between the entry and the exit tangent. A real bend
    keeps nearly all of it; lateral noise on a straight road partly cancels, so
    this is what stops metre-level vertex jitter from reading as a corner.
    """
    n = len(xs)
    if n < 4:
        empty = np.zeros(0, dtype=np.float64)
        return Corners(empty, empty, np.zeros(0, dtype=np.int8), empty, empty)

    k_raw = curvature(xs, ys)
    # A three point estimate leaves the two endpoints undefined. Copying the
    # neighbouring value is the right call here: OSM edges are cut at junctions,
    # so an edge frequently starts or ends in the middle of a bend.
    k_raw[0] = k_raw[1]
    k_raw[-1] = k_raw[-2]
    k = smooth(k_raw, smooth_window)
    with np.errstate(divide="ignore"):
        radius = np.where(np.abs(k) > 0, 1.0 / np.abs(k), np.inf)
    in_corner = radius <= r_max
    sign = np.sign(k).astype(np.int8)
    # Heading change is the integral of curvature over arc length. Summing the
    # angles between consecutive chords instead would underestimate the turn by
    # one sample's worth, because a chord heading already sits mid-step.
    step_len = float(s[1] - s[0]) if len(s) > 1 else 0.0
    head = heading(xs, ys)

    groups: list[tuple[int, int, int]] = []  # (start, end inclusive, sign)
    i = 1
    while i < n - 1:
        if not in_corner[i] or sign[i] == 0:
            i += 1
            continue
        cur_sign = int(sign[i])
        start = i
        end = i
        gap = 0
        j = i + 1
        while j < n - 1:
            ok = in_corner[j] and sign[j] == cur_sign
            if ok:
                end = j
                gap = 0
            else:
                gap += 1
                if gap > gap_tolerance:
                    break
            j += 1
        groups.append((start, end, cur_sign))
        i = end + 1

    out_s, out_r, out_sign, out_head, out_len = [], [], [], [], []
    half = max(smooth_window // 2, 0)
    for start, end, cur_sign in groups:
        idx = np.arange(start, end + 1)
        # Smoothing spreads a bend's curvature a half-window past the samples
        # that pass the radius test, so integrate over the widened span or the
        # turn comes out roughly 20 percent short.
        lo = max(start - half, 0)
        hi = min(end + half, n - 1)
        span = np.arange(lo, hi + 1)
        # Integrate |curvature| d(arc length) with the trapezoid rule: a plain
        # sample sum would count n samples over only n-1 intervals and overstate
        # the turn by about 1/n.
        kk = np.where(np.sign(k[span]) == cur_sign, np.abs(k[span]), 0.0)
        total_head = float(np.degrees(np.trapezoid(kk, dx=step_len))) if len(kk) > 1 else 0.0
        if total_head < min_heading_deg:
            continue
        net_head = _net_turn_deg(head, lo, hi)
        if total_head > 0 and net_head / total_head < min_coherence:
            continue
        r_group = radius[idx]
        r_group = r_group[np.isfinite(r_group)]
        if not len(r_group):
            continue
        r_robust = float(np.percentile(r_group, radius_percentile))
        tightest = idx[int(np.argmin(radius[idx]))]
        out_s.append(float(s[tightest]))
        out_r.append(r_robust)
        out_sign.append(cur_sign)
        out_head.append(total_head)
        out_len.append(float(s[end] - s[start]) + (s[1] - s[0] if n > 1 else 0.0))

    return Corners(
        np.asarray(out_s, dtype=np.float64),
        np.asarray(out_r, dtype=np.float64),
        np.asarray(out_sign, dtype=np.int8),
        np.asarray(out_head, dtype=np.float64),
        np.asarray(out_len, dtype=np.float64),
    )


def straight_share(total_length: float, corners: Corners, lo: float = 100.0, hi: float = 500.0) -> float:
    """Share of length in straights between `lo` and `hi` metres long.

    Those are the links that let you use the throttle between corners without
    the road turning into a boring transit road.
    """
    if total_length <= 0:
        return 0.0
    if not len(corners):
        return 1.0 if lo <= total_length <= hi else 0.0
    edges = []
    prev_end = 0.0
    for s, ln in zip(corners.s, corners.length):
        start = max(s - ln / 2.0, prev_end)
        edges.append(max(start - prev_end, 0.0))
        prev_end = max(s + ln / 2.0, prev_end)
    edges.append(max(total_length - prev_end, 0.0))
    good = sum(g for g in edges if lo <= g <= hi)
    return float(min(good / total_length, 1.0))


def esses_share(corners: Corners, max_gap: float = 200.0) -> float:
    """Share of heading change that belongs to alternating (left-right) pairs."""
    if len(corners) < 2:
        return 0.0
    total = float(corners.heading.sum())
    if total <= 0:
        return 0.0
    alt = 0.0
    for i in range(1, len(corners)):
        gap = corners.s[i] - corners.s[i - 1]
        if corners.sign[i] != corners.sign[i - 1] and gap <= max_gap:
            alt += corners.heading[i] + corners.heading[i - 1]
    return float(min(alt / (2.0 * total), 1.0))


def elevation_stats(s: np.ndarray, z: np.ndarray, grade_window: float = 100.0) -> tuple[float, float, float]:
    """Return (climb m, descent m, max absolute sustained grade in percent).

    The profile is smoothed first, because a metre of lidar noise over a 10 m
    step would otherwise read as a 10 percent grade. The grade is measured
    over a window rather than between neighbouring samples.
    """
    if len(z) < 2 or not np.isfinite(z).any():
        return 0.0, 0.0, 0.0
    zz = np.asarray(z, dtype=np.float64).copy()
    finite = np.isfinite(zz)
    if not finite.all():
        if finite.sum() < 2:
            return 0.0, 0.0, 0.0
        zz = np.interp(s, s[finite], zz[finite])
    zz = smooth(zz, 5)
    dz = np.diff(zz)
    climb = float(dz[dz > 0].sum())
    descent = float(-dz[dz < 0].sum())
    step = float(np.median(np.diff(s))) if len(s) > 2 else float(s[-1] - s[0])
    k = max(int(round(grade_window / max(step, 1e-6))), 1)
    if len(zz) > k:
        run = s[k:] - s[:-k]
        rise = zz[k:] - zz[:-k]
        with np.errstate(divide="ignore", invalid="ignore"):
            grade = np.where(run > 0, np.abs(rise) / run * 100.0, 0.0)
        max_grade = float(np.nan_to_num(grade).max())
    else:
        run = float(s[-1] - s[0])
        max_grade = float(abs(zz[-1] - zz[0]) / run * 100.0) if run > 0 else 0.0
    return climb, descent, max_grade
