"""Ad-hoc probe: why did named roads drop out of the regenerated outputs?"""
import sys
from pathlib import Path

import numpy as np

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "src"))
from funroads import graph  # noqa: E402

npz, side = graph.load(False)
names = side["names"]
nm = npz["edge_name"]
L = npz["edge_len"]


def load_scores(p):
    with np.load(p) as z:
        return {k: z[k] for k in z.files}


newS = load_scores(root / "data/cache/scores.npz")
oldS = load_scores(root / "data/cache/before-bridging/scores.npz")

for q in sys.argv[1:] or ["Duinlustweg", "Brikweg"]:
    idx = [e for e in range(len(nm)) if q.lower() in (names[nm[e]] or "").lower()]
    print(f"\n=== {q}: {len(idx)} directed edges")
    # undirected slices: report each physical slice once
    seen = set()
    for e in idx:
        g0 = int(npz["edge_g0"][e])
        if g0 in seen:
            continue
        seen.add(g0)
        dims_old = " ".join(f"{d[:3]}={oldS['score_' + d][e]:.2f}" for d in ("corners", "elevation", "speed"))
        dims_new = " ".join(f"{d[:3]}={newS['score_' + d][e]:.2f}" for d in ("corners", "elevation", "speed"))
        print(f"  g{g0} e{e} {L[e]:6.0f} m fun {oldS['fun'][e]:.3f} -> {newS['fun'][e]:.3f} "
              f"excl {int(oldS['excluded'][e])}->{int(newS['excluded'][e])}")
        print(f"      old {dims_old}")
        print(f"      new {dims_new}")
