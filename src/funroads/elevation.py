"""AHN4 DTM elevation sampling for FunRoads.

Fast, cached, deterministic bilinear elevation sampling of road centrelines
against the AHN4 DTM (0.5 m Dutch ground model) in RD New (EPSG:28992)
metre coordinates.  Elevation values are metres NAP.

Data source / verified WCS request shape
----------------------------------------
PDOK WCS endpoint: https://service.pdok.nl/rws/ahn/wcs/v1_0
(coverage ``dtm_05m``; the server resamples the 0.5 m DTM to any requested
resolution).  GetCapabilities advertises WCS 2.0.1 / 1.1.1 / 1.0.0 and the
``image/tiff`` output format.  The following WCS 1.0.0 GetCoverage shape was
probed and verified to work (HTTP 200, ``image/tiff``):

    https://service.pdok.nl/rws/ahn/wcs/v1_0?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE=dtm_05m&CRS=EPSG:28992&BBOX={x0},{y0},{x1},{y1}&WIDTH={npix}&HEIGHT={npix}&FORMAT=image/tiff

* ``BBOX`` is ``xmin,ymin,xmax,ymax`` in RD metres (y grows north).
* The response GeoTIFF carries ``ModelTiepoint (0,0,0 -> xmin,ymax,0)`` and
  ``ModelPixelScale (res, res, 0)``, i.e. row 0 is the northern edge.
* Repeat requests are byte-identical, so cached tiles (raw server bytes)
  are deterministic across runs.
* Bboxes fully outside the AHN domain (RD x [10000, 280000],
  y [306250, 618750], per DescribeCoverage) return an OGC
  ServiceException XML document with HTTP 200 -- detected and recorded as a
  permanently missing tile.  Sea tiles come back as valid all-nodata TIFFs.

Server TIFF decoding
--------------------
The server writes float32 GeoTIFF, compression 8 (Adobe Deflate = plain
zlib) with TIFF Predictor 3 ("floating point" predictor).  tifffile can
parse the tags but cannot decode Predictor 3 without the ``imagecodecs``
package, which is not part of this environment.  This module therefore
implements the libtiff ``fpAcc`` decode itself in pure numpy
(``_decode_fp_predictor``): per row, a flat running byte sum (mod 256)
over the compressed-plane stream, followed by a byte-plane transpose
(stream layout is [MSB plane of all samples][byte 2][byte 1][LSB plane]).
The implementation was validated bit-exactly against an imagecodecs
reference decode of live server tiles.

Nodata
------
The AHN WCS tiles use GDAL nodata = FLT_MAX (3.4028234663852886e+38).
Any non-finite value and any |value| >= 1e30 is converted to ``np.nan``
(and a GDAL_NODATA tag value, when present, is matched exactly).

Cache layout
------------
Tiles live under ``<cache_dir>/ahn/`` (default cache_dir:
``<repo>/data/cache``) as the RAW SERVER BYTES:

    dtm_x{ix}_y{iy}_r{res:g}.tif

The tile grid is aligned to multiples of ``tile_m`` (5 km):
``ix = floor(x / tile_m)``, ``iy = floor(y / tile_m)``; the same tile file
is reused across calls and runs.  ``tile_m`` must be an exact multiple of
``res_m`` so that every tile samples the same global lattice and adjacent
tiles join seamlessly.  Failed/absent tiles get a ``.missing`` marker file
(e.g. ``dtm_x32_y88_r20.missing``) so they are not retried; delete the
marker to retry.

As an offline/test alternative the sampler also accepts NumPy ``.npy``
tiles named the same way (``dtm_x{ix}_y{iy}_r{res:g}.npy``): a 2-D float
array where row 0 is the NORTHERN edge (y descending), column 0 is the
WESTERN edge, the raster spans the whole tile (``tile_m`` metres), and
``np.nan`` marks nodata.
"""

from __future__ import annotations

import io
import logging
import os
import time
import zlib
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np
import requests
import tifffile

log = logging.getLogger("funroads.elevation")


class _GdalNodataNoise(logging.Filter):
    """Drop tifffile's per-tile complaint about the server's GDAL_NODATA
    FLT_MAX value (it is not castable to float32; we parse the tag string
    ourselves in _nodata_from_tag).  Keeps 1000-tile prefetches quiet."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "GDAL_NODATA" not in record.getMessage()


logging.getLogger("tifffile").addFilter(_GdalNodataNoise())

# --- public constants -------------------------------------------------------
TILE_M = 5000  # tile size in RD metres
RES_M = 20.0  # raster resolution in metres (pixels per tile = TILE_M / RES_M)

# --- WCS configuration (verified against the live service) ------------------
WCS_URL = "https://service.pdok.nl/rws/ahn/wcs/v1_0"
COVERAGE = "dtm_05m"

# --- tunables ---------------------------------------------------------------
LRU_TILES = 64  # decoded tiles kept in memory (~16 MB at 250x250 float32)
HTTP_TIMEOUT = 120.0  # seconds per request
HTTP_RETRIES = 3  # retries per tile (fixed, deterministic backoff below)
BACKOFF_S = (1.0, 3.0, 9.0)  # deterministic backoff, no jitter
USER_AGENT = "funroads/0.1"
NODATA_LIMIT = 1e30  # |z| >= this is treated as AHN nodata (server sends FLT_MAX)

# tile-key packing for vectorised grouping: |ix|, |iy| < 2**20 is far more
# than the RD grid will ever need.
_KEY_OFFSET = 1 << 20
_KEY_STRIDE = 1 << 21

_TIFF_MAGICS = (b"II*\x00", b"MM\x00*")

_TAG_MODELPIXELSCALE = 33550
_TAG_MODELTIEPOINT = 33922
_TAG_MODELTRANSFORMATION = 34264
_TAG_GDALNODATA = 42113


def _default_cache_dir() -> Path:
    """Project cache directory (funroads repo data/cache)."""
    return Path(__file__).resolve().parents[2] / "data" / "cache"


def _res_token(res_m: float) -> str:
    """Deterministic resolution token for file names (20.0 -> '20')."""
    return f"{res_m:g}"


def _tile_indices(x: np.ndarray, y: np.ndarray, tile_m: int) -> tuple[np.ndarray, np.ndarray]:
    """Grid-aligned tile indices: ix = floor(x / tile_m), iy = floor(y / tile_m)."""
    ix = np.floor(np.asarray(x, dtype=np.float64) / float(tile_m)).astype(np.int64)
    iy = np.floor(np.asarray(y, dtype=np.float64) / float(tile_m)).astype(np.int64)
    return ix, iy


def _tile_paths(cache_dir: Path, ix: int, iy: int, res_m: float) -> tuple[Path, Path, Path, str]:
    """Return (tif_path, npy_path, missing_marker_path, base_no_suffix) for a tile."""
    base = Path(cache_dir) / "ahn" / f"dtm_x{int(ix)}_y{int(iy)}_r{_res_token(res_m)}"
    return Path(str(base) + ".tif"), Path(str(base) + ".npy"), Path(str(base) + ".missing"), str(base)


def coverage_url(ix: int, iy: int, tile_m: int, res_m: float) -> str:
    """Verified WCS 1.0.0 GetCoverage URL for one grid-aligned tile.

    See module docstring for the probe results that fixed this shape.
    """
    npix = int(round(float(tile_m) / float(res_m)))
    x0, y0 = int(ix) * int(tile_m), int(iy) * int(tile_m)
    return (
        f"{WCS_URL}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage"
        f"&COVERAGE={COVERAGE}&CRS=EPSG:28992"
        f"&BBOX={x0},{y0},{x0 + int(tile_m)},{y0 + int(tile_m)}"
        f"&WIDTH={npix}&HEIGHT={npix}&FORMAT=image/tiff"
    )


# ---------------------------------------------------------------------------
# GeoTIFF decoding (tifffile for tags, numpy for pixels)
# ---------------------------------------------------------------------------


class _Tile:
    """A decoded raster tile: float32 z with NaN nodata, plus its geotransform."""

    __slots__ = ("z", "x0", "y_top", "resx", "resy")

    def __init__(self, z: np.ndarray, x0: float, y_top: float, resx: float, resy: float) -> None:
        self.z = z  # (nrows, ncols) float32, row 0 = northern edge, NaN = nodata
        self.x0 = x0  # RD x of the west edge of column 0
        self.y_top = y_top  # RD y of the north edge of row 0
        self.resx = resx  # metres per pixel in x
        self.resy = resy  # metres per pixel in y


class _DecodeFallback(Exception):
    """Raised internally when the fast manual decode path does not apply."""


def _decode_fp_predictor(rows: np.ndarray, bps: int, byteorder: str) -> np.ndarray:
    """Invert TIFF Predictor 3 (floating point horizontal differencing).

    Implements libtiff's fpAcc: per row, the byte stream is a flat running
    sum (mod 256) whose layout is byte-planar -- plane 0 holds the most
    significant byte of every sample, then byte 2, byte 1 and the least
    significant byte planes.  Samples are reassembled in the file byte
    order.  ``rows`` is (nrows, ncols*bps) uint8; returns (nrows, ncols)
    float32 for bps=4 (float64 for bps=8, float16 for bps=2).
    """
    ncols = rows.shape[1] // bps
    acc = np.cumsum(rows.astype(np.uint64), axis=1) & 0xFF
    acc = acc.astype(np.uint8)
    planes = acc.reshape(-1, bps, ncols)  # plane 0 = MSB plane
    if byteorder == "<":  # little-endian file: sample bytes run LSB..MSB
        plane_bytes = planes[:, ::-1, :]
    else:  # big-endian file: sample bytes already run MSB..LSB
        plane_bytes = planes
    contiguous = np.ascontiguousarray(plane_bytes.transpose(0, 2, 1))
    return contiguous.view(np.dtype(f"{byteorder}f{bps}")).reshape(-1, ncols)


def _decode_delta_predictor(rows: np.ndarray, bps: int, byteorder: str) -> np.ndarray:
    """Invert TIFF Predictor 2 (horizontal differencing) for 8/16/32/64-bit
    samples (libtiff horAcc: element-wise running sum along the row)."""
    item = np.dtype(f"{byteorder}u{bps}")
    elements = rows.view(item).reshape(-1, rows.shape[1] // bps)
    acc = np.cumsum(elements.astype(np.uint64), axis=1) & np.iinfo(item).max
    return acc.astype(item)


def _page_dtype(page: tifffile.TiffPage) -> np.dtype:
    tag = page.tags.get(339)  # SampleFormat
    sampleformat = int(tag.value) if tag is not None else 1
    bps = int(page.bitspersample)
    if sampleformat == 3:  # IEEE floating point
        return np.dtype(f"f{bps // 8}")
    if sampleformat == 2:  # signed int
        return np.dtype(f"i{bps // 8}")
    return np.dtype(f"u{bps // 8}")


def _page_pixels(page: tifffile.TiffPage, raw: bytes, byteorder: str) -> np.ndarray:
    """Decode the pixel data of a single-page striped GeoTIFF.

    Manual, dependency-free path for the layouts the AHN WCS emits:
    compression none/Deflate with predictor none/horizontal/floating-point,
    one sample per pixel, 1/2/4/8 bytes per sample.
    """
    width, height = int(page.imagewidth), int(page.imagelength)
    compression = int(page.compression)
    predictor = int(page.predictor)
    bps = int(page.bitspersample) // 8
    spp = int(page.samplesperpixel)
    planar_tag = page.tags.get(284)  # PlanarConfiguration (absent = contiguous)
    sampleformat_tag = page.tags.get(339)  # SampleFormat (absent = unsigned int)
    sampleformat = int(sampleformat_tag.value) if sampleformat_tag is not None else 1
    if (
        page.is_tiled
        or (planar_tag is not None and int(planar_tag.value) != 1)
        or spp != 1
        or bps not in (1, 2, 4, 8)
        or compression not in (1, 8, 32946)
        or predictor not in (1, 2, 3)
        or (sampleformat == 3 and bps not in (2, 4, 8))
        or (predictor == 3 and sampleformat != 3)
    ):
        raise _DecodeFallback("unsupported compression/predictor/layout combination")

    rowbytes = width * bps
    pieces: list[np.ndarray] = []
    for off, cnt in zip(page.dataoffsets, page.databytecounts):
        data = raw[off : off + cnt]
        if compression in (8, 32946):  # Adobe Deflate / Deflate == plain zlib
            data = zlib.decompress(data)
        if len(data) % rowbytes != 0:
            raise _DecodeFallback(f"strip length {len(data)} not a multiple of {rowbytes}")
        nrows = len(data) // rowbytes
        rows = np.frombuffer(data, dtype=np.uint8).reshape(nrows, rowbytes)
        if predictor == 3:
            # already returns samples in the page dtype (float)
            pieces.append(_decode_fp_predictor(rows, bps, byteorder))
        elif predictor == 2:
            pieces.append(_decode_delta_predictor(rows, bps, byteorder))
        else:
            pieces.append(rows.view(np.dtype(f"{byteorder}u{bps}")))
    result = np.concatenate(pieces, axis=0).reshape(height, width)
    if predictor == 3:
        return result  # float dtype already applied
    # predictors 1/2 above decoded raw units; reinterpret as the page dtype
    return result.view(_page_dtype(page))


def _page_geotransform(page: tifffile.TiffPage) -> tuple[float, float, float, float]:
    """(x0, y_top, resx, resy) from GeoTIFF tags; row 0 = north edge."""
    scale = page.tags.get(_TAG_MODELPIXELSCALE)
    tie = page.tags.get(_TAG_MODELTIEPOINT)
    if scale is not None and tie is not None:
        sx, sy = float(scale.value[0]), float(scale.value[1])
        i, j = float(tie.value[0]), float(tie.value[1])
        x0 = float(tie.value[3]) - i * sx
        y_top = float(tie.value[4]) + j * sy
        return x0, y_top, sx, sy
    trans = page.tags.get(_TAG_MODELTRANSFORMATION)
    if trans is not None and len(trans.value) >= 16:
        m = [float(v) for v in trans.value[:16]]
        if m[1] == 0.0 and m[4] == 0.0 and m[5] != 0.0:
            return m[3], m[7], m[0], -m[5]
    raise ValueError("GeoTIFF has no usable georeferencing tags")


def _nodata_from_tag(page: tifffile.TiffPage) -> float | None:
    tag = page.tags.get(_TAG_GDALNODATA)
    if tag is None:
        return None
    try:
        value = float(str(tag.value).strip().strip('"'))
    except (TypeError, ValueError):
        return None
    return value if np.isfinite(value) else None


def _to_nan_float32(arr: np.ndarray, nodata: float | None) -> np.ndarray:
    """float32 copy with nodata (FLT_MAX / GDAL_NODATA tag / non-finite) as NaN."""
    z = np.array(arr, dtype=np.float32)  # always a writable copy
    bad = ~np.isfinite(z)
    bad |= np.abs(z) >= NODATA_LIMIT
    if nodata is not None:
        bad |= z == np.float32(nodata)
    z[bad] = np.nan
    return z


def decode_geotiff(raw: bytes) -> _Tile:
    """Decode an AHN WCS GeoTIFF (or any of the supported variants) to a _Tile.

    Prefers the dependency-free manual path (Deflate/no compression with
    predictors 1/2/3); falls back to ``tifffile.imread`` for other layouts.
    Raises ValueError when the bytes are not a decodable GeoTIFF.
    """
    if raw[:4] not in _TIFF_MAGICS:
        raise ValueError("not a TIFF file")
    with tifffile.TiffFile(io.BytesIO(raw)) as tf:
        page = tf.pages[0]
        byteorder = tf.byteorder
        expected_shape = (int(page.imagelength), int(page.imagewidth))
        nodata = _nodata_from_tag(page)
        x0, y_top, resx, resy = _page_geotransform(page)
        try:
            pixels = _page_pixels(page, raw, byteorder)
        except _DecodeFallback:
            try:
                pixels = np.asarray(tifffile.imread(io.BytesIO(raw)))
            except Exception as exc:  # pragma: no cover - exotic layouts only
                raise ValueError(f"cannot decode GeoTIFF pixels: {exc}") from exc
    if tuple(pixels.shape) != expected_shape:  # pragma: no cover
        raise ValueError(f"unexpected raster shape {pixels.shape}")
    return _Tile(_to_nan_float32(pixels, nodata), x0, y_top, resx, resy)


def load_npy_tile(path: Path, ix: int, iy: int, tile_m: int) -> _Tile:
    """Load a .npy cache tile.

    Convention: 2-D array spanning the whole tile, row 0 = NORTHERN edge
    (y descending), column 0 = WESTERN edge, np.nan = nodata.
    """
    arr = np.asarray(np.load(path, allow_pickle=False))
    if arr.ndim != 2 or min(arr.shape) < 1:
        raise ValueError(f"bad .npy tile shape {arr.shape}")
    nrows, ncols = arr.shape
    z = np.array(arr, dtype=np.float32)
    z[~np.isfinite(z)] = np.nan
    return _Tile(
        z,
        float(int(ix) * int(tile_m)),
        float((int(iy) + 1) * int(tile_m)),
        float(tile_m) / ncols,
        float(tile_m) / nrows,
    )


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------


def _sample_tile(tile: _Tile, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Bilinear elevation for points inside one tile (NaN where unavailable).

    Cell (r, c) covers [x0 + c*resx, x0 + (c+1)*resx) x
    [y_top - (r+1)*resy, y_top - r*resy) with its value at the centre, so
    cell centres are at x0 + (c + 0.5)*resx and y_top - (r + 0.5)*resy.
    Points beyond the raster footprint (more than half a pixel outside the
    centre span) return NaN; the half-pixel margins are clamped to the edge
    so tile-boundary points are seamless.  If any of the four surrounding
    cells is nodata the result is NaN (conservative for a ground model).
    """
    z = tile.z
    nrows, ncols = z.shape
    u = (xs - tile.x0) / tile.resx - 0.5  # continuous column coordinate
    v = (tile.y_top - ys) / tile.resy - 0.5  # continuous row coordinate
    inside = (
        (u >= -0.5)
        & (u <= ncols - 0.5)
        & (v >= -0.5)
        & (v <= nrows - 0.5)
    )
    uc = np.clip(u, 0.0, float(ncols - 1))
    vc = np.clip(v, 0.0, float(nrows - 1))
    c0 = uc.astype(np.int64)
    r0 = vc.astype(np.int64)
    c1 = np.minimum(c0 + 1, ncols - 1)
    r1 = np.minimum(r0 + 1, nrows - 1)
    fu = (uc - c0).astype(np.float32)
    fv = (vc - r0).astype(np.float32)
    z00 = z[r0, c0]
    z01 = z[r0, c1]
    z10 = z[r1, c0]
    z11 = z[r1, c1]
    out = (z00 * (1.0 - fu) + z01 * fu) * (1.0 - fv) + (z10 * (1.0 - fu) + z11 * fu) * fv
    out = out.astype(np.float32, copy=False)
    out[~inside] = np.nan
    return out


# ---------------------------------------------------------------------------
# Bridge / tunnel profile repair
# ---------------------------------------------------------------------------


def fix_bridges(
    s: np.ndarray,
    z: np.ndarray,
    is_bridge: bool,
    is_tunnel: bool = False,
) -> np.ndarray:
    """Replace bridge/tunnel profile segments with a straight deck line.

    AHN is a ground model: bridges and tunnels are absent from it, so a
    road over a canal reads as a dip into the water and a road through a
    hill reads as the hill above the tunnel.  For every maximal run of
    points flagged as bridge or tunnel, the profile is replaced by a
    straight line between the two endpoint elevations -- the elevations of
    the nearest non-flagged road points on either side (the approaches),
    evaluated at their own distances in ``s``.  If only one side is
    available (the run touches an array end) its value is held constant
    across the run; if neither is available the run is left untouched.

    ``s`` is the monotonically increasing distance along the road, ``z``
    the sampled elevations (any float dtype; NaN allowed), ``is_bridge`` /
    ``is_tunnel`` boolean masks (or scalars) over the same points.  Runs
    whose approach elevation is NaN (e.g. over water) collapse to the
    remaining approach's constant value.

    Returns a NEW array (the input is never mutated); dtype follows ``z``
    for float inputs, else float32.
    """
    sa = np.asarray(s, dtype=np.float64)
    za = np.asarray(z)
    if sa.ndim != 1 or za.ndim != 1:
        raise ValueError("s and z must be 1-D arrays")
    if sa.shape[0] != za.shape[0]:
        raise ValueError("s and z must have the same length")
    n = za.shape[0]
    out_dtype = za.dtype if za.dtype.kind == "f" else np.dtype(np.float32)
    out = za.astype(out_dtype)  # astype always copies -> input is never mutated
    if n == 0:
        return out

    flags = np.broadcast_to(np.asarray(is_bridge, dtype=bool), (n,)) | np.broadcast_to(
        np.asarray(is_tunnel, dtype=bool), (n,)
    )
    if not flags.any():
        return out

    z64 = za.astype(np.float64)
    edges = np.empty(n + 2, dtype=bool)
    edges[0] = edges[-1] = False
    edges[1:-1] = flags
    diff = np.diff(edges.astype(np.int8))
    starts = np.flatnonzero(diff == 1)
    ends = np.flatnonzero(diff == -1) - 1

    def anchor(idx: int) -> tuple[float, float]:
        if idx < 0 or idx >= n:
            return np.nan, np.nan
        sv, zv = float(sa[idx]), z64[idx]
        if not np.isfinite(sv) or not np.isfinite(zv):
            return np.nan, np.nan
        return zv, sv

    for i0, i1 in zip(starts.tolist(), ends.tolist()):
        lz, ls = anchor(i0 - 1)
        rz, rs = anchor(i1 + 1)
        if np.isnan(lz) and np.isnan(rz):
            continue  # no anchor on either side: leave the profile as sampled
        if np.isnan(lz):
            lz, ls = rz, rs  # single-sided: hold the available approach value
        elif np.isnan(rz):
            rz, rs = lz, ls
        span = rs - ls
        seg = sa[i0 : i1 + 1]
        if span > 0.0:
            line = lz + (seg - ls) / span * (rz - lz)
        else:
            line = np.full(seg.shape, lz)
        out[i0 : i1 + 1] = line.astype(out_dtype, copy=False)
    return out


# ---------------------------------------------------------------------------
# Sampler
# ---------------------------------------------------------------------------


class Sampler:
    """Cached AHN elevation sampler for RD New coordinates.

    Parameters
    ----------
    cache_dir:
        Root cache directory; tiles are stored under ``<cache_dir>/ahn/``.
        Defaults to the project's ``data/cache`` directory.
    res_m:
        Raster resolution in metres (pixels per tile = tile_m / res_m).
    tile_m:
        Tile edge in metres; must be an exact multiple of ``res_m`` so all
        tiles sample one shared lattice and join seamlessly.
    offline:
        Never touch the network; only cached tiles are used and everything
        else samples as NaN.  (For deterministic tests and reruns.)

    Notes
    -----
    * ``sample()`` never raises; points without coverage (missing tiles,
      nodata cells, outside the country) come back as ``np.nan``.
    * ``stats`` keys: ``tiles_cached`` (tiles served from disk cache),
      ``tiles_fetched`` (tiles fetched over HTTP), ``http_requests``
      (HTTP attempts, including retries), ``nodata_points`` (points that
      returned NaN from ``sample()``).
    * Not thread-safe; use one ``Sampler`` per thread.
    """

    def __init__(
        self,
        cache_dir: Path | None = None,
        res_m: float = RES_M,
        tile_m: int = TILE_M,
        offline: bool = False,
    ) -> None:
        if not (res_m > 0):
            raise ValueError("res_m must be positive")
        if not (int(tile_m) == tile_m and tile_m > 0):
            raise ValueError("tile_m must be a positive integer")
        npix = int(round(tile_m / res_m))
        if abs(tile_m - npix * res_m) > 1e-9 * tile_m:
            raise ValueError(f"tile_m {tile_m} must be an exact multiple of res_m {res_m}")
        self.res_m = float(res_m)
        self.tile_m = int(tile_m)
        self.npix = npix
        self.cache_dir = Path(cache_dir) if cache_dir is not None else _default_cache_dir()
        self.offline = bool(offline)
        self._lru: "OrderedDict[tuple[int, int], _Tile]" = OrderedDict()
        self._missing: set[tuple[int, int]] = set()
        self._session: requests.Session | None = None
        self._tiles_cached = 0
        self._tiles_fetched = 0
        self._http_requests = 0
        self._nodata_points = 0

    # -- stats ------------------------------------------------------------

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "tiles_cached": self._tiles_cached,
            "tiles_fetched": self._tiles_fetched,
            "http_requests": self._http_requests,
            "nodata_points": self._nodata_points,
        }

    # -- tile access -------------------------------------------------------

    def _tile_for(
        self, ix: int, iy: int, progress: tuple[int, int] | None = None
    ) -> _Tile | None:
        """Return the decoded tile for grid cell (ix, iy), or None if
        unavailable (never raises; fetch failures are logged + marked)."""
        key = (ix, iy)
        tile = self._lru.get(key)
        if tile is not None:
            self._lru.move_to_end(key)
            return tile
        if not self.offline and key in self._missing:
            return None
        tile, marked = self._tile_from_disk(ix, iy)
        if tile is not None:
            self._remember(key, tile)
            return tile
        if marked:
            if not self.offline:
                self._missing.add(key)
            return None
        if self.offline:
            return None
        tile = self._tile_from_network(ix, iy, progress)
        if tile is None:
            return None
        self._remember(key, tile)
        return tile

    def _remember(self, key: tuple[int, int], tile: _Tile) -> None:
        self._lru[key] = tile
        while len(self._lru) > LRU_TILES:
            self._lru.popitem(last=False)

    def _tile_from_disk(self, ix: int, iy: int) -> tuple[_Tile | None, bool]:
        """Try the on-disk cache.  Returns (tile, marker_present).

        A tile of None without a marker means "nothing cached yet" (fetch
        allowed); None with a marker means "known missing" (do not fetch).
        An unreadable cache file is treated as not cached (it will be
        re-fetched and overwritten, self-healing the cache).
        """
        tif_path, npy_path, marker, _ = _tile_paths(self.cache_dir, ix, iy, self.res_m)
        try:
            if tif_path.is_file():
                tile = decode_geotiff(tif_path.read_bytes())
                self._tiles_cached += 1
                return tile, False
            if npy_path.is_file():
                tile = load_npy_tile(npy_path, ix, iy, self.tile_m)
                self._tiles_cached += 1
                return tile, False
        except (OSError, ValueError) as exc:
            log.warning("tile %d,%d cache file is unreadable (%s); refetching", ix, iy, exc)
            return None, False
        return None, marker.is_file()

    def _tile_from_network(
        self, ix: int, iy: int, progress: tuple[int, int] | None = None
    ) -> _Tile | None:
        raw = self._fetch_tile_bytes(ix, iy)
        if raw is None:
            self._mark_missing(ix, iy)
            return None
        try:
            tile = decode_geotiff(raw)
        except ValueError as exc:
            self._mark_missing(ix, iy, f"undecodable response: {exc}")
            return None
        tif_path, _, _, base = _tile_paths(self.cache_dir, ix, iy, self.res_m)
        try:
            Path(base).parent.mkdir(parents=True, exist_ok=True)
            tmp = Path(base + f".tmp{os.getpid()}")
            tmp.write_bytes(raw)  # raw server bytes -> byte-identical across runs
            os.replace(tmp, tif_path)
        except OSError as exc:  # pragma: no cover - disk issues
            log.warning("tile %d,%d could not be written to cache (%s)", ix, iy, exc)
        self._tiles_fetched += 1
        if progress is not None:
            log.info("fetched tile %d,%d (%d of %d)", ix, iy, progress[0], progress[1])
        return tile

    def _fetch_tile_bytes(self, ix: int, iy: int) -> bytes | None:
        """GET the tile from the PDOK WCS with retries; None on failure."""
        if self._session is None:
            self._session = requests.Session()
            self._session.headers["User-Agent"] = USER_AGENT
        url = coverage_url(ix, iy, self.tile_m, self.res_m)
        reason = "unknown"
        for attempt in range(HTTP_RETRIES + 1):
            if attempt:
                time.sleep(BACKOFF_S[attempt - 1])  # fixed backoff, no jitter
            try:
                self._http_requests += 1
                resp = self._session.get(url, timeout=HTTP_TIMEOUT)
            except requests.RequestException as exc:
                reason = f"{type(exc).__name__}: {exc}"
                continue  # transient: retry
            if resp.status_code == 200 and resp.content[:4] in _TIFF_MAGICS:
                return resp.content
            ctype = resp.headers.get("Content-Type", "")
            reason = f"HTTP {resp.status_code} ({ctype})"
            # A ServiceException (200 + XML) or any 4xx other than 429 is a
            # definitive answer (e.g. outside the AHN domain): do not retry.
            if not (resp.status_code == 429 or resp.status_code >= 500):
                break
        log.debug("tile %d,%d fetch failed: %s", ix, iy, reason)
        return None

    def _mark_missing(self, ix: int, iy: int, reason: str = "fetch failed") -> None:
        _, _, marker, base = _tile_paths(self.cache_dir, ix, iy, self.res_m)
        try:
            Path(base).parent.mkdir(parents=True, exist_ok=True)
            marker.write_bytes(b"unavailable\n")  # fixed content, deterministic
        except OSError as exc:  # pragma: no cover - disk issues
            log.warning("tile %d,%d marker could not be written (%s)", ix, iy, exc)
        self._missing.add((ix, iy))
        log.warning("tile %d,%d unavailable (%s); marked missing", ix, iy, reason)

    # -- public API ---------------------------------------------------------

    @staticmethod
    def _group_by_tile(xs: np.ndarray, ys: np.ndarray, tile_m: int) -> list[tuple[int, int, np.ndarray]]:
        """Group point indices by tile; deterministic order."""
        ix, iy = _tile_indices(xs, ys, tile_m)
        keys = (ix + _KEY_OFFSET) * _KEY_STRIDE + (iy + _KEY_OFFSET)
        order = np.argsort(keys, kind="stable")
        sorted_keys = keys[order]
        if sorted_keys.size == 0:
            return []
        bounds = np.flatnonzero(sorted_keys[1:] != sorted_keys[:-1]) + 1
        starts = np.concatenate(([0], bounds))
        firsts = sorted_keys[starts]
        return [
            (
                int(k // _KEY_STRIDE) - _KEY_OFFSET,
                int(k % _KEY_STRIDE) - _KEY_OFFSET,
                group,
            )
            for k, group in zip(firsts, np.split(order, bounds))
        ]

    def sample(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        """Bilinear elevation in metres NAP for RD New coordinates.

        Returns float32 with ``np.nan`` where unavailable (outside the
        AHN coverage, missing tiles, nodata cells, non-finite inputs).
        Fetches and caches tiles as needed; never raises.
        """
        xa = np.asarray(x, dtype=np.float64)
        ya = np.asarray(y, dtype=np.float64)
        shape = np.broadcast_shapes(xa.shape, ya.shape)
        xs = np.ascontiguousarray(np.broadcast_to(xa, shape).ravel())
        ys = np.ascontiguousarray(np.broadcast_to(ya, shape).ravel())
        out = np.full(xs.shape, np.nan, dtype=np.float32)
        finite = np.isfinite(xs) & np.isfinite(ys)
        if finite.any():
            fin_idx = np.flatnonzero(finite)
            groups = self._group_by_tile(xs[fin_idx], ys[fin_idx], self.tile_m)
            total = len(groups)
            for n, (ix, iy, group) in enumerate(groups, start=1):
                tile = self._tile_for(ix, iy, progress=(n, total))
                if tile is None:
                    continue
                idx = fin_idx[group]
                out[idx] = _sample_tile(tile, xs[idx], ys[idx])
        self._nodata_points += int(np.count_nonzero(np.isnan(out)))
        return out.reshape(shape)

    def prefetch(self, x: np.ndarray, y: np.ndarray) -> int:
        """Ensure all tiles covering these points are cached.

        Returns the number of tiles fetched over HTTP in this call
        (offline samplers always return 0).
        """
        xa = np.asarray(x, dtype=np.float64)
        ya = np.asarray(y, dtype=np.float64)
        shape = np.broadcast_shapes(xa.shape, ya.shape)
        xs = np.ascontiguousarray(np.broadcast_to(xa, shape).ravel())
        ys = np.ascontiguousarray(np.broadcast_to(ya, shape).ravel())
        finite = np.isfinite(xs) & np.isfinite(ys)
        fetched = 0
        if finite.any():
            groups = self._group_by_tile(xs[finite], ys[finite], self.tile_m)
            total = len(groups)
            for n, (ix, iy, _group) in enumerate(groups, start=1):
                before = self._tiles_fetched
                self._tile_for(ix, iy, progress=(n, total))
                fetched += self._tiles_fetched - before
        return fetched


# ---------------------------------------------------------------------------
# Smoke-test CLI
# ---------------------------------------------------------------------------


def run(bbox: tuple[float, float, float, float] | None = None) -> None:
    """Prefetch tiles for a WGS84 bbox (or a default near the Amerongse Berg)
    and log sampling stats.  Intended for smoke tests:

        python -m funroads.elevation
    """
    from pyproj import Transformer  # lazy: only the CLI needs projections

    if bbox is None:
        to_wgs = Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True)
        lon, lat = to_wgs.transform(163000.0, 445000.0)  # Amerongse Berg
        bbox = (lon - 0.03, lat - 0.025, lon + 0.03, lat + 0.025)
    lon0, lat0, lon1, lat1 = bbox
    to_rd = Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True)
    cx, cy = to_rd.transform([lon0, lon1], [lat0, lat1])
    xmin, xmax = min(cx), max(cx)
    ymin, ymax = min(cy), max(cy)
    log.info(
        "prefetching AHN tiles for bbox lon/lat (%.4f, %.4f, %.4f, %.4f) -> RD x[%.0f, %.0f] y[%.0f, %.0f]",
        lon0, lat0, lon1, lat1, xmin, xmax, ymin, ymax,
    )
    sampler = Sampler()
    gx = np.linspace(xmin, xmax, 201)
    gy = np.linspace(ymin, ymax, 201)
    xx, yy = np.meshgrid(gx, gy)
    points_x = xx.ravel()
    points_y = yy.ravel()
    fetched = sampler.prefetch(points_x, points_y)
    log.info("prefetch fetched %d tiles", fetched)
    z = sampler.sample(points_x, points_y)
    finite = np.isfinite(z)
    if finite.any():
        log.info(
            "sampled %d points: min %.2f m, mean %.2f m, max %.2f m, NaN %.1f%%",
            z.size,
            float(z[finite].min()),
            float(z[finite].mean()),
            float(z[finite].max()),
            100.0 * float(np.count_nonzero(~finite)) / z.size,
        )
    else:
        log.info("sampled %d points: all NaN", z.size)
    log.info("stats: %s", sampler.stats)


if __name__ == "__main__":  # pragma: no cover
    import logging as _logging

    _logging.basicConfig(
        level=_logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    run()
