"""Tests for funroads.elevation.

All tests run OFFLINE by default: they use synthetic tiles written into
tmp_path caches in the exact on-disk format the Sampler reads (.npy tiles
and AHN-server-style GeoTIFFs, including the floating-point predictor the
PDOK WCS emits).  The one live-service test is skipped unless the
environment variable FUNROADS_NETWORK_TESTS=1 is set.
"""

from __future__ import annotations

import base64
import os
import struct
import zlib
from pathlib import Path

import numpy as np
import pytest

from funroads import elevation as el

# ---------------------------------------------------------------------------
# A real 1 km x 1 km AHN4 DTM response (50x50 pixels at 20 m) covering the
# eastern slope of the Amerongse Berg (RD x [163000,164000), y [444000,445000)),
# fetched from the PDOK WCS in the exact format the server emits: little-endian
# float32 GeoTIFF, compression 8 (Adobe Deflate), TIFF predictor 3 (floating
# point), 2 strips, GDAL_NODATA = FLT_MAX.  Reference decode (imagecodecs):
# 2500/2500 finite cells, min 15.326415061950684 m, max 46.286067962646484 m.
_FIXTURE_B64 = (
    "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"
    "s1nV70TFyfRao8TWK9A2ZcmYgSRVFcwVrZHgIEeyvvrwcPXabXdey2v9A1YMWTiHJR6hAAYgwMWMzHfoGMwmnGreHAiZRHDQ"
    "OWkMv9Xbtl+gp68JuBwZeLYtb4uaks7FQdrJspNi35xjoyzYrUsHIywLHDUrb6gw9FZ++C0eGdtZP8E8JbeOkdtv8cFLRl59"
    "qLtqm/bge2qrfra/X0e+9aBhZrvD9OW6ayeso5+Y0GJzF85hTbSCMIbMpYj5OhGB2ew5CrAGAyAwqqOSGRROYBFG0vZ/Cs7m"
    "R3G8HVt5RmTb0YDZs2vVHgvMmHTdSDY5rRJzuuCQmcZ3etynbGyH7ojRl18PFd1mzNpkjS7xCLd/va5pfb1bpnpDoVAlpOnx"
    "pKZEgMZlm/DO7PtAXp+T40ghr9Co37tnC+eA7P8EKYhon1ACAy9E2Lg/4SBsNkQiUfCFTgcm4bQ/fizsqczlmbc5Io4XfHbM"
    "3kj/1Np3+9hy5UrzrS/GLiaWcp0l9+Stb+N7niVQ3bg6sN/oKn9MUWe9dFXGyc+pskmzboFf+mmeT9X7jcmMFY9cXYv2aD5A"
    "975iyqXRgJ81mmqeWf4X/eBc/QS8Cp9Oz1e80BwF8QWGgckkMolCmQGDYJRv2Xb2vhnx9xxTyVkVStqxac2xRV8zy3w6Hvq4"
    "eVL77y1fe1xbq9SXXeBxRuLohp+L1xWLV5xU47EW6aqS1vEu2ZNlVXVEYSqhpDfE3ZA8LDVmsuNwKGOSHe61yVNFtX1sWDyj"
    "ygi99jccxONHcAYWNFfmAgzcEoRr4WsUf2tARVlkXnSMsmpNGrfpS7UvOcsWKa3NvA371vqs9KqJvuYZW1arkFWSc+SkXa1o"
    "8Pqqjv4K5eZqm9HAmXtCRQoyjK0RKe7hsWGWUZcdjvNJzj4p+b2+eq9TbVV7ZMc6X2VO6t4Hp3VGXkzvKTGPln+1cA4H4vnP"
    "/WHwnOgxYgyHEf9wk4DcQSKRybM0Njd9QljDwPDBEUgpXvAfUduclVmP9ga0eAoymRt9o0Ou5B6Qpks9dSmCtKuZxomP6EOp"
    "Al/35AldjkHe7J1wTVLfrLOMv2ibmeLPq/sE4tTMt2mVoQ/1T3tmR4nS7qgccyBXasqaHugfn/qL/hyZzxswMZAj+nOYBc0z"
    "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"
    "obHkf45Ck3g="
)


def _fixture_bytes() -> bytes:
    return base64.b64decode("".join(_FIXTURE_B64))


def _fixture_expected_samples() -> list[float]:
    # bilinear values at the anchor points below, derived from the
    # imagecodecs reference decode of this fixture.
    return [
        20.144851684570312,
        23.707192415237664,
        37.84888191223074,
        20.488257089614965,
        16.84449186325073,
    ]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def ramp_tile(ix: int, iy: int, tile_m: int = el.TILE_M, npix: int = 250, res: float | None = None) -> np.ndarray:
    """Synthetic elevation plane z = 0.001*x + 0.002*y at the cell centres of
    tile (ix, iy); row 0 = north edge (the .npy cache convention)."""
    if res is None:
        res = tile_m / npix
    x0 = ix * tile_m
    y_top = (iy + 1) * tile_m
    xc = x0 + (np.arange(npix) + 0.5) * res
    yc = y_top - (np.arange(npix) + 0.5) * res
    xg, yg = np.meshgrid(xc, yc)
    return (0.001 * xg + 0.002 * yg).astype(np.float32)


def write_npy_tile(cache: Path, ix: int, iy: int, z: np.ndarray, res_m: float = el.RES_M) -> None:
    d = cache / "ahn"
    d.mkdir(parents=True, exist_ok=True)
    np.save(d / f"dtm_x{ix}_y{iy}_r{el._res_token(res_m)}.npy", z)


def encode_fp_stream(z: np.ndarray) -> bytes:
    """Apply TIFF predictor 3 (libtiff fpDiff) row by row and zlib-compress.

    This is the exact transform the PDOK WCS applies before writing the
    strip data: transpose each row to byte planes (plane 0 = the most
    significant byte of every sample, then byte 2, byte 1, LSB), then a
    flat backward byte difference across the whole row, then Deflate.
    """
    h, w = z.shape
    le = np.ascontiguousarray(z, dtype="<f4").view(np.uint8).reshape(h, w, 4)
    planes = np.ascontiguousarray(le[:, :, ::-1]).transpose(0, 2, 1)  # (h, 4, w)
    stream = planes.reshape(h, w * 4)
    diff = np.empty_like(stream)
    diff[:, 0] = stream[:, 0]
    diff[:, 1:] = (
        stream[:, 1:].astype(np.int64) - stream[:, :-1].astype(np.int64)
    ) % 256
    return zlib.compress(diff.astype(np.uint8).tobytes())


def build_ahn_style_tiff(
    z: np.ndarray,
    x0: float,
    y_top: float,
    res: float,
    nodata_ascii: bytes = b"3.4028234663852886e+38",
) -> bytes:
    """Assemble a minimal little-endian GeoTIFF in the AHN server's style:
    float32, Deflate, predictor 3, one strip, tiepoint/scale geotags and a
    GDAL_NODATA ASCII tag."""
    h, w = z.shape
    strip = encode_fp_stream(z)
    SHORT, LONG, DOUBLE, ASCII = 3, 4, 12, 2
    tags = [
        (256, SHORT, 1, w),  # ImageWidth
        (257, SHORT, 1, h),  # ImageLength
        (258, SHORT, 1, 32),  # BitsPerSample
        (259, SHORT, 1, 8),  # Compression = Adobe Deflate
        (262, SHORT, 1, 1),  # Photometric = black is zero
        (273, LONG, 1, None),  # StripOffsets (filled below)
        (277, SHORT, 1, 1),  # SamplesPerPixel
        (278, SHORT, 1, h),  # RowsPerStrip (single strip)
        (279, LONG, 1, len(strip)),  # StripByteCounts
        (317, SHORT, 1, 3),  # Predictor = floating point
        (339, SHORT, 1, 3),  # SampleFormat = IEEE float
        (33550, DOUBLE, 3, None),  # ModelPixelScale (payload)
        (33922, DOUBLE, 6, None),  # ModelTiepoint (payload)
        (42113, ASCII, None, None),  # GDAL_NODATA (payload)
    ]
    ifd_size = 2 + 12 * len(tags) + 4
    extra = 8 + ifd_size
    scale_payload = struct.pack("<3d", res, res, 0.0)
    tie_payload = struct.pack("<6d", 0.0, 0.0, 0.0, x0, y_top, 0.0)
    nodata_payload = nodata_ascii + b"\x00"
    scale_off = extra
    tie_off = scale_off + len(scale_payload)
    nodata_off = tie_off + len(tie_payload)
    strip_off = nodata_off + len(nodata_payload)

    ifd = struct.pack("<H", len(tags))
    for tag, typ, count, value in tags:
        if tag == 273:
            value = strip_off
        if tag == 33550:
            value = scale_off
        if tag == 33922:
            value = tie_off
        if tag == 42113:
            value = nodata_off
            count = len(nodata_payload)
        ifd += struct.pack("<HHI", tag, typ, count)
        if typ == SHORT:
            ifd += struct.pack("<HH", value, 0)
        else:
            ifd += struct.pack("<I", value)

    header = b"II*\x00" + struct.pack("<I", 8)
    return (
        header
        + ifd
        + struct.pack("<I", 0)
        + scale_payload
        + tie_payload
        + nodata_payload
        + strip
    )


def write_tif_tile(
    cache: Path,
    z: np.ndarray,
    ix: int,
    iy: int,
    tile_m: int = el.TILE_M,
    res_m: float = el.RES_M,
) -> bytes:
    d = cache / "ahn"
    d.mkdir(parents=True, exist_ok=True)
    raw = build_ahn_style_tiff(z, ix * tile_m, (iy + 1) * tile_m, res_m)
    (d / f"dtm_x{ix}_y{iy}_r{el._res_token(res_m)}.tif").write_bytes(raw)
    return raw


# ---------------------------------------------------------------------------
# 1. bilinear interpolation on a synthetic linear ramp
# ---------------------------------------------------------------------------


def test_bilinear_exact_on_linear_ramp(tmp_path: Path) -> None:
    ix, iy = 32, 89
    z = ramp_tile(ix, iy)
    write_npy_tile(tmp_path, ix, iy, z)
    smp = el.Sampler(cache_dir=tmp_path, offline=True)

    rng = np.random.default_rng(42)
    xs = ix * el.TILE_M + rng.uniform(30.0, el.TILE_M - 30.0, 4000)
    ys = iy * el.TILE_M + rng.uniform(30.0, el.TILE_M - 30.0, 4000)
    got = smp.sample(xs, ys)
    assert got.dtype == np.float32
    assert not np.any(np.isnan(got))
    assert np.allclose(got, 0.001 * xs + 0.002 * ys, atol=1e-3)

    # exact (bit-identical) at cell centres
    x0, y_top = ix * el.TILE_M, (iy + 1) * el.TILE_M
    res = el.TILE_M / z.shape[1]
    cols = np.arange(0, 250, 7)
    rows = np.arange(0, 250, 5)
    cxx = x0 + (cols + 0.5) * res
    cyy = y_top - (rows + 0.5) * res
    gx, gy = np.meshgrid(cxx, cyy)
    centres = smp.sample(gx.ravel(), gy.ravel()).reshape(gx.shape)
    assert np.array_equal(centres, z[np.ix_(rows, cols)])

    # deterministic: identical inputs -> identical outputs
    again = smp.sample(xs, ys)
    assert np.array_equal(got, again)


def test_sample_shapes_and_broadcasting(tmp_path: Path) -> None:
    ix, iy = 32, 89
    write_npy_tile(tmp_path, ix, iy, ramp_tile(ix, iy))
    smp = el.Sampler(cache_dir=tmp_path, offline=True)
    scalar = smp.sample(np.float64(163000.0), np.float64(445010.0))
    assert scalar.shape == () and np.isfinite(scalar)
    vec = smp.sample(np.array([163000.0, 163010.0]), 445010.0)
    assert vec.shape == (2,) and np.all(np.isfinite(vec))
    empty = smp.sample(np.array([]), np.array([]))
    assert empty.shape == (0,)
    # non-finite coordinates are NaN without touching tiles
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(el, "load_npy_tile", lambda *a, **k: pytest.fail("tile read for NaN point"))
        assert np.isnan(smp.sample(np.nan, np.nan))
        both = smp.sample(np.array([np.nan, 163000.0]), np.array([np.nan, 445010.0]))
        assert np.isnan(both[0]) and np.isfinite(both[1])


# ---------------------------------------------------------------------------
# 2. nodata -> NaN; missing tiles -> NaN offline, no HTTP, never raises
# ---------------------------------------------------------------------------


def test_nodata_and_missing_tiles_are_nan_offline(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        el.requests,
        "Session",
        lambda *a, **k: pytest.fail("offline Sampler must not create HTTP sessions"),
    )
    ix, iy = 32, 89
    z = ramp_tile(ix, iy)
    z[100:130, 40:80] = np.nan  # a "water body"
    write_npy_tile(tmp_path, ix, iy, z)
    smp = el.Sampler(cache_dir=tmp_path, offline=True)

    # points over the nodata block (centres and between cells) are NaN
    res = el.TILE_M / z.shape[1]
    xs = 32 * el.TILE_M + np.array([50.5, 55.0, 60.5]) * res
    ys = (iy + 1) * el.TILE_M - np.array([110.0, 115.5, 120.0]) * res
    got = smp.sample(xs, ys)
    assert np.all(np.isnan(got))

    # valid area still works
    ok = smp.sample(np.array(163000.0 + 5 * res), np.array(445000.0 + 5 * res))
    assert np.isfinite(ok)

    # a point in an uncached tile: NaN, no exception, no HTTP
    outside = smp.sample(np.array(163000.0), np.array(450000.0))  # tile (32, 90) not cached
    assert np.isnan(outside)
    far = smp.sample(np.array(-5000.0), np.array(0.0))  # way outside the country
    assert np.isnan(far)
    assert smp.stats["http_requests"] == 0
    assert smp.stats["tiles_fetched"] == 0
    assert smp.stats["tiles_cached"] == 1
    assert smp.stats["nodata_points"] >= 3
    assert np.isnan(smp.sample(np.array([999999.0]), np.array([999999.0]))[0])


# ---------------------------------------------------------------------------
# 3. tile grid alignment and cache file naming
# ---------------------------------------------------------------------------


def test_tile_grid_alignment_and_filenames(tmp_path: Path) -> None:
    ix, iy = el._tile_indices(
        np.array([163000.0, 163001.0, 164999.9, 165000.0]),
        np.array([445000.0, 444999.0, 445000.0, 445000.0]),
        el.TILE_M,
    )
    assert ix.tolist() == [32, 32, 32, 33]
    assert iy.tolist() == [89, 88, 89, 89]

    tif, npy, marker, base = el._tile_paths(tmp_path, 32, 89, 20.0)
    assert tif.name == "dtm_x32_y89_r20.tif"
    assert npy.name == "dtm_x32_y89_r20.npy"
    assert marker.name == "dtm_x32_y89_r20.missing"
    assert tif.parent == tmp_path / "ahn"

    # non-integer resolution token must not be eaten by suffix handling
    tif125, _, _, _ = el._tile_paths(tmp_path, 3, 4, 12.5)
    assert tif125.name == "dtm_x3_y4_r12.5.tif"

    # negative indices produce valid file names
    neg, _, _, _ = el._tile_paths(tmp_path, -1, 88, 20.0)
    assert neg.name == "dtm_x-1_y88_r20.tif"

    # two nearby points share a tile; points across a boundary do not
    z32 = ramp_tile(32, 89)
    z33 = ramp_tile(33, 89)
    write_npy_tile(tmp_path, 32, 89, z32)
    write_npy_tile(tmp_path, 33, 89, z33)
    smp = el.Sampler(cache_dir=tmp_path, offline=True)
    near = smp.sample(
        np.array([164900.0, 164990.0]),
        np.array([445010.0, 445010.0]),
    )
    cross = smp.sample(
        np.array([164990.0, 165010.0]),
        np.array([445010.0, 445010.0]),
    )
    assert np.all(np.isfinite(near)) and np.all(np.isfinite(cross))
    assert smp.stats["tiles_cached"] == 2  # same tile reused, neighbour used once

    # the exact verified WCS request shape is pinned
    assert el.coverage_url(32, 89, el.TILE_M, el.RES_M) == (
        "https://service.pdok.nl/rws/ahn/wcs/v1_0?SERVICE=WCS&VERSION=1.0.0"
        "&REQUEST=GetCoverage&COVERAGE=dtm_05m&CRS=EPSG:28992"
        "&BBOX=160000,445000,165000,450000&WIDTH=250&HEIGHT=250&FORMAT=image/tiff"
    )
    # invalid geometry is rejected up front
    with pytest.raises(ValueError):
        el.Sampler(cache_dir=tmp_path, res_m=30.0, tile_m=el.TILE_M)
    assert set(el.Sampler(cache_dir=tmp_path).stats) == {
        "tiles_cached",
        "tiles_fetched",
        "http_requests",
        "nodata_points",
    }


# ---------------------------------------------------------------------------
# 4. fix_bridges
# ---------------------------------------------------------------------------


def test_fix_bridges_straightens_canal_dip() -> None:
    s = np.arange(8, dtype=np.float64) * 10.0
    z = np.array([10.0, 9.0, 8.0, 2.0, 1.0, 2.0, 9.0, 10.0], dtype=np.float64)
    flags = np.array([False, False, False, True, True, True, False, False])
    original = z.copy()

    out = el.fix_bridges(s, z, flags)
    # straight line between the approach elevations z[2]=8 (s=20) and z[6]=9 (s=60)
    assert np.allclose(out[3:6], [8.25, 8.5, 8.75], atol=1e-9)
    assert np.all(np.diff(out[2:7]) >= 0)  # the dip is gone: monotone across the bridge
    # non-flagged points untouched, input not mutated, new array returned
    assert np.array_equal(out[[0, 1, 2, 6, 7]], z[[0, 1, 2, 6, 7]])
    assert np.array_equal(z, original)
    assert out is not z

    # tunnels get the same treatment
    out_t = el.fix_bridges(s, z, is_bridge=np.zeros(8, bool), is_tunnel=flags)
    assert np.array_equal(out_t, out)

    # float32 in -> float32 out, still not mutated
    z32 = z.astype(np.float32)
    out32 = el.fix_bridges(s, z32, flags)
    assert out32.dtype == np.float32
    assert np.allclose(out32[3:6], [8.25, 8.5, 8.75], atol=1e-6)


def test_fix_bridges_degenerate_cases() -> None:
    s = np.arange(6, dtype=np.float64) * 10.0
    z = np.array([5.0, 4.0, 3.0, 4.0, 6.0, 7.0])
    none = np.zeros(6, dtype=bool)
    # no flags at all: identical, untouched copy
    assert np.array_equal(el.fix_bridges(s, z, False), z)
    assert np.array_equal(el.fix_bridges(s, z, none), z)
    # run touching the array start: hold the right approach value
    out = el.fix_bridges(s, z, np.array([True, True, False, False, False, False]))
    assert np.allclose(out[:2], 3.0)
    assert np.array_equal(out[2:], z[2:])
    # run touching the array end: hold the left approach value (z[3] = 4)
    out = el.fix_bridges(s, z, np.array([False] * 4 + [True, True]))
    assert np.allclose(out[4:], 4.0)
    # NaN approach on one side collapses to the other side's constant value
    zn = z.copy()
    zn[0] = np.nan
    out = el.fix_bridges(s, zn, np.array([False, True, True, True, False, False]))
    assert np.allclose(out[1:4], 6.0)  # right approach z[4]
    assert np.isnan(out[0])  # outside the run: left untouched (NaN input)
    assert np.array_equal(out[[4, 5]], z[[4, 5]])
    # no anchor on either side (whole array flagged): leave as sampled
    assert np.array_equal(el.fix_bridges(s, z, True), z)
    # zero-length and mismatched inputs
    assert el.fix_bridges(np.zeros(0), np.zeros(0), np.zeros(0, bool)).shape == (0,)
    with pytest.raises(ValueError):
        el.fix_bridges(s[:5], z, none)
    with pytest.raises(ValueError):
        el.fix_bridges(np.zeros((2, 2)), np.zeros((2, 2)), none)


def test_fix_bridges_realistic_tunnel_hill() -> None:
    # road disappears into a hill: AHN reads the hill above the tunnel
    s = np.linspace(0.0, 300.0, 31)
    ground = 5.0 + 0.01 * s  # gentle approach grade
    z = ground.copy()
    z[10:21] = 40.0  # the hill above the tunnel
    z[10] = z[20] = 25.0  # even the abutment cells are polluted by the hill
    flags = np.zeros(31, dtype=bool)
    flags[10:21] = True
    out = el.fix_bridges(s, z, flags)
    # the whole flagged span, including the polluted abutment cells, is replaced
    # by the line between the clean approaches z[9] and z[21]
    expected = ground[9] + (s[10:21] - s[9]) / (s[21] - s[9]) * (ground[21] - ground[9])
    assert np.allclose(out[10:21], expected, atol=1e-9)
    assert np.array_equal(out[:10], z[:10])
    assert np.array_equal(out[21:], z[21:])


# ---------------------------------------------------------------------------
# 5. in-memory LRU cache behaviour
# ---------------------------------------------------------------------------


def test_memory_cache_no_reread(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ix, iy = 32, 89
    write_npy_tile(tmp_path, ix, iy, ramp_tile(ix, iy))
    smp = el.Sampler(cache_dir=tmp_path, offline=True)

    calls = {"reads": 0}
    real_loader = el.load_npy_tile

    def counting_loader(path, ix_, iy_, tile_m):
        calls["reads"] += 1
        return real_loader(path, ix_, iy_, tile_m)

    monkeypatch.setattr(el, "load_npy_tile", counting_loader)
    first = smp.sample(np.array(163000.0), np.array(445010.0))
    second = smp.sample(np.array(163010.0), np.array(445020.0))
    assert calls["reads"] == 1  # second sample served from the in-memory LRU
    assert bool(np.isfinite(first)) and bool(np.isfinite(second))
    assert smp.stats["tiles_cached"] == 1
    assert smp.stats["nodata_points"] == 0


def test_lru_evicts_beyond_cap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tile_m, res_m = 100, 20  # 5x5 pixel tiles -> cheap to create 70 of them
    smp = el.Sampler(cache_dir=tmp_path, res_m=res_m, tile_m=tile_m, offline=True)
    calls = {"reads": 0}
    real_loader = el.load_npy_tile

    def counting_loader(path, ix_, iy_, tile_m_):
        calls["reads"] += 1
        return real_loader(path, ix_, iy_, tile_m_)

    monkeypatch.setattr(el, "load_npy_tile", counting_loader)

    n_tiles = el.LRU_TILES + 6
    xs, ys, tiles = [], [], []
    for k in range(n_tiles):
        ix, iy = k, 7
        write_npy_tile(tmp_path, ix, iy, ramp_tile(ix, iy, tile_m=tile_m, npix=5), res_m=res_m)
        xs.append(ix * tile_m + 50.0)
        ys.append(iy * tile_m + 50.0)
    smp.sample(np.array(xs), np.array(ys))
    assert calls["reads"] == n_tiles
    assert len(smp._lru) == el.LRU_TILES
    # the first tile was evicted: sampling it again must re-read from disk
    smp.sample(np.array(xs[0]), np.array(ys[0]))
    assert calls["reads"] == n_tiles + 1


# ---------------------------------------------------------------------------
# 6. real server-format GeoTIFF: embedded live fixture
# ---------------------------------------------------------------------------


def test_real_server_tif_fixture(tmp_path: Path) -> None:
    raw = _fixture_bytes()
    assert raw[:4] == b"II*\x00"
    tile = el.decode_geotiff(raw)  # Deflate + predictor 3, no imagecodecs needed
    finite = np.isfinite(tile.z)
    assert tile.z.shape == (50, 50)
    assert tile.x0 == 163000.0 and tile.y_top == 445000.0
    assert tile.resx == 20.0 and tile.resy == 20.0
    assert int(finite.sum()) == 2500
    assert tile.z[finite].min() == pytest.approx(15.326415061950684, abs=1e-4)
    assert tile.z[finite].max() == pytest.approx(46.286067962646484, abs=1e-4)

    d = tmp_path / "ahn"
    d.mkdir(parents=True)
    (d / "dtm_x32_y88_r20.tif").write_bytes(raw)
    smp = el.Sampler(cache_dir=tmp_path, offline=True)

    xs = np.array([163250.0, 163512.3, 163999.5, 163777.7, 163001.1])
    ys = np.array([444250.0, 444777.2, 444888.8, 444123.4, 444555.5])
    got = smp.sample(xs, ys)
    assert np.allclose(got, _fixture_expected_samples(), atol=1e-3)

    # the fixture only covers 1 km of tile (32, 88): points elsewhere in the
    # tile are NaN, not extrapolated
    assert bool(np.isnan(smp.sample(np.array(162000.0), np.array(444500.0))))
    # a different tile has no data at all
    assert bool(np.isnan(smp.sample(np.array(163000.0), np.array(446000.0))))
    assert smp.stats["tiles_cached"] == 1


# ---------------------------------------------------------------------------
# 7. synthetic server-style GeoTIFF (predictor 3 + Deflate) written by hand
# ---------------------------------------------------------------------------


def test_synthetic_server_style_tif_roundtrip(tmp_path: Path) -> None:
    tile_m, res_m = 800, 20  # 40x40 pixels
    ix, iy = 3, 5
    npix = tile_m // res_m
    z = ramp_tile(ix, iy, tile_m=tile_m, npix=npix, res=res_m)
    z = z - 100.0  # shift into a plausible NAP range
    z[10:14, 20:24] = np.float32(3.4e38)  # AHN-style FLT_MAX nodata
    z[30:34, 4:8] = np.nan  # literal NaN nodata
    raw = write_tif_tile(tmp_path, z, ix, iy, tile_m=tile_m, res_m=res_m)
    assert raw[:4] == b"II*\x00"

    tile = el.decode_geotiff(raw)
    assert tile.z.shape == (40, 40)
    assert tile.x0 == 2400.0 and tile.y_top == 4800.0
    assert np.isnan(tile.z[11, 22])  # FLT_MAX converted to NaN
    assert np.isnan(tile.z[31, 5])  # NaN preserved

    smp = el.Sampler(cache_dir=tmp_path, res_m=res_m, tile_m=tile_m, offline=True)
    rng = np.random.default_rng(7)
    # interior points away from the nodata blocks reproduce the plane
    xs = 2400.0 + rng.uniform(30.0, 770.0, 3000)
    ys = 4000.0 + rng.uniform(30.0, 770.0, 3000)
    # nodata blocks: FLT_MAX at cols 20:24 x rows 10:14 -> x [2800,2880) y (4520,4600];
    # NaN at cols 4:8 x rows 30:34 -> x [2480,2560) y (4120,4200].  Points within one
    # half-cell (10 m) of either block can still interpolate against a nodata corner.
    keep = ~(
        ((xs > 2789.0) & (xs < 2891.0) & (ys > 4509.0) & (ys < 4611.0))
        | ((xs > 2469.0) & (xs < 2571.0) & (ys > 4109.0) & (ys < 4211.0))
    )
    got = smp.sample(xs[keep], ys[keep])
    assert not np.any(np.isnan(got))
    assert np.allclose(got, 0.001 * xs[keep] + 0.002 * ys[keep] - 100.0, atol=1e-3)

    # points over the nodata blocks are NaN
    assert bool(np.isnan(smp.sample(np.array(2810.0), np.array(4560.0))))  # in FLT_MAX block
    assert bool(np.isnan(smp.sample(np.array(2510.0), np.array(4160.0))))  # in NaN block
    # a point between a valid and a nodata cell: NaN (any-corner rule)
    assert bool(np.isnan(smp.sample(np.array(2795.0), np.array(4560.0))))
    assert smp.stats["tiles_cached"] == 1


# ---------------------------------------------------------------------------
# 8. prefetch accounting, fetch failures, missing markers
# ---------------------------------------------------------------------------


def test_prefetch_fetches_each_tile_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tile_m, res_m = 800, 20
    calls = {"fetches": 0}

    def fake_fetch(self, ix, iy):
        calls["fetches"] += 1
        z = ramp_tile(ix, iy, tile_m=tile_m, npix=tile_m // res_m, res=res_m)
        return build_ahn_style_tiff(z, ix * tile_m, (iy + 1) * tile_m, res_m)

    monkeypatch.setattr(el.Sampler, "_fetch_tile_bytes", fake_fetch)
    smp = el.Sampler(cache_dir=tmp_path, res_m=res_m, tile_m=tile_m)

    xs = np.array([2450.0, 3250.0, 850.0])  # tiles (3, ...), (4, ...), (1, ...)
    ys = np.array([4050.0, 4050.0, 4050.0])  # tile iy=5 for all
    fetched = smp.prefetch(xs, ys)
    assert fetched == 3
    assert calls["fetches"] == 3
    assert smp.stats["tiles_fetched"] == 3
    # all three tiles are on disk now, in the deterministic cache layout
    for ix in (1, 3, 4):
        assert (tmp_path / "ahn" / f"dtm_x{ix}_y5_r20.tif").is_file()
    # prefetching again fetches nothing
    assert smp.prefetch(xs, ys) == 0
    assert calls["fetches"] == 3
    # sampling works from the cache and from freshly fetched tiles alike
    z = smp.sample(xs, ys)
    assert np.all(np.isfinite(z))
    assert calls["fetches"] == 3  # everything was already prefetched
    # byte-identical cache: a second sampler decodes the same files offline
    offline = el.Sampler(cache_dir=tmp_path, res_m=res_m, tile_m=tile_m, offline=True)
    assert np.array_equal(offline.sample(xs, ys), z)
    assert offline.stats["tiles_cached"] == 3


def test_prefetch_offline_makes_no_requests(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(self, ix, iy):
        raise AssertionError("offline prefetch must not fetch")

    monkeypatch.setattr(el.Sampler, "_fetch_tile_bytes", boom)
    smp = el.Sampler(cache_dir=tmp_path, offline=True)
    assert smp.prefetch(np.array([163000.0, 200000.0]), np.array([445000.0, 460000.0])) == 0
    assert smp.stats["http_requests"] == 0
    assert not (tmp_path / "ahn").exists()


def test_fetch_failure_marks_missing_no_retry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"fetches": 0}

    def failing_fetch(self, ix, iy):
        calls["fetches"] += 1
        return None  # e.g. an OGC ServiceException from the server

    monkeypatch.setattr(el.Sampler, "_fetch_tile_bytes", failing_fetch)
    smp = el.Sampler(cache_dir=tmp_path)
    got = smp.sample(np.array([163250.0]), np.array([444250.0]))
    assert np.isnan(got[0])  # sample never raises
    marker = tmp_path / "ahn" / "dtm_x32_y88_r20.missing"
    assert marker.is_file()
    assert marker.read_bytes() == b"unavailable\n"
    # not retried within the same run
    again = smp.sample(np.array([163250.0]), np.array([444250.0]))
    assert np.isnan(again[0])
    assert calls["fetches"] == 1
    # a fresh sampler honours the marker without any fetch
    smp2 = el.Sampler(cache_dir=tmp_path)
    assert np.isnan(smp2.sample(np.array([163250.0]), np.array([444250.0]))[0])
    assert calls["fetches"] == 1
    assert smp2.stats["http_requests"] == 0


# ---------------------------------------------------------------------------
# 9. live PDOK service (opt-in)
# ---------------------------------------------------------------------------


@pytest.mark.network
@pytest.mark.skipif(
    os.environ.get("FUNROADS_NETWORK_TESTS") != "1",
    reason="live PDOK WCS test; set FUNROADS_NETWORK_TESTS=1 to enable",
)
def test_live_pdok_tile(tmp_path: Path) -> None:
    smp = el.Sampler(cache_dir=tmp_path)
    xs = np.array([163250.0, 163777.7, 163001.1])
    ys = np.array([444250.0, 444123.4, 444555.5])
    z = smp.sample(xs, ys)
    assert smp.stats["tiles_fetched"] == 1
    assert smp.stats["http_requests"] >= 1
    assert (tmp_path / "ahn" / "dtm_x32_y88_r20.tif").is_file()
    expected = np.asarray(_fixture_expected_samples())[[0, 3, 4]]
    assert np.allclose(z, expected, atol=0.5)  # same lattice as the 1 km fixture
    # second sample is served from the in-memory LRU, not re-read from disk
    z2 = smp.sample(xs, ys)
    assert np.array_equal(z, z2)
    assert smp.stats["tiles_cached"] == 0
    assert smp.stats["tiles_fetched"] == 1
    # a fresh offline sampler on the same cache loads the tile from disk
    smp2 = el.Sampler(cache_dir=tmp_path, offline=True)
    assert np.array_equal(smp2.sample(xs, ys), z)
    assert smp2.stats["tiles_cached"] == 1
    assert smp2.stats["tiles_fetched"] == 0
    assert smp2.stats["http_requests"] == 0
