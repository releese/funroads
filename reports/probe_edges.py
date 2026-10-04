"""Ad-hoc probe: edge-level fun scores for named roads and regions (national caches)."""
import json
import sys
from pathlib import Path

import numpy as np

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "src"))
from funroads import graph  # noqa: E402

npz, side = graph.load(False)
with np.load(root / "data/cache/scores.npz") as z:
    S = {k: z[k] for k in z.files}
with np.load(root / "data/cache/features.npz") as z:
    F = {k: z[k] for k in z.files}
print("npz keys:", sorted(npz.keys()))
print("score keys:", sorted(S.keys()))
print("feature keys:", sorted(F.keys()))
names = side["names"]
name_to_idx = {n: i for i, n in enumerate(names)}
nm = npz["edge_name"]
L = npz["edge_len"].astype(float)
fun = S["fun"]
exc = S["excluded"].astype(bool)
dims = ["corners", "flow", "quiet", "speed", "elevation", "surface", "scenery"]

# Edge midpoints in RD.
u, v = npz["edge_u"], npz["edge_v"]
nx, ny = npz["node_x"], npz["node_y"]
mx, my = (nx[u] + nx[v]) / 2, (ny[u] + ny[v]) / 2


def road(name, box=None):
    i = name_to_idx.get(name)
    if i is None:
        print(f"{name}: no such name")
        return
    e = np.where(nm == i)[0]
    if box:
        x0, y0, x1, y1 = box
        e = e[(mx[e] >= x0) & (mx[e] <= x1) & (my[e] >= y0) & (my[e] <= y1)]
    if not len(e):
        print(f"{name}: no edges in box")
        return
    w = L[e]
    good = (fun[e] >= 0.55) & ~exc[e]
    avg = {d: round(float(np.average(S["score_" + d][e], weights=w)), 2) for d in dims}
    extra = {k: round(float(np.average(F[k][e], weights=w)), 1) for k in ("head_per_km", "engaged_per_km") if k in F}
    print(f"{name}: {w.sum()/2000:.1f} km (both dirs /2), fun avg {np.average(fun[e], weights=w):.2f}, "
          f"max {fun[e].max():.2f}, >=0.55 share {w[good].sum()/w.sum():.0%}, excluded {w[exc[e]].sum()/w.sum():.0%}")
    print("    dims", avg, extra)


for n in ["Eyserweg", "Keutenberg", "Keutenbergweg", "Cauberg", "Gulperberg", "Camerig", "Vijlenerbosweg",
          "Kleebergerweg", "Beekhuizenseweg", "Holterbergweg", "Hoenderloseweg", "Epenerbaan", "Kootwijkerbroek",
          "Amersfoortseweg", "Lemelerbergweg", "Grotestraat", "Duinlustweg", "Langevelderslag", "Brikweg",
          "Bentveldsweg", "Zijweg", "Zeeweg", "Kraaijenissedijk"]:
    road(n)

# Regional fun-edge share.
regions = {
    "South Limburg": (175000, 305000, 205000, 330000),
    "Veluwe": (170000, 440000, 210000, 480000),
    "Eindhoven area": (145000, 370000, 175000, 395000),
    "Twente": (240000, 460000, 265000, 495000),
    "Kennemerland dunes": (98000, 480000, 108000, 500000),
    "Rivierengebied dikes": (140000, 425000, 175000, 440000),
}
print()
for label, (x0, y0, x1, y1) in regions.items():
    m = (mx >= x0) & (mx <= x1) & (my >= y0) & (my <= y1) & (nm > 0)
    w = L[m]
    good = (fun[m] >= 0.55) & ~exc[m]
    ok = ~exc[m]
    avg = {d: round(float(np.average(S["score_" + d][m][ok], weights=w[ok])), 2) for d in dims}
    print(f"{label}: {w.sum()/2000:.0f} km named, excluded {w[exc[m]].sum()/w.sum():.0%}, "
          f"fun>=0.55 {w[good].sum()/w.sum():.1%}, p95 fun {np.percentile(fun[m][ok], 95):.2f}")
    print("    non-excluded dims", avg)
