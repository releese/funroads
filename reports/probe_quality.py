"""Read-only before/after catalogue quality check; run after both writes finish."""

import json
from collections import Counter
from pathlib import Path


cache = Path(__file__).resolve().parents[1] / "data" / "cache"


def load(folder: Path) -> tuple[dict, dict]:
    return tuple(json.loads((folder / name).read_text(encoding="utf-8"))
                 for name in ("routes.json", "linked.json"))


def summary(label: str, routes: dict, linked: dict) -> None:
    sprints, rides = routes["sprints"], linked["rides"]
    print(label, "circuits", len(routes["routes"]), "areas", len(routes["areas"]),
          "sprints", len(sprints), "linked", len(rides))
    print("  sprint fun", dict(sorted(Counter(
        "<.50" if s["fun"] < .5 else "<.55" if s["fun"] < .55
        else "<.60" if s["fun"] < .6 else ">=.60" for s in sprints).items())))
    print("  sprint length <=2km", sum(s["km"] <= 2 for s in sprints))
    print("  within 10km Zaandam", sum(s["distance_km"]["Zaandam"] <= 10 for s in sprints))
    print("  linked type", dict(Counter(r["type"] for r in rides)))
    print("  loops >20% connector", sum(r["type"] == "circuit" and r["connector_share"] > .2
                                       for r in rides))
    for name in ("Duinlustweg", "Brikweg", "Autoweg", "Camerig", "Langevelderslag",
                 "Kleine Tocht", "Buikslotermeerdijk"):
        hits = [(s["km"], s["fun"]) for s in sprints
                if any(road["name"] == name for road in s["roads"])]
        print(f"  {name}: {hits[:8]}")
    for name in ("Zeeweg", "Duinlustweg"):
        print(f"  {name} linked:", [(r["name"], r["km"], r["connector_share"])
              for r in rides if any(road["name"] == name for road in r["roads"])][:8])


if __name__ == "__main__":
    summary("before", *load(cache / "before-quality"))
    summary("after", *load(cache))
