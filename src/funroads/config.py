"""Project paths, YAML config loading and logging setup."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
COUNTRY = "nl"


def select_country(country: str) -> None:
    global COUNTRY
    if country not in ("nl", "ee"):
        raise ValueError(f"unsupported country: {country}")
    COUNTRY = country


def projected_crs() -> str:
    return "EPSG:3301" if COUNTRY == "ee" else "EPSG:28992"


def origins() -> dict[str, tuple[float, float]]:
    if COUNTRY == "ee":
        return {"Tallinn": (24.7536, 59.4370), "Tartu": (26.7290, 58.3776)}
    return {"Zaandam": (4.8260, 52.4389), "Haarlem": (4.6462, 52.3874)}


@dataclass(frozen=True)
class Paths:
    root: Path
    config: Path
    data: Path
    raw: Path
    cache: Path
    community: Path
    dist: Path
    routes_dir: Path
    reports: Path
    web: Path

    @property
    def manifest(self) -> Path:
        return self.data / "manifest.json"


def paths() -> Paths:
    data = ROOT / "data" / "ee" if COUNTRY == "ee" else ROOT / "data"
    return Paths(
        root=ROOT,
        config=ROOT / "config",
        data=data,
        raw=data / "raw",
        cache=data / "cache",
        community=ROOT / "data" / "community",
        dist=ROOT / "dist",
        routes_dir=ROOT / "dist" / "routes",
        reports=ROOT / "reports" / "ee" if COUNTRY == "ee" else ROOT / "reports",
        web=ROOT / "web",
    )


def load_yaml(path: Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_rubric() -> dict[str, Any]:
    """The 'what is fun' rubric from config/fun.yaml."""
    # Estonia uses the same anchors and gates as the Netherlands, including the
    # standard 25 km circuit soft minimum (national coverage, no pilot concession).
    return load_yaml(paths().config / "fun.yaml")


def load_sources() -> dict[str, Any]:
    return load_yaml(paths().config / "sources.yaml")


def ensure_dirs() -> Paths:
    p = paths()
    for d in (p.data, p.raw, p.cache, p.community, p.dist, p.routes_dir, p.reports):
        d.mkdir(parents=True, exist_ok=True)
    return p


def setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )
    # Quiet the noisy libraries.
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def read_manifest() -> dict[str, Any]:
    p = paths().manifest
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def write_manifest(m: dict[str, Any]) -> None:
    p = paths().manifest
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")
