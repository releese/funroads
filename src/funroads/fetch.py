"""Download and unpack every data source, recording a reproducible manifest.

Every file that lands in data/raw gets an entry in data/manifest.json with the
source URL, fetch date, size and sha256. Re-running `python -m funroads fetch`
re-uses files that are already on disk, so the pipeline is reproducible against
the same snapshot without re-downloading.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import re
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from .config import ensure_dirs, load_sources, read_manifest, write_manifest

log = logging.getLogger("funroads.fetch")

USER_AGENT = "funroads/0.1 (personal route planning; contact via GitHub)"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def _fetch(url: str, dest: Path, session: requests.Session, retries: int = 3) -> Path:
    """Stream url to dest via a .part file; never clobber a completed file.

    Transient failures (5xx, connection drop, timeout) retry with a fixed
    1 s/3 s/9 s backoff; client errors raise immediately. Successful bytes are
    identical either way, so recorded checksums keep runs reproducible.
    """
    if dest.exists() and dest.stat().st_size > 0:
        log.info("cached: %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries + 1):
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            log.info("downloading %s -> %s", url, dest.name)
            with session.get(url, stream=True, timeout=180) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.rename(dest)
            log.info("done: %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)
            return dest
        except requests.HTTPError as error:
            status = error.response.status_code if error.response is not None else 0
            if status < 500 or attempt == retries:
                raise
            log.info("HTTP %d, retrying %s", status, dest.name)
        except (requests.ConnectionError, requests.Timeout):
            if attempt == retries:
                raise
            log.info("connection failure, retrying %s", dest.name)
        time.sleep((1.0, 3.0, 9.0)[attempt])
    raise AssertionError("unreachable")


def latest_wkd_zip(listing_url: str, session: requests.Session) -> str:
    """Pick the newest MM-YYYY.zip entry from the RWS directory listing."""
    r = session.get(listing_url, timeout=60)
    r.raise_for_status()
    names = re.findall(r'href="(\d{2}-\d{2}-\d{4})\.zip"', r.text)
    if not names:
        raise RuntimeError(f"no WKD zips found at {listing_url}")
    # dd-mm-yyyy; sort by (yyyy, mm) descending.
    def key(n: str) -> tuple[int, int, int]:
        dd, mm, yy = n.split("-")
        return int(yy), int(mm), int(dd)

    best = max(names, key=key)
    return f"{listing_url.rstrip('/')}/{best}.zip", best


def _unzip(zip_path: Path, out_dir: Path) -> None:
    if out_dir.exists() and any(out_dir.iterdir()):
        log.info("cached: %s already extracted", out_dir.name)
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    log.info("extracting %s -> %s", zip_path.name, out_dir)
    with zipfile.ZipFile(zip_path) as z:
        # Deterministic extraction order.
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            z.extract(info, out_dir)


def _unzip_gzip(gz_path: Path, out_path: Path) -> None:
    if out_path.exists() and out_path.stat().st_size > 0:
        log.info("cached: %s already unpacked", out_path.name)
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    log.info("unpacking %s -> %s", gz_path.name, out_path.name)
    with gzip.open(gz_path, "rb") as fin, open(out_path, "wb") as fout:
        for chunk in iter(lambda: fin.read(1 << 22), b""):
            fout.write(chunk)


def _record(manifest: dict[str, Any], key: str, url: str, path: Path) -> None:
    manifest[key] = {
        "url": url,
        "file": str(path),
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def run() -> dict[str, Any]:
    p = ensure_dirs()
    sources = load_sources()
    manifest = read_manifest()
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    # OpenStreetMap Netherlands extract
    osm = _fetch(sources["osm"]["url"], p.raw / "netherlands-latest.osm.pbf", session)
    _record(manifest, "osm", sources["osm"]["url"], osm)

    # NDW traffic signs (CSV, streaming-friendly)
    signs = _fetch(sources["ndw_signs"]["url"], p.raw / "verkeersborden_actueel_beeld.csv.gz", session)
    _record(manifest, "ndw_signs", sources["ndw_signs"]["url"], signs)
    _unzip_gzip(signs, p.cache / "ndw_signs" / "verkeersborden_actueel_beeld.csv")

    # WKD official speed limits: newest monthly Geopackage zip
    wkd_dir = p.raw
    wkd_zip_path = sorted(wkd_dir.glob("wkd_maxspeed_*.zip"))[-1] if list(wkd_dir.glob("wkd_maxspeed_*.zip")) else None
    if wkd_zip_path is None:
        wkd_url, stamp = latest_wkd_zip(sources["wkd_maxspeed"]["listing"], session)
        yy, mm, dd = stamp.split("-")
        wkd_zip_path = _fetch(wkd_url, wkd_dir / f"wkd_maxspeed_{yy}-{mm}-{dd}.zip", session)
        manifest["wkd_maxspeed_listing"] = {"url": sources["wkd_maxspeed"]["listing"], "picked": wkd_url}
    _record(manifest, "wkd_maxspeed", sources["wkd_maxspeed"]["listing"], wkd_zip_path)
    _unzip(wkd_zip_path, p.cache / "wkd")

    # CBS 100m population grid
    cbs = _fetch(sources["cbs_vk100"]["url"], p.raw / "cbs_vk100_2020_vol.zip", session)
    _record(manifest, "cbs_vk100", sources["cbs_vk100"]["url"], cbs)
    _unzip(cbs, p.cache / "cbs")

    # roadcurvature KMZ (community ground truth for calibration)
    rc = _fetch(sources["roadcurvature"]["url"], p.raw / "roadcurvature_nl_c1000.kmz", session)
    _record(manifest, "roadcurvature", sources["roadcurvature"]["url"], rc)
    _unzip(rc, p.cache / "roadcurvature")

    write_manifest(manifest)
    log.info("manifest written with %d entries", len(manifest))
    return manifest


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
