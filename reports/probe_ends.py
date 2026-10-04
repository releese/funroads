"""Ad-hoc probe: why do specific sprints/rides stop where they do?

For each route end, walk the graph outward along the same road name and print
each edge's fun, exclusion reason and length, so the stopping cause is visible.
"""
import json
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "src"))
from funroads import graph  # noqa: E402
from funroads.route import CSR  # noqa: E402

npz, side = graph.load(False)
with np.load(root / "data/cache/scores.npz") as z:
    S = {k: z[k] for k in z.files}
with np.load(root / "data/cache/features.npz") as z:
    F = {k: z[k] for k in z.files}
names = side["names"]
hw = {v: k for k, v in side["highway_codes"].items()}
u, v, L, nm = npz["edge_u"], npz["edge_v"], npz["edge_len"], npz["edge_name"]
fun, exc = S["fun"], S["excluded"].astype(bool)
nx, ny = npz["node_x"], npz["node_y"]
csr = CSR(npz)
to_rd = Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True)
R = json.loads((root / "data/cache/routes.json").read_text(encoding="utf-8"))
Lk = json.loads((root / "data/cache/linked.json").read_text(encoding="utf-8"))
by_id = {s["id"]: s for s in R["sprints"]} | {r["id"]: r for r in Lk["rides"]}
bumps = F.get("bumps")
controls = F.get("controls")


def reason(e):
    r = []
    if L[e] < 25:
        r.append("len<25")
    if F["legal_speed"][e] <= 30:
        r.append(f"limit {F['legal_speed'][e]:.0f}")
    if bumps is not None and bumps[e] / max(L[e] / 1000, 1e-4) > 3:
        r.append("bumps")
    if (npz["edge_flags"][e] & graph.F_MOTORWAY) > 0:
        r.append("motorway")
    if npz["edge_surface"][e] == graph.SURFACE_SETT:
        r.append("sett")
    name = hw.get(int(npz["edge_highway"][e]), "?")
    if name in ("residential", "living_street") and F["busyness"][e] > 0.45:
        r.append("busy residential")
    return ",".join(r) or "?"


def describe(e):
    dims = " ".join(f"{d[:3]}={S['score_' + d][e]:.2f}" for d in ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery"))
    tag = f"EXCL({reason(e)})" if exc[e] else ("GOOD" if fun[e] >= 0.55 else "low")
    ctrl = int(controls[e]) if controls is not None else -1
    return (f"e{e} {names[nm[e]] or '(unnamed)'} [{hw.get(int(npz['edge_highway'][e]), '?')}] {L[e]:.0f} m "
            f"fun={fun[e]:.2f} {tag} lim={F['legal_speed'][e]:.0f} ctrl={ctrl} | {dims}")


def nearest_node(lon, lat):
    x, y = to_rd.transform(lon, lat)
    return int(np.argmin((nx - x) ** 2 + (ny - y) ** 2))


def walk_out(node, avoid_names, steps=6):
    """List edges leaving the node, and follow same-named continuation."""
    lo, hi = csr.indptr[node], csr.indptr[node + 1]
    print(f"    node {node}: {hi - lo} outgoing")
    for k in range(lo, hi):
        e = int(csr.edges[k])
        print("      ->", describe(e))


for rid in sys.argv[1:]:
    r = by_id[rid]
    print(f"\n=== {r['name']} ({rid}) {r['km']} km, type={r.get('type', 'sprint')} roads={[x['name'] for x in r['roads']]}")
    for label, (lon, lat) in (("start", r["line"][0]), ("end", r["line"][-1])):
        n = nearest_node(lon, lat)
        print(f"  {label} {lat:.5f},{lon:.5f}")
        walk_out(n, set())
        # also one hop further along each outgoing edge
        lo, hi = csr.indptr[n], csr.indptr[n + 1]
        for k in range(lo, hi):
            e = int(csr.edges[k])
            n2 = int(v[e])
            lo2, hi2 = csr.indptr[n2], csr.indptr[n2 + 1]
            for k2 in range(lo2, hi2):
                e2 = int(csr.edges[k2])
                if int(v[e2]) == n:
                    continue
                print("         =>", describe(e2))
