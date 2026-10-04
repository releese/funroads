"""Native-CRS Teeregister evidence, matched to OSM geometry, not a second road graph."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlencode

import numpy as np
import shapely
from shapely.geometry import shape

from .fetch import _fetch, sha256_file

URL = "https://teeregister-api.mnt.ee/teenus/wfs"
LAYERS = ("n_kate", "n_kiiruspiirang")


def fetch(raw, session, bbox):
    """Retain sorted raw pages and reject incomplete or changing pagination."""
    west, south, east, north = bbox
    base = dict(service="WFS", version="2.0.0", request="GetFeature",
                bbox=f"{south},{west},{north},{east},urn:ogc:def:crs:EPSG::4326",
                srsName="EPSG:3301")
    records = {}
    for layer in LAYERS:
        params = {**base, "typeNames": "ms:" + layer}
        url = URL + "?" + urlencode({**params, "resultType": "hits"})
        hits = _fetch(url, raw / f"teeregister-{layer}-hits.xml", session)
        total = int(ET.fromstring(hits.read_bytes()).attrib["numberMatched"])
        pages, identifiers = [], set()
        # MapServer's GeoJSON limit/offset loses a boundary record on some
        # pages. Two-record overlaps plus deduplication recover it; hits is
        # checked against the final unique count, never used as a page count.
        for start in range(0, total, 998):
            url = URL + "?" + urlencode({
                **params, "outputFormat": "application/json; subtype=geojson",
                "count": 1000, "startIndex": start, "sortBy": "oid"})
            path = _fetch(url, raw / f"teeregister-{layer}-{start:05d}.json", session)
            doc = json.loads(path.read_text(encoding="utf-8"))
            features = doc["features"]
            if not features:
                raise ValueError(f"incomplete Teeregister page: {layer}/{start}")
            page_ids = [int(f["properties"]["oid"]) for f in features]
            if len(set(page_ids)) != len(page_ids):
                raise ValueError(f"duplicate Teeregister page records: {layer}/{start}")
            identifiers.update(page_ids)
            pages.append({"file": path.name, "url": url, "sha256": sha256_file(path),
                          "bytes": path.stat().st_size, "features": len(features)})
        if len(identifiers) != total:
            raise ValueError(f"unstable Teeregister pagination: {layer}")
        records[layer] = {"features": total, "pages": pages,
                          "hits_url": URL + "?" + urlencode({**params, "resultType": "hits"}),
                          "hits_sha256": sha256_file(hits)}
    return records


def surface(properties):
    """Explicit register codes win over the contradictory INSPIRE category."""
    code = str(properties.get("kate_kate_xv", ""))
    if code in {"31", "32", "41", "61"}:
        return "unpaved"
    if code == "99":
        return None
    # Observed register codes: known surfaced road, concrete, asphalt,
    # bitumen-bound blacktop and explicitly surface-treated gravel.
    # Macadam/stabilised/milled-asphalt codes 23/25/26 remain unknown.
    if code in {"10", "12", "13", "14", "15", "16", "21", "22", "24", "27"}:
        return "paved"
    return None


def speeds(properties):
    """Use base directional limits; do not guess time/vehicle-dependent rules."""
    for key in ("kplistp_kplisatahvel_xv", "kplistv_kplisatahvel_xv",
                "ajavahp_kpajavahemik_xv", "ajavahv_kpajavahemik_xv"):
        if properties.get(key) not in (None, "", "0"):
            return None
    values = properties.get("kpp"), properties.get("kpv")
    if not all(isinstance(v, (int, float)) and v == int(v) and 0 < v <= 130 for v in values):
        return None
    return tuple(int(v) for v in values)


class Evidence:
    """Require >=90% line coverage within 12 m, alignment and unambiguous values."""
    def __init__(self, features):
        self.features = [f for f in features if f.get("geometry")
                         and f["geometry"]["type"] == "LineString"]
        self.lines = np.array([shape(f["geometry"]) for f in self.features], dtype=object)
        self.tree = shapely.STRtree(self.lines)

    @classmethod
    def load(cls, raw, layer, manifest):
        features = {}
        for page in manifest[layer]["pages"]:
            path = raw / page["file"]
            if sha256_file(path) != page["sha256"]:
                raise ValueError(f"Teeregister checksum mismatch: {path.name}")
            for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
                oid = int(feature["properties"]["oid"])
                if oid in features and feature != features[oid]:
                    raise ValueError(f"Teeregister record changed across pages: {oid}")
                features[oid] = feature
        if len(features) != manifest[layer]["features"]:
            raise ValueError(f"incomplete cached Teeregister layer: {layer}")
        return cls(list(features.values()))

    def match(self, line, tags, value):
        refs = set(re.findall(r"\d+", tags.get("ref", "")))
        choices = []
        for index in self.tree.query(line, predicate="dwithin", distance=12):
            feature = self.features[index]
            props, candidate = feature["properties"], self.lines[index]
            if refs and str(props.get("tee_number")) not in refs:
                continue
            first, last = shapely.Point(line.coords[0]), shapely.Point(line.coords[-1])
            a, b = candidate.project(first), candidate.project(last)
            if abs(b - a) < line.length * .95:
                continue  # reject crossings and badly aligned nearby roads
            if line.intersection(candidate.buffer(12)).length < line.length * .9:
                continue
            mapped = value(props)
            if isinstance(mapped, tuple) and b < a:
                mapped = mapped[::-1]
            if mapped is not None:
                choices.append((mapped, int(props["oid"]), line.distance(candidate),
                                str(props.get("tee_number"))))
        if not choices:
            return None
        # Nearby parallel roads without an OSM reference are not safe joins.
        if len({c[0] for c in choices}) != 1 or (not refs and len({c[3] for c in choices}) != 1):
            return None
        mapped, oid, _, _ = min(choices, key=lambda c: (c[2], c[1]))
        return mapped, oid
