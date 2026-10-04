"""Ad-hoc probe: simulate rubric weight variants without rerunning the pipeline.

scores.npz stores every sub-score per edge; features.npz stores the raw
curviness/engaged inputs of the corner blend. fun = weighted sum / weight sum,
so any (weight set, corner blend) can be replayed offline and checked against
the stored fun to prove the model is exact.
"""
import json
import sys
from pathlib import Path

import numpy as np

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "src"))
from funroads import graph  # noqa: E402

DIMS = ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery")
THRESHOLD = 0.55

npz, side = graph.load(False)
names = side["names"]
nm = npz["edge_name"]
L = npz["edge_len"]


def load(p):
    with np.load(p) as z:
        return {k: z[k] for k in z.files}


oldS = load(root / "data/cache/before-bridging/scores.npz")
newS = load(root / "data/cache/scores.npz")
F = load(root / "data/cache/features.npz")
exc = newS["excluded"].astype(bool)


def piecewise(points):
    xs = np.array([p[0] for p in points], dtype=np.float64)
    ys = np.array([p[1] for p in points], dtype=np.float64)
    return lambda v: np.interp(v, xs, ys)


# anchors from config/fun.yaml
curv_score = piecewise([[0, 0.0], [60, 0.25], [120, 0.5], [220, 0.75], [350, 1.0]])
eng_score = piecewise([[0, 0.0], [1.5, 0.35], [3, 0.65], [4.5, 0.85], [6, 1.0]])
CURV = curv_score(F["head_per_km"])
ENG = eng_score(F["engaged_per_km"])

# Infer the OLD corner blend a*curv + (1-a)*eng from stored old score_corners.
sel = np.abs(CURV - ENG) > 0.15
a_est = (oldS["score_corners"][sel] - ENG[sel]) / (CURV[sel] - ENG[sel])
old_blend = float(np.median(a_est))
print(f"inferred old corner blend: curviness {old_blend:.2f} / engaged {1 - old_blend:.2f}")

OLD_W = dict(corners=0.30, flow=0.15, quiet=0.15, speed=0.15, elevation=0.10, surface=0.10, scenery=0.10)
NEW_W = dict(corners=0.30, flow=0.15, quiet=0.15, speed=0.05, elevation=0.15, surface=0.10, scenery=0.10)


def fun_with(w, blend):
    cor = blend * CURV + (1 - blend) * ENG
    total = w["corners"] * cor
    wsum = w["corners"]
    for d in DIMS[1:]:
        total = total + w[d] * newS["score_" + d]
        wsum += w[d]
    return total / wsum  # score.py normalises by the weight sum


# Validate the replay model against stored fun (non-excluded edges only;
# stored fun is zeroed where excluded).
old_exc = oldS["excluded"].astype(bool)
err_new = np.abs(fun_with(NEW_W, 0.70)[~exc] - newS["fun"][~exc]).max()
err_old = np.abs(fun_with(OLD_W, old_blend)[~old_exc] - oldS["fun"][~old_exc]).max()
print(f"replay check: max |replay - stored| new={err_new:.4f} old={err_old:.4f}")

VARIANTS = {
    "old (full revert)": (OLD_W, old_blend),
    "old weights + blend .7": (OLD_W, 0.70),
    "current": (NEW_W, 0.70),
    "speed .15, ele .15, blend .7": ({**OLD_W, "elevation": 0.15}, 0.70),
    "current, thresh .53": (NEW_W, 0.70),
}

roads = ["Duinlustweg", "Brikweg", "Autoweg", "Camerig", "Cauberg", "Bommerigerweg", "Keutenberg", "Langevelderslag"]

# Where did Autoweg rank before, and what happened to it?
oldR = json.loads((root / "data/cache/before-bridging/routes.json").read_text(encoding="utf-8"))
newR = json.loads((root / "data/cache/routes.json").read_text(encoding="utf-8"))
for label, R in (("old", oldR), ("new", newR)):
    hits = [s for s in R["sprints"] if "autoweg" in s["name"].lower()
            or any("autoweg" in r["name"].lower() for r in s["roads"])]
    print(f"\n{label} sprints mentioning Autoweg:")
    for s in hits:
        print(f"  {s['name']}: {s['km']} km, fun {s['fun']}, fun_km {s['fun_km']}, windows {len(s['windows'])}")
    if not hits:
        print("  none")
top_old = sorted(oldR["sprints"], key=lambda s: -s["fun"])[:8]
print("\nold top sprints by fun:", [(s["name"], s["fun"]) for s in top_old])
edge_of = {}
for q in roads:
    idx = [e for e in range(len(nm)) if q.lower() in (names[nm[e]] or "").lower()]
    seen = {}
    for e in idx:
        g0 = int(npz["edge_g0"][e])
        if g0 not in seen or L[e] > L[seen[g0]]:
            seen[g0] = e
    edge_of[q] = sorted(seen.values(), key=lambda e: -L[e])

print(f"\n{'variant':28s} {'good edges':>10s}  " + "  ".join(f"{q[:12]:>12s}" for q in roads))
for label, (w, blend) in VARIANTS.items():
    fun = fun_with(w, blend)
    thr = 0.53 if label == "current, thresh .53" else THRESHOLD
    good = int(((fun >= thr) & ~exc).sum())
    cells = []
    for q in roads:
        es = edge_of[q]
        if not es:
            cells.append("-")
            continue
        # length-weighted fun over the road's slices, km of it above threshold
        fw = float(np.average(fun[es], weights=L[es]))
        above = float(L[es][(fun[es] >= thr) & ~exc[es]].sum()) / 1000
        cells.append(f"{fw:.3f}/{above:.1f}km")
    print(f"{label:28s} {good:>10d}  " + "  ".join(f"{c:>12s}" for c in cells))

print("\ncell = length-weighted fun / km of the road above the stretch threshold")
