"""Ad-hoc probe: before/after comparison of the bridging+retune regeneration."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
oldR = json.loads((root / "data/cache/before-bridging/routes.json").read_text(encoding="utf-8"))
oldL = json.loads((root / "data/cache/before-bridging/linked.json").read_text(encoding="utf-8"))
newR = json.loads((root / "data/cache/routes.json").read_text(encoding="utf-8"))
newL = json.loads((root / "data/cache/linked.json").read_text(encoding="utf-8"))

print("counts old -> new")
print("  circuits:", len(oldR["routes"]), "->", len(newR["routes"]))
print("  areas   :", len(oldR["areas"]), "->", len(newR["areas"]))
print("  sprints :", len(oldR["sprints"]), "->", len(newR["sprints"]))
print("  rides   :", len(oldL["rides"]), "->", len(newL["rides"]))
print("  loops   :", sum(1 for r in oldL["rides"] if r["type"] == "circuit"), "->",
      sum(1 for r in newL["rides"] if r["type"] == "circuit"))

for q in ["Brikweg", "Duinlustweg", "Zijweg", "Bentveldsweg", "Langevelderslag"]:
    print(f"\n{q}:")
    for label, R, L in [("old", oldR, oldL), ("new", newR, newL)]:
        hits = [("S", s["name"], s["km"], round(s["fun"], 2)) for s in R["sprints"]
                if any(q in r["name"] for r in s["roads"]) or q in s["name"]]
        hits += [("L", r["name"], r["km"], r["type"]) for r in L["rides"]
                 if any(q in x["name"] for x in r["roads"]) or q in r["name"]]
        print(f"  {label}:", hits if hits else "none")

# Hill-road scores after the retune
print("\nhill sprints old -> new (fun):")
for q in ["Cauberg", "Camerig", "Bommerigerweg", "Keutenberg"]:
    o = [round(s["fun"], 2) for s in oldR["sprints"] if q in s["name"]]
    n = [round(s["fun"], 2) for s in newR["sprints"] if q in s["name"]]
    print(f"  {q}: {o} -> {n}")
