"""Read-only stretch quality probe against the pinned national graph and scores."""

from collections import Counter

import numpy as np

from funroads.access import WINDOWS
from funroads.config import load_rubric, paths
from funroads.graph import load
from funroads.route import find_stretches, reverse_is_fun, reverse_stretch


def main() -> None:
    npz, side = load(False)
    with np.load(paths().cache / "scores.npz") as z:
        fun, excluded = z["fun"], z["excluded"].astype(bool)
    rubric = load_rubric()
    threshold = rubric["routing"]["stretch_fun_threshold"]
    length, access = npz["edge_len"], npz["edge_access"]
    seen_masks: set[bytes] = set()
    unique = {}
    for bit, (label, _) in enumerate(WINDOWS):
        open_edges = (access & (1 << bit)) != 0
        signature = np.packbits(open_edges).tobytes()
        if signature in seen_masks:
            continue
        seen_masks.add(signature)
        print(f"Mining {label}...", flush=True)
        for st in find_stretches(npz, np.where(open_edges, fun, 0), excluded, rubric):
            key = tuple(sorted(int(npz["edge_g0"][e]) for e in st.edges))
            unique.setdefault(key, st)
    stats = []
    for st in unique.values():
        e = np.asarray(st.edges)
        w = length[e]
        low = fun[e] < threshold
        share = float(w[low].sum() / w.sum())
        avg = float(np.average(fun[e], weights=w))
        reverse = reverse_stretch(npz, st.edges)
        sprint = bool(reverse and reverse_is_fun(st.edges, reverse, fun, excluded, threshold)
                      and np.bitwise_and.reduce(access[st.edges + reverse]))
        stats.append((st, share, avg, sprint))
    print(f"Unique stretches: {len(stats)}; reversible sprint candidates: {sum(s[3] for s in stats)}")
    for label, subset in (("all", stats), ("sprint", [s for s in stats if s[3]])):
        print(label, "bridge share bands", dict(sorted(Counter(
            "0" if s[1] == 0 else "<=10%" if s[1] <= .1 else "<=20%" if s[1] <= .2
            else "<=30%" if s[1] <= .3 else ">30%" for s in subset).items())))
        for cap in (1, .3, .25, .2, .1):
            kept = [s for s in subset if s[1] <= cap and s[2] >= threshold]
            print(f"  avg >= {threshold:.2f}, bridge <= {cap:.0%}: {len(kept)}")
    for name in ("Duinlustweg", "Brikweg", "Autoweg", "Camerig", "Langevelderslag"):
        hits = [s for s in stats if any(
            side["names"][int(npz["edge_name"][e])] == name for e in s[0].edges
        )]
        print(name, [(round(s[0].length_m / 1000, 2), round(s[1], 3),
                      round(s[2], 3), s[3]) for s in sorted(hits, key=lambda s: -s[0].fun_km)[:8]])


if __name__ == "__main__":
    main()
