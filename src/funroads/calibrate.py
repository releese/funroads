"""Compare the absolute road rubric with the pinned roadcurvature KMZ.

The KMZ embeds its constituent OSM way IDs. Match those IDs exactly rather
than snapping nearby roads, which can accidentally label a parallel cycleway
or an unrelated carriageway as a positive example. This is a biased curvature
reference, not a survey of what is fun, open to cars, or close to home.
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
from pyproj import Transformer
from shapely import LineString, STRtree, line_interpolate_point

from . import graph
from .access import WINDOWS
from .config import load_rubric, paths
from .score import DIMENSIONS

WAY_ID = re.compile(r"https://www\.openstreetmap\.org/way/(\d+)")
CURVATURE = re.compile(r"Curvature:\s*([\d.]+)")
DISTANCE = re.compile(r"Distance:\s*([\d.]+)\s*km")


def read_reference(kmz: Path) -> tuple[list[dict], list[LineString]]:
    """Read the KML from its archive; preserve source order for stable reports."""
    with zipfile.ZipFile(kmz) as archive:
        kml = next(name for name in archive.namelist() if name.endswith(".kml"))
        root = ElementTree.fromstring(archive.read(kml))
    tf = Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True)
    routes, lines = [], []
    for item in root.findall(".//{*}Placemark"):
        raw = item.findtext(".//{*}LineString/{*}coordinates")
        if not raw:
            continue
        coords = [tuple(map(float, pair.split(",")[:2])) for pair in raw.split()]
        if len(coords) < 2:
            continue
        lon, lat = zip(*coords)
        x, y = tf.transform(lon, lat)
        lines.append(LineString(zip(x, y)))
        desc = item.findtext("{*}description", "")
        curv, distance = CURVATURE.search(desc), DISTANCE.search(desc)
        routes.append({
            "name": item.findtext("{*}name", ""),
            "ways": {int(w) for w in WAY_ID.findall(desc)},
            "curvature": float(curv.group(1)) if curv else 0.0,
            "km": float(distance.group(1)) if distance else 0.0,
        })
    return routes, lines


def physical_edges(npz: dict, scores: dict) -> np.ndarray:
    """One directed edge per unique physical geometry, eligible fun roads only."""
    _, ids = np.unique(npz["edge_g0"], return_index=True)
    return ids[(scores["excluded"][ids] == 0) & (npz["edge_len"][ids] >= 25)]


def precision_at_km(values: np.ndarray, positive: np.ndarray,
                    length: np.ndarray, km: float) -> float:
    """Length-weighted precision among the highest-scored physical road-km."""
    order = np.argsort(-values, kind="stable")
    left = km * 1000
    hit = 0.0
    for i in order:
        take = min(left, float(length[i]))
        hit += take * bool(positive[i])
        left -= take
        if left <= 0:
            break
    return hit / (km * 1000 - max(left, 0)) if left < km * 1000 else 0.0


def route_overlap(line: list[list[float]], tree: STRtree) -> float:
    """Approximate the fraction of route distance within 30 m of KMZ lines."""
    if len(line) < 2:
        return 0.0
    tf = Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True)
    lon, lat = zip(*line)
    x, y = tf.transform(lon, lat)
    route = LineString(zip(x, y))
    samples = line_interpolate_point(route, np.arange(0, route.length, 100))
    if not len(samples):
        return 0.0
    matches = tree.query(samples, predicate="dwithin", distance=30)
    return len(np.unique(matches[0])) / len(samples)


def make_report(npz: dict, scores: dict, reference: list[dict],
                lines: list[LineString], routes: list[dict]) -> str:
    ids = physical_edges(npz, scores)
    length = npz["edge_len"][ids].astype(np.float64)
    positive_ways = set().union(*(r["ways"] for r in reference))
    positive = np.isin(npz["edge_way"][ids], sorted(positive_ways))
    baseline = float(length[positive].sum() / length.sum())
    weights = load_rubric()["weights"]
    candidates = [
        ("configured absolute rubric", weights),
        ("more corners", {**weights, "corners": 0.45, "quiet": 0.05}),
        ("more elevation", {**weights, "elevation": 0.20, "quiet": 0.05, "corners": 0.30}),
        ("more quiet", {**weights, "quiet": 0.25, "corners": 0.25}),
    ]
    rows = []
    for label, w in candidates:
        values = sum(float(w[d]) * scores[f"score_{d}"][ids].astype(np.float64)
                     for d in DIMENSIONS) / sum(w.values())
        rows.append((label, *(precision_at_km(values, positive, length, k)
                              for k in (100, 500, 1000))))

    matched = sum(bool(np.isin(npz["edge_way"][ids], sorted(r["ways"])).any())
                  for r in reference)
    tree = STRtree(lines)
    out = [
        "# Roadcurvature calibration",
        "",
        "Reference: pinned `data/raw/roadcurvature_nl_c1000.kmz`. "
        "The KMZ is a curvature-selected OSM derivative, not an independent "
        "rating of driving enjoyment or legal access. Exact OSM way-ID matching "
        "avoids false matches to nearby roads; edits to OSM IDs between snapshots "
        "reduce recall. Both driving directions share one physical geometry.",
        "",
        "## Named-road and access audit",
        "",
        "The pinned OSM extract has no ways named `Posbankweg` or `Amerongseweg`. "
        "The Posbank approach is mapped as Schietbergseweg (e.g. way 6835645, "
        "asphalt, 60 km/h). Beekhuizenseweg (e.g. way 6835762) carries "
        "`motor_vehicle:conditional=no @ (Sa,Su, Jul, Aug, PH)`; other sections "
        "close at night. The Amerongse Berg approaches are mapped as Bergweg "
        "(e.g. way 147250645, 50 km/h) and Veenseweg "
        "(e.g. way 6930933, 50 km/h). Nearby Zuylesteinseweg includes gravel "
        "tracks, not suitable substitutes for a paved car route. Diagnostics "
        "use these mapped names in their respective local areas; the graph "
        "retains a conditional road only in sampled weekday/weekend 08:00 and "
        "20:00 departures when it stays open over the next three hours. "
        "Unknown conditional access is excluded; nightfall is approximated "
        "conservatively rather than computed for a particular roadside sign. "
        "Busyness is static, so these windows show access, not hour-by-hour "
        "traffic quality. Always check current signage and seasonal restrictions "
        "before driving.",
        "",
        f"- KMZ lines: {len(reference)}; with at least one eligible matched way: {matched}.",
        f"- Eligible physical roads: {len(ids):,}, {length.sum()/1000:,.0f} km; "
        f"KMZ matched: {length[positive].sum()/1000:,.0f} km ({baseline:.1%} base rate).",
        "- Precision@K = fraction of top K road-km whose OSM way occurs in the KMZ. "
        "Excluded/inaccessible roads cannot count as positives or candidates.",
        "",
        "| Weights (absolute anchors unchanged) | @100 km | @500 km | @1000 km |",
        "|---|---:|---:|---:|",
    ]
    for label, *vals in rows:
        out.append(f"| {label} | " + " | ".join(f"{v:.1%}" for v in vals) + " |")
    out += [
        "",
        "The alternatives are a small sensitivity check, not fitted replacements. "
        "A curvature-derived reference mechanically favors corner weight. "
        "Keep the absolute anchors and 60–80 km/h legal-flow score; do not "
        "optimize for matching this proxy at the expense of access, surface, "
        "quiet, or travel time.",
        "",
        "## Current ranked circuits",
        "",
        "Route overlap is sampled every 100 m within 30 m of a KMZ polyline. "
        "It is spatial corroboration only, not proof of legal access.",
        "",
        "| Rank | Circuit | Fun km | Reach min | KMZ overlap | Open windows | Flags |",
        "|---:|---|---:|---:|---:|---:|---|",
    ]
    overlaps = []
    for i, route in enumerate(routes, 1):
        overlap = route_overlap(route["line"], tree)
        overlaps.append(overlap)
        out.append(f"| {i} | {route['name']} | {route['fun_km']} | "
                   f"{route['reach_min']} | {overlap:.1%} | "
                   f"{len(route['windows'])}/{len(WINDOWS)} | "
                   f"{', '.join(route['flags']) or 'none'} |")
    far = sum("far_from_home" in r["flags"] for r in routes)
    out += [
        "",
        "## Interpretation",
        "",
        f"{far} of {len(routes)} selected circuits are flagged far from home; "
        f"median KMZ spatial overlap is {np.median(overlaps):.1%}."
        if routes else "No national routes were selected.",
        "",
        "The source itself ranks many dikes highly (its first entries include "
        "Meije, Dijk, Waalbandijk and Waaldijk), but low route-level overlap "
        "does not validate the present dike-heavy top twelve. Likewise, the "
        "small lift of the elevation-heavy alternative is not enough to retune "
        "a multidimensional driving rubric against a curvature-only reference. "
        "The KMZ contains neither a home-reach preference nor verified access "
        "for a specific day/hour; all-far results are a limitation of fun-km-first "
        "selection, not evidence that distance should change road fun. Keep "
        "the home-reach flags rather than silently replacing fun-km with a "
        "geographic percentile. A representative human-rated set with negative "
        "examples and an explicit near-home route preference are needed before "
        "changing weights or route selection.",
        "",
    ]
    return "\n".join(out)


def run() -> None:
    p = paths()
    npz, _ = graph.load()
    with np.load(p.cache / "scores.npz") as cache:
        scores = {k: cache[k] for k in cache.files}
    reference, lines = read_reference(p.raw / "roadcurvature_nl_c1000.kmz")
    routes = json.loads((p.cache / "routes.json").read_text(encoding="utf-8"))["routes"]
    report = make_report(npz, scores, reference, lines, routes)
    dest = p.reports / "calibration.md"
    tmp = dest.with_suffix(".md.tmp")
    tmp.write_text(report, encoding="utf-8")
    tmp.replace(dest)


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
