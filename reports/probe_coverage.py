"""Ad-hoc probe: geographic coverage and navigation-link coverage of the pinned caches."""
import json
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parents[1]
R = json.loads((root / "data/cache/routes.json").read_text(encoding="utf-8"))
L = json.loads((root / "data/cache/linked.json").read_text(encoding="utf-8"))

print("meta routes:", {k: v for k, v in R["meta"].items() if not isinstance(v, (list, dict))})
print("meta linked:", {k: v for k, v in L["meta"].items() if not isinstance(v, (list, dict))})

print("\ncircuit links:")
for c in R["routes"]:
    print(" ", c["name"], c["km"], "links:", {k: (v[:60] if isinstance(v, str) else v) for k, v in (c.get("links") or {}).items()})

print("\nride keys:", sorted(L["rides"][0].keys()))
print("sprint keys:", sorted(R["sprints"][0].keys()))


def band(lat, lon):
    ns = "N" if lat > 52.6 else ("M" if lat > 51.8 else "S")
    ew = "W" if lon < 5.0 else ("C" if lon < 6.0 else "E")
    return ns + ew


for name, items, pt in [
    ("sprints", R["sprints"], lambda s: (s["start"]["lat"], s["start"]["lon"])),
    ("rides", L["rides"], lambda r: (r["line"][0][1], r["line"][0][0])),
    ("circuits", R["routes"], lambda c: (c["start"]["lat"], c["start"]["lon"])),
]:
    cnt = Counter(band(*pt(x)) for x in items)
    print(f"\n{name} by band (N/M/S x W/C/E):", dict(sorted(cnt.items())))

# Southern/eastern sprints: best fun
south = [s for s in R["sprints"] if s["start"]["lat"] < 51.8]
east = [s for s in R["sprints"] if s["start"]["lon"] > 6.0 and s["start"]["lat"] > 51.8]
for label, arr in [("south", south), ("east", east)]:
    arr = sorted(arr, key=lambda s: -s["fun_km"])[:8]
    print(f"\ntop {label} sprints:", [(s["name"], s["km"], round(s["fun"], 2), s["fun_km"]) for s in arr])

near_ehv = [s for s in R["sprints"] if abs(s["start"]["lat"] - 51.44) < 0.3 and abs(s["start"]["lon"] - 5.48) < 0.45]
print("\nsprints within ~30 km box of Eindhoven:", len(near_ehv))
ride_ehv = [r for r in L["rides"] if abs(r["line"][0][1] - 51.44) < 0.3 and abs(r["line"][0][0] - 5.48) < 0.45]
print("rides near Eindhoven:", len(ride_ehv))
lim = [s for s in R["sprints"] if s["start"]["lat"] < 51.0]
print("sprints in South Limburg (lat<51.0):", len(lim), sorted(((s["name"], s["fun_km"]) for s in lim), key=lambda x: -x[1])[:10])
print("rides in South Limburg:", len([r for r in L["rides"] if r["line"][0][1] < 51.0]))

for q in ["Brikweg", "Duinlustweg", "Zijweg", "Bentveldsweg", "Langevelderslag"]:
    hits = [("S", s["id"], s["name"], s["km"], [r["name"] for r in s["roads"]]) for s in R["sprints"] if any(q in r["name"] for r in s["roads"]) or q in s["name"]]
    hits += [("L", r["id"], r["name"], r["km"], r["type"], [x["name"] for x in r["roads"]]) for r in L["rides"] if any(q in x["name"] for x in r["roads"]) or q in r["name"]]
    print(f"\n{q}:")
    for h in hits:
        print("  ", h)
