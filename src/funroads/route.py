"""Build ranked fun-driving circuits from the scored graph.

Pipeline:
  1. stretches   maximal high-fun paths through the graph (directed, so
                 one-way roads are respected)
  2. areas       stretches clustered by midpoint into driving areas
  3. circuits    per area, an out-and-return loop: A* from the best stretch
                 to the far side of the area, then A* back with a reuse
                 penalty so the return leg follows different roads
  4. variants    a second loop per area with the first loop penalised away,
                 dropped when it overlaps too much
  5. ranking     by fun kilometres, with per-area caps and a national top-N;
                 departures are checked against sampled day/hour access windows

Routing cost per metre is `1 + lambda * (1 - fun)` to the power gamma, so a
perfect fun road costs 1x its length and a dull one costs (1+lambda)^gamma.
Motorways and other excluded edges remain drivable at that dull price: they
are connectors, never destinations. The A* heuristic is euclidean distance,
which never overestimates because cost per metre is always >= 1 and reuse
multipliers are always >= 1.

Determinism: ties are broken by node index, heaps are fed in a fixed order,
and clustering processes stretches in a fixed sorted order, so identical
inputs give byte-identical routes.json.
"""

from __future__ import annotations

import heapq
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlencode

import numpy as np

from . import geom
from .access import WINDOWS
from . import graph as graph_mod
from .config import ensure_dirs, load_rubric, projected_crs, origins

log = logging.getLogger("funroads.route")

HOME_LONLAT = (4.8260, 52.4389)  # Zaandam
HOME_NAME = "Zaandam / Haarlem"
HAARLEM_LONLAT = (4.6462, 52.3874)

# Loops a little outside the configured ideal window are kept but flagged:
# a great 30 km loop should not be thrown away for being 30 km.
SOFT_MIN_KM = 25.0
SOFT_MAX_KM = 150.0

# How much of a loop may be dull connector road before it stops being a
# fun circuit and becomes a commute with a detour.
MAX_CONNECTOR_SHARE = 0.45

# If the return leg mostly retraces the outbound leg the "loop" is really an
# out-and-back; those are flagged and ranked below true circuits.
OUT_AND_BACK_SHARE = 0.6


# ------------------------------------------------------------------ graph csr


class CSR:
    """Compressed-sparse-row adjacency over the directed edges, both ways."""

    def __init__(self, npz: dict):
        u = npz["edge_u"].astype(np.int64)
        v = npz["edge_v"].astype(np.int64)
        n = int(max(u.max(), v.max())) + 1
        self.n_nodes = n
        self.indptr, self.edges, self.targets = self._build(u, v, n)
        # Reverse adjacency: edges that END at each node, for backward walks.
        self.rindptr, self.redges, self.rsources = self._build(v, u, n)
        self.edge_u = npz["edge_u"].astype(np.int32)
        self.nx = npz["node_x"].astype(np.float64)
        self.ny = npz["node_y"].astype(np.float64)

    @staticmethod
    def _build(src: np.ndarray, dst: np.ndarray, n: int):
        order = np.argsort(src, kind="stable")
        indptr = np.zeros(n + 1, dtype=np.int64)
        np.add.at(indptr, src + 1, 1)
        indptr = np.cumsum(indptr)
        return indptr, order.astype(np.int32), dst[order].astype(np.int32)

    def astar(self, cost: np.ndarray, mult: np.ndarray, start: int, goal: int) -> list[int]:
        """A* from start to goal. Returns the edge-id path, [] when unreachable."""
        nx, ny = self.nx, self.ny
        gx, gy = nx[goal], ny[goal]
        dist = np.full(self.n_nodes, np.inf)
        came_node = np.full(self.n_nodes, -1, dtype=np.int32)
        came_edge = np.full(self.n_nodes, -1, dtype=np.int32)
        dist[start] = 0.0
        heap = [(0.0, start)]
        while heap:
            f, node = heapq.heappop(heap)
            if node == goal:
                break
            g = dist[node]
            if f > g + np.hypot(nx[node] - gx, ny[node] - gy) + 1e-6:
                continue  # stale heap entry
            lo, hi = self.indptr[node], self.indptr[node + 1]
            for k in range(lo, hi):
                e = int(self.edges[k])
                if not np.isfinite(cost[e]):
                    continue
                t = int(self.targets[k])
                ng = g + cost[e] * mult[e]
                if ng < dist[t] - 1e-9:
                    dist[t] = ng
                    came_node[t] = node
                    came_edge[t] = e
                    heapq.heappush(heap, (ng + np.hypot(nx[t] - gx, ny[t] - gy), t))
        if not np.isfinite(dist[goal]):
            return []
        path = []
        node = goal
        while node != start:
            e = int(came_edge[node])
            if e < 0:
                return []
            path.append(e)
            node = int(came_node[node])
        path.reverse()
        return path

    def dijkstra_times(self, seconds: np.ndarray, start: int, stop_at: set[int]) -> dict[int, float]:
        """Single-source Dijkstra over travel time, stopping when all of
        `stop_at` have been settled. Returns {node: seconds}."""
        dist = np.full(self.n_nodes, np.inf)
        dist[start] = 0.0
        heap = [(0.0, start)]
        remaining = set(stop_at)
        found: dict[int, float] = {}
        while heap and remaining:
            g, node = heapq.heappop(heap)
            if g > dist[node] + 1e-9:
                continue
            if node in remaining:
                found[node] = g
                remaining.discard(node)
            lo, hi = self.indptr[node], self.indptr[node + 1]
            for k in range(lo, hi):
                e = int(self.edges[k])
                if not np.isfinite(seconds[e]):
                    continue
                t = int(self.targets[k])
                ng = g + seconds[e]
                if ng < dist[t] - 1e-9:
                    dist[t] = ng
                    heapq.heappush(heap, (ng, t))
        return found


# ------------------------------------------------------------- stretch mining


class UnionFind:
    def __init__(self, n: int):
        self.parent = np.arange(n, dtype=np.int64)

    def find(self, x: int) -> int:
        p = self.parent
        root = int(x)
        while p[root] != root:
            root = int(p[root])
        while p[x] != root:
            p[x], x = root, p[x]
        return root

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


@dataclass
class Stretch:
    edges: list[int]           # directed edge ids, in driving order
    length_m: float
    fun_km: float              # sum of fun * length
    mid_xy: tuple[float, float]
    start_node: int
    end_node: int


def _bridge_gap(csr: CSR, node: int, cur: int, direction: int, good: np.ndarray,
                bridgeable: np.ndarray, used: np.ndarray, slice_id: np.ndarray,
                g0: np.ndarray, fun: np.ndarray, length: np.ndarray,
                gap_m: float, max_edges: int = 8) -> list[int]:
    """Cross at most `gap_m` of legal low-fun road to reach an unused fun edge.

    Returns the bridge plus the fun edge it reaches, in driving order, or [].
    Without this a 20 m junction stub ends every stretch at every crossroad.
    """
    if gap_m <= 0:
        return []
    best: tuple[tuple[float, float], list[int]] | None = None
    # Depth-first over (node, last edge, edges so far, bridged metres).
    stack = [(node, cur, [], 0.0)]
    while stack:
        at, last, chain, gone = stack.pop()
        if direction == 1:
            lo, hi = csr.indptr[at], csr.indptr[at + 1]
            cand, ends = csr.edges[lo:hi], csr.targets[lo:hi]
        else:
            lo, hi = csr.rindptr[at], csr.rindptr[at + 1]
            cand, ends = csr.redges[lo:hi], csr.rsources[lo:hi]
        taken = {int(slice_id[e]) for e in chain}
        for ce0, nxt in zip(cand, ends):
            ce = int(ce0)
            sid = int(slice_id[ce])
            if used[sid] or sid in taken or int(g0[ce]) == int(g0[last]):
                continue
            if chain and good[ce]:
                key = (float(fun[ce]), -gone)
                if best is None or key > best[0]:
                    best = (key, chain + [ce])
            elif bridgeable[ce] and gone + float(length[ce]) <= gap_m and len(chain) < max_edges:
                stack.append((int(nxt), ce, chain + [ce], gone + float(length[ce])))
    if best is None:
        return []
    return best[1] if direction == 1 else best[1][::-1]


def find_stretches(npz: dict, fun: np.ndarray, excluded: np.ndarray, rubric: dict) -> list[Stretch]:
    """Greedy best-line extraction over the subgraph of fun edges.

    Repeatedly takes the best unused fun edge and walks both ways, always
    continuing onto the best unused continuation and never U-turning, which
    yields the line a driver would actually follow through a fun network.
    """
    rt = rubric["routing"]
    threshold = float(rt["stretch_fun_threshold"])
    min_len = float(rt["stretch_min_km"]) * 1000.0

    u = npz["edge_u"]
    v = npz["edge_v"]
    length = npz["edge_len"].astype(np.float64)
    rev = npz["edge_rev"]
    g0 = npz["edge_g0"]
    n = len(u)

    good = (fun >= threshold) & (~excluded)
    # Legal, open, but below-threshold edges (junction stubs, a crossroad with a
    # give-way) may carry a stretch across a short gap; fun == 0 marks closed.
    bridgeable = (~excluded) & (fun > 0) & ~good
    gap_m = float(rt.get("stretch_split_gap_m", 0))
    # One id per undirected slice so "unused" can be tracked per carriageway.
    slice_id = np.zeros(n, dtype=np.int32)
    slice_of: dict[int, int] = {}
    for e in range(n):
        key = int(g0[e])
        sid = slice_of.get(key)
        if sid is None:
            sid = len(slice_of)
            slice_of[key] = sid
        slice_id[e] = sid
    used = np.zeros(len(slice_of), dtype=bool)

    csr = CSR(npz)
    stretches: list[Stretch] = []
    order = np.argsort(-fun, kind="stable")  # ties keep the lower edge id first
    for seed in order:
        e = int(seed)
        if not good[e] or used[slice_id[e]]:
            continue
        # Walk forward from the seed, then backward, marking slices used.
        # Forward candidates leave v[cur]; backward candidates arrive at u[cur].
        path = [e]
        used[slice_id[e]] = True
        for direction in (1, -1):
            cur = e
            while True:
                if direction == 1:
                    node = int(v[cur])
                    lo, hi = csr.indptr[node], csr.indptr[node + 1]
                    cand = csr.edges[lo:hi]
                else:
                    node = int(u[cur])
                    lo, hi = csr.rindptr[node], csr.rindptr[node + 1]
                    cand = csr.redges[lo:hi]
                best_e, best_key = -1, None
                for ce0 in cand:
                    ce = int(ce0)
                    if not good[ce] or used[slice_id[ce]]:
                        continue
                    if int(g0[ce]) == int(g0[cur]):
                        continue  # the same carriageway back: a U-turn
                    key = (float(fun[ce]), -ce)
                    if best_key is None or key > best_key:
                        best_key, best_e = key, ce
                if best_e < 0:
                    bridge = _bridge_gap(csr, node, cur, direction, good, bridgeable,
                                         used, slice_id, g0, fun, length, gap_m)
                    if not bridge:
                        break
                    for be in bridge:
                        used[slice_id[be]] = True
                    if direction == 1:
                        path.extend(bridge)
                    else:
                        path[:0] = bridge
                    cur = bridge[-1] if direction == 1 else bridge[0]
                    continue
                if direction == 1:
                    path.append(best_e)
                else:
                    path.insert(0, best_e)
                used[slice_id[best_e]] = True
                cur = best_e
        tot = float(length[path].sum())
        if tot >= min_len:
            fk = float((fun[path] * length[path]).sum()) / 1000.0
            mid_edge = path[len(path) // 2]
            mn = int(u[mid_edge])
            stretches.append(Stretch(
                edges=path, length_m=tot, fun_km=fk,
                mid_xy=(float(csr.nx[mn]), float(csr.ny[mn])),
                start_node=int(u[path[0]]), end_node=int(v[path[-1]]),
            ))
    log.info("stretches: %d of at least %.0f m from %d fun edges",
             len(stretches), min_len, int(good.sum()))
    return stretches

# ------------------------------------------------------------------- areas


@dataclass
class Area:
    idx: int
    stretches: list[Stretch]
    centroid: tuple[float, float]
    fun_km: float

    @property
    def best(self) -> Stretch:
        return max(self.stretches, key=lambda s: (s.fun_km, -s.edges[0]))


def cluster_areas(stretches: list[Stretch], rubric: dict,
                  min_fun_km: float = 3.0) -> list[Area]:
    """Greedy seed clustering of stretch midpoints, best stretch first.

    Deterministic: stretches are processed in a fixed order and each joins the
    first cluster whose weighted centroid is within the radius, otherwise it
    seeds a new cluster.
    """
    radius = float(rubric["routing"]["cluster_radius_m"])
    ordered = sorted(stretches, key=lambda s: (-s.fun_km, s.edges[0]))
    areas: list[Area] = []
    for st in ordered:
        home = None
        for area in areas:
            dx = st.mid_xy[0] - area.centroid[0]
            dy = st.mid_xy[1] - area.centroid[1]
            if dx * dx + dy * dy <= radius * radius:
                home = area
                break
        if home is None:
            areas.append(Area(len(areas), [st], st.mid_xy, st.fun_km))
        else:
            total = home.fun_km + st.fun_km
            w0 = home.fun_km / total
            w1 = st.fun_km / total
            home.centroid = (
                home.centroid[0] * w0 + st.mid_xy[0] * w1,
                home.centroid[1] * w0 + st.mid_xy[1] * w1,
            )
            home.fun_km = total
            home.stretches.append(st)
    # Keep areas with enough fun to be worth the drive.
    areas = [a for a in areas if a.fun_km >= min_fun_km]
    for i, a in enumerate(areas):
        a.idx = i
    log.info("areas: %d clusters with >= 3 fun-km", len(areas))
    return areas


# ------------------------------------------------------------------ circuits


@dataclass
class Circuit:
    area: Area
    edges: list[int]           # full loop, back at the start node
    out_and_back: bool
    variant_of: int | None = None


def shared_share(edges_a: list[int], edges_b: list[int], g0: np.ndarray,
                 length: np.ndarray) -> float:
    """Length-weighted share of carriageways common to two paths."""
    sa = {int(g0[e]) for e in edges_a}
    sb = {int(g0[e]) for e in edges_b}
    common = sa & sb
    if not common:
        return 0.0
    # Carriageway length: take it from the first path that uses it.
    len_of: dict[int, float] = {}
    for e in list(edges_a) + list(edges_b):
        len_of.setdefault(int(g0[e]), float(length[e]))
    shared = sum(len_of[g] for g in common)
    total = sum(len_of[int(g0[e])] for e in edges_a)
    return shared / max(total, 1.0)


def clean_circuit_spurs(npz: dict, edges: list[int]) -> list[int]:
    """Remove reversals and mostly retracing side excursions, not real loops.

    Only called for generated circuits. Keep the start node, and use the
    existing 25 m/opposite-heading test for separately mapped carriageways.
    """
    if not edges:
        return []
    u, v, g0 = npz["edge_u"], npz["edge_v"], npz["edge_g0"]
    e = np.asarray(edges)
    if not np.array_equal(v[e[:-1]], u[e[1:]]) or v[e[-1]] != u[e[0]]:
        raise ValueError("circuit must be continuous and closed")
    start = int(u[e[0]])
    clean: list[int] = []
    visits = {start: [0]}
    for edge in edges:
        clean.append(edge)
        end = int(v[edge])
        cut = None
        if len(clean) >= 2:
            previous = clean[-2]
            if g0[previous] == g0[edge] and u[previous] == v[edge] and v[previous] == u[edge]:
                cut = len(clean) - 2
        if cut is None:
            # A repeated junction is not enough: retain genuine figure-eight
            # loops. Never delete the whole circuit or move its start.
            cut = next((i for i in reversed(visits.get(end, []))
                        if i > 0 and retrace_share(npz, clean[i:]) >= .80), None)
        if cut is None:
            visits.setdefault(end, []).append(len(clean))
        else:
            del clean[cut:]
            visits = {start: [0]}
            for i, kept in enumerate(clean, 1):
                visits.setdefault(int(v[kept]), []).append(i)
    return clean


def build_circuit(csr: CSR, area: Area, cost: np.ndarray, mult: np.ndarray,
                  npz: dict, rubric: dict) -> Circuit | None:
    """Out-and-return loop anchored on the area's best stretch."""
    length = npz["edge_len"].astype(np.float64)
    anchor = area.best
    start = anchor.start_node

    # The far target is the stretch endpoint in the area farthest from start.
    best_d, target = -1.0, None
    for st in area.stretches:
        for node in (st.start_node, st.end_node):
            d = float(np.hypot(csr.nx[node] - csr.nx[start], csr.ny[node] - csr.ny[start]))
            if d > best_d + 1e-9:
                best_d, target = d, node
    if target is None or target == start:
        return None

    out = csr.astar(cost, mult, start, target)
    if not out:
        return None
    mult_back = mult.copy()
    used_slices = np.isin(npz["edge_g0"], npz["edge_g0"][out])
    mult_back[used_slices] *= float(rubric["connectors"]["reuse_penalty"])
    back = csr.astar(cost, mult_back, target, start)
    if not back:
        return None
    edges = clean_circuit_spurs(npz, out + back)
    if not edges:
        return None
    ov = (retrace_share(npz, edges) if len(edges) < len(out) + len(back)
          else shared_share(out, back, npz["edge_g0"], length))
    return Circuit(area=area, edges=edges, out_and_back=ov > OUT_AND_BACK_SHARE)

# ------------------------------------------------------------- route details


def route_geometry(npz: dict, edges: list[int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Concatenate edge geometries into one polyline. Returns x, y (RD) and the
    cumulative distance along the route in metres."""
    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    cx, cy = npz["coord_x"], npz["coord_y"]
    parts = []
    for e in edges:
        a, b = int(g0[e]), int(g1[e])
        if b - a < 2:
            continue
        seg = np.column_stack([cx[a:b], cy[a:b]])
        if npz["edge_rev"][e]:
            seg = seg[::-1]
        if parts and np.allclose(seg[0], parts[-1][-1]):
            seg = seg[1:]
        parts.append(seg)
    if not parts:
        return np.zeros(0), np.zeros(0), np.zeros(0)
    line = np.vstack(parts)
    d = np.hypot(np.diff(line[:, 0]), np.diff(line[:, 1]))
    s = np.concatenate([[0.0], np.cumsum(d)])
    return line[:, 0], line[:, 1], s


def _trace(npz: dict, edges: list[int], step: float = 20.0):
    """Evenly spaced points along a route with unit headings and route distance."""
    x, y, s = route_geometry(npz, edges)
    if len(s) < 2 or s[-1] < step:
        return np.zeros((0, 2)), np.zeros((0, 2)), np.zeros(0)
    t = np.arange(step / 2, s[-1], step)
    hx = np.interp(t + 1, s, x) - np.interp(t - 1, s, x)
    hy = np.interp(t + 1, s, y) - np.interp(t - 1, s, y)
    norm = np.maximum(np.hypot(hx, hy), 1e-9)
    return (np.column_stack([np.interp(t, s, x), np.interp(t, s, y)]),
            np.column_stack([hx / norm, hy / norm]), t)


def retrace_share(npz: dict, edges: list[int], other: list[int] | None = None,
                  radius: float = 25.0, gap: float = 150.0) -> float:
    """Share of `edges` driven again in the opposite direction within `radius` m.

    Compared with `other` when given, otherwise with the rest of the same route
    more than `gap` m further along it (so a hairpin or the turn itself does not
    count). Unlike `shared_share` this sees the parallel carriageway of a dual
    road, which is a separate graph segment.
    """
    p, h, t = _trace(npz, edges)
    if not len(t):
        return 0.0
    q, k, u = (p, h, t) if other is None else _trace(npz, other)
    if not len(u):
        return 0.0
    hit = np.zeros(len(t), bool)
    for i in range(0, len(t), 512):
        near = ((p[i:i + 512, None, 0] - q[None, :, 0]) ** 2
                + (p[i:i + 512, None, 1] - q[None, :, 1]) ** 2) <= radius ** 2
        near &= (h[i:i + 512] @ k.T) < -0.7
        if other is None:
            near &= np.abs(t[i:i + 512, None] - u[None, :]) > gap
        hit[i:i + 512] = near.any(axis=1)
    return float(hit.mean())


def near_share(npz: dict, edges: list[int], other: list[int],
               radius: float = 25.0) -> float:
    """Share of `edges` within `radius` m of `other` in either direction."""
    p, _, t = _trace(npz, edges)
    q, _, u = _trace(npz, other)
    if not len(t) or not len(u):
        return 0.0
    hit = np.zeros(len(t), bool)
    for i in range(0, len(t), 512):
        hit[i:i + 512] = (((p[i:i + 512, None, 0] - q[None, :, 0]) ** 2
                           + (p[i:i + 512, None, 1] - q[None, :, 1]) ** 2)
                          <= radius ** 2).any(axis=1)
    return float(hit.mean())


def _chunk_edges(s_edges: np.ndarray, n_chunks: int = 40) -> list[tuple[int, int]]:
    """Split cumulative-distance positions into n_chunks distance-equal spans."""
    total = float(s_edges[-1])
    last = len(s_edges) - 2
    if total <= 0:
        return [(0, max(last, 0))]
    bounds = np.linspace(0, total, n_chunks + 1)
    idx = np.searchsorted(s_edges, bounds)
    return [(min(int(idx[i]), last),
             max(min(int(idx[i]), last), min(int(idx[i + 1]) - 1, last)))
            for i in range(n_chunks)]


def circuit_stats(npz: dict, feats: dict, scores: dict, edges: list[int],
                  rubric: dict) -> dict:
    """The numbers the route card and the detail panel need."""
    e = np.asarray(edges, dtype=np.int64)
    ln = npz["edge_len"][e].astype(np.float64)
    fun = scores["fun"][e].astype(np.float64)
    total_km = float(ln.sum()) / 1000.0
    fun_km = float((fun * ln).sum()) / 1000.0
    dull = (fun < float(rubric["routing"]["linked_low_fun_below"])) | (scores["excluded"][e] > 0)
    connector_share = float(ln[dull].sum() / max(ln.sum(), 1.0))
    w = ln / max(ln.sum(), 1e-9)
    breakdown = {
        k: float((scores[f"score_{k}"][e] * w).sum() * 100.0)
        for k in ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery")
    }
    legal = feats["legal_speed"][e].astype(np.float64)
    cruise = float(rubric["time_model"]["cruise_factor"])
    stop_s = float(rubric["time_model"]["intersection_penalty_s"])
    drive_s = float((ln / np.maximum(legal / 3.6 * cruise, 2.0)).sum())
    controls = feats.get("controls")
    if controls is not None:
        drive_s += float((controls[e] > 0).sum()) * stop_s
    return {
        "km": round(total_km, 1),
        "fun_km": round(fun_km, 1),
        "drive_min": int(round(drive_s / 60)),
        "connector_share": connector_share,
        "climb_m": (None if projected_crs() == "EPSG:3301" and not feats["elev_ok"][e].all()
                    else int(round(float(feats["climb_m"][e].sum())))),
        "score": {
            "total": round(100.0 * fun_km / max(total_km, 1e-9), 1),
            **{k: round(v, 1) for k, v in breakdown.items()},
        },
    }


def route_corners(npz: dict, feats: dict, edges: list[int]) -> list[dict]:
    """Corner markers along the route, from the per-edge corner list."""
    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    cx, cy = npz["coord_x"], npz["coord_y"]
    ce, cs = feats["corner_edge"], feats["corner_s"]
    cr, csign, cv = feats["corner_r"], feats["corner_sign"], feats["corner_v"]
    engaged = feats["corner_engaged"]
    on_route = np.isin(ce, edges)
    from pyproj import Transformer
    tf = Transformer.from_crs(projected_crs(), "EPSG:4326", always_xy=True)
    out = []
    for i in np.flatnonzero(on_route):
        if not engaged[i]:
            continue
        e = int(ce[i])
        a, b = int(g0[e]), int(g1[e])
        seglen = float(npz["edge_len"][e])
        frac = float(cs[i]) / max(seglen, 1e-9)
        span = max(b - a - 1, 0)
        pos = (b - 1 - frac * span) if npz["edge_rev"][e] else (a + frac * span)
        i0 = int(np.floor(pos))
        i1 = min(i0 + 1, b - 1)
        f = min(max(pos - i0, 0.0), 1.0)
        x = float(cx[i0]) * (1 - f) + float(cx[i1]) * f
        y = float(cy[i0]) * (1 - f) + float(cy[i1]) * f
        lon, lat = tf.transform(x, y)
        out.append({
            "lon": round(lon, 6), "lat": round(lat, 6),
            "r": int(round(float(cr[i]))),
            "dir": "L" if csign[i] > 0 else "R",
            "v": int(round(float(cv[i]))),
        })
    return out[:24]  # the map stays readable with the two dozen hardest corners

def route_profiles(npz: dict, feats: dict, scores: dict, edges: list[int],
                   sampler, profile_max: int = 60) -> tuple[list, list, list, list]:
    """line (lon/lat), seg chunks, elevation profile and curvature profile."""
    from pyproj import Transformer

    x, y, s = route_geometry(npz, edges)
    if not len(x):
        return [], [], [], []
    tf = Transformer.from_crs(projected_crs(), "EPSG:4326", always_xy=True)
    lon, lat = tf.transform(x, y)
    # Downsample the polyline for the web map; 900 points keep it light.
    if len(lon) > 900 and projected_crs() == "EPSG:28992":
        keep = np.unique(np.linspace(0, len(lon) - 1, 900).astype(int))
        lon, lat = lon[keep], lat[keep]
    line = [[round(float(a), 6), round(float(b), 6)] for a, b in zip(lon, lat)]

    # Edge position along the route, for chunk-level statistics.
    e = np.asarray(edges, dtype=np.int64)
    length = npz["edge_len"][e].astype(np.float64)
    s_edges = np.concatenate([[0.0], np.cumsum(length)])
    total_km = float(s_edges[-1]) / 1000.0
    n_chunks = max(8, min(40, int(round(total_km / 1.5))))
    chunks = _chunk_edges(s_edges, n_chunks)

    fun = scores["fun"][e].astype(np.float64)
    legal = feats["legal_speed"][e].astype(np.float64)
    head = feats["head_per_km"][e].astype(np.float64)
    seg = []
    curv = []
    for i0, i1 in chunks:
        sl = slice(i0, i1 + 1)
        w = length[sl]
        wsum = max(float(w.sum()), 1e-9)
        seg_fun = float((fun[sl] * w).sum() / wsum)
        seg_lim = float(np.median(legal[sl]))
        seg_head = float((head[sl] * w).sum() / wsum)
        seg.append({"i0": i0, "i1": i1, "fun": int(round(seg_fun * 100)),
                    "lim": int(round(seg_lim)), "v": int(round(min(seg_lim, 130)))})
        curv.append([round(float(s_edges[i0]) / 1000.0, 2),
                     round(min(seg_head / 350.0, 1.0), 2)])

    elev: list[list[float]] = []
    if sampler is not None and len(x) > 1:
        n_pts = max(8, min(profile_max, int(round(total_km / 1.5))))
        fi = np.linspace(0, len(x) - 1, n_pts)
        i0 = np.floor(fi).astype(int)
        i1 = np.minimum(i0 + 1, len(x) - 1)
        f = fi - i0
        xs = x[i0] * (1 - f) + x[i1] * f
        ys = y[i0] * (1 - f) + y[i1] * f
        z = sampler.sample(xs, ys)
        ss = s[i0] * (1 - f) + s[i1] * f
        z = np.where(np.isfinite(z), z, np.nan)
        if np.isfinite(z).all() if projected_crs() == "EPSG:3301" else np.isfinite(z).any():
            z = np.where(np.isfinite(z), z, np.nanmedian(z))
            elev = [[round(float(ss[i]) / 1000.0, 2), round(float(z[i]), 1)]
                    for i in range(n_pts)]

    # seg indices reference line points; scale chunk bounds onto the polyline.
    scale = (len(line) - 1) / max(float(s_edges[-1]), 1e-9)
    for c, (i0, i1) in zip(seg, chunks):
        c["i0"] = int(round(float(s_edges[i0]) * scale))
        c["i1"] = int(round(float(s_edges[min(i1, len(s_edges) - 1)]) * scale))
    if projected_crs() == "EPSG:3301":
        # Keep real posted limits, not chunk medians that can invent e.g. 75
        # from 50/100. Estonia retains every geometry vertex and exact spans.
        offsets = np.concatenate([[0], np.cumsum(
            npz["edge_g1"][e] - npz["edge_g0"][e] - 1)])
        seg = [{"i0": int(offsets[i]), "i1": int(offsets[i + 1]),
                "fun": int(round(float(fun[i]) * 100)),
                "lim": int(legal[i]), "v": int(legal[i])}
               for i in range(len(e))]
    return line, seg, elev, curv


def route_roads(npz: dict, side: dict, scores: dict, edges: list[int]) -> list[dict]:
    """The three roads that make the route, by fun-kilometres."""
    names = side["names"]
    nm = npz["edge_name"]
    length = npz["edge_len"]
    fun = scores["fun"]
    acc: dict[str, list[float]] = {}
    for e in edges:
        n0 = int(nm[e])
        if not n0:
            continue
        a = acc.setdefault(names[n0], [0.0, 0.0])
        a[0] += float(fun[e]) * float(length[e])
        a[1] += float(length[e])
    best = sorted(acc.items(), key=lambda kv: (-kv[1][0], kv[0]))[:3]
    return [{"name": k, "km": round(v[1] / 1000.0, 1),
             "fun": int(round(100 * v[0] / max(v[1], 1e-9)))} for k, v in best]


def route_warnings(npz: dict, feats: dict, edges: list[int]) -> list[dict]:
    """Cameras and bump clusters along the route, worth a heads-up."""
    from pyproj import Transformer

    tf = Transformer.from_crs(projected_crs(), "EPSG:4326", always_xy=True)
    out = []
    e = np.asarray(edges, dtype=np.int64)
    g0, g1 = npz["edge_g0"], npz["edge_g1"]
    cx, cy = npz["coord_x"], npz["coord_y"]

    def mid_lonlat(edge: int) -> tuple[float, float]:
        a, b = int(g0[edge]), int(g1[edge])
        m = (a + b) // 2
        return tf.transform(float(cx[m]), float(cy[m]))

    cameras = feats.get("cameras")
    cams = e[cameras[e] > 0] if cameras is not None else e[:0]
    for edge in cams[:4]:
        lon, lat = mid_lonlat(int(edge))
        out.append({"type": "camera", "lon": round(lon, 6), "lat": round(lat, 6),
                    "note": "Speed camera on this stretch"})
    bumps = feats["bumps"][e] if "bumps" in feats else np.zeros(len(e))
    bump_edges = e[bumps >= 2]
    for edge in bump_edges[:4]:
        lon, lat = mid_lonlat(int(edge))
        out.append({"type": "bump", "lon": round(lon, 6), "lat": round(lat, 6),
                    "note": "Speed bumps; take it easy"})
    busy = feats["busy_bicycles"][e] if "busy_bicycles" in feats else np.zeros(len(e))
    bike_edges = e[busy > 0.65]
    if len(bike_edges):
        lon, lat = mid_lonlat(int(bike_edges[len(bike_edges) // 2]))
        out.append({"type": "cyclists", "lon": round(lon, 6), "lat": round(lat, 6),
                    "note": "Popular with weekend cyclists; leave space"})
    return out


def why_strings(npz: dict, feats: dict, stats: dict, edges: list[int],
                fallback: str = "A spirited circuit with a good rhythm") -> list[str]:
    e = np.asarray(edges, dtype=np.int64)
    length = npz["edge_len"][e].astype(np.float64)
    w = length / max(float(length.sum()), 1e-9)
    out = []
    n_sweet = int(feats["n_sweet"][e].sum())
    if n_sweet >= 6:
        out.append(f"{n_sweet} sweet-spot corners (30-150 m radius)")
    head = float((feats["head_per_km"][e] * w).sum())
    if head >= 120:
        out.append(f"Properly twisty: {head:.0f} deg of turning per km")
    quiet = stats["score"]["quiet"]
    if quiet >= 70:
        out.append("Modelled as usually quiet (static estimate, not live traffic)")
    if stats["climb_m"] is not None and stats["climb_m"] >= 150:
        out.append(f"+{stats['climb_m']} m of modelled climbing")
    if stats["score"]["scenery"] >= 70:
        out.append("Forest, heath or dune scenery most of the way")
    if not out:
        out.append(fallback)
    return out[:3]


# ------------------------------------------------------------ assembly / run


def build_variants(csr: CSR, areas: list[Area], cost: np.ndarray,
                   npz: dict, rubric: dict) -> list[Circuit]:
    """Build the primary circuit and penalised alternatives for each area."""
    rt = rubric["routing"]
    reuse = float(rubric["connectors"]["reuse_penalty"])
    max_variants = int(rt["variants_per_area"])
    overlap_drop = float(rt["overlap_drop_threshold"])
    length = npz["edge_len"].astype(np.float64)
    g0 = npz["edge_g0"]
    circuits: list[Circuit] = []
    for area in areas:
        kept: list[Circuit] = []
        mult = np.ones(len(cost), dtype=np.float64)
        for variant in range(max_variants):
            circuit = build_circuit(csr, area, cost, mult, npz, rubric)
            if circuit is None:
                break
            if any(shared_share(circuit.edges, old.edges, g0, length) > overlap_drop
                   for old in kept):
                break
            if variant:
                circuit.variant_of = area.idx
            kept.append(circuit)
            used_slices = np.isin(g0, g0[circuit.edges])
            mult[used_slices] *= reuse
        circuits.extend(kept)
    log.info("circuits: %d from %d areas", len(circuits), len(areas))
    return circuits


def rank_circuits(circuits: list[Circuit], npz: dict, feats: dict,
                  scores: dict, rubric: dict) -> list[tuple[Circuit, dict]]:
    """Apply route-quality bounds, area caps and the national top-N."""
    rt = rubric["routing"]
    connector_max = min(float(rt["connector_share_max"]), MAX_CONNECTOR_SHARE)
    candidates = []
    for circuit in circuits:
        stats = circuit_stats(npz, feats, scores, circuit.edges, rubric)
        if not float(rt.get("circuit_soft_min_km", SOFT_MIN_KM)) <= stats["km"] <= SOFT_MAX_KM:
            continue
        if stats["connector_share"] > connector_max:
            continue
        candidates.append((circuit, stats))
    candidates.sort(key=lambda x: (
        x[0].out_and_back, -x[1]["fun_km"], -x[1]["score"]["total"],
        x[0].area.idx, x[0].variant_of is not None, tuple(x[0].edges),
    ))
    kept: list[tuple[Circuit, dict]] = []
    per_area: dict[int, int] = {}
    for item in candidates:
        area_id = item[0].area.idx
        if per_area.get(area_id, 0) >= int(rt["variants_per_area"]):
            continue
        if any(min(shared_share(item[0].edges, old.edges, npz["edge_g0"], npz["edge_len"]),
                   shared_share(old.edges, item[0].edges, npz["edge_g0"], npz["edge_len"])) > 0.7
               for old, _ in kept):
            continue  # windows must not fill the list with near-identical circuits
        kept.append(item)
        per_area[area_id] = per_area.get(area_id, 0) + 1
        if len(kept) >= int(rt["top_routes"]):
            break
    log.info("ranking: kept %d of %d candidate circuits", len(kept), len(candidates))
    return kept


def _area_name(area: Area, npz: dict, side: dict) -> str:
    names = side["names"]
    for edge in area.best.edges:
        name_id = int(npz["edge_name"][edge])
        if name_id:
            return f"{names[name_id]} area"
    return f"Driving area {area.idx + 1}"


def _corner_count(feats: dict, edges: list[int]) -> dict[str, int]:
    e = np.asarray(edges, dtype=np.int64)
    return {
        label: int(feats[f"n_{source}"][e].sum())
        for label, source in (("tight", "hairpin"), ("sweet", "sweet"), ("flowing", "flowing"))
    }


def _route_flags(circuit: Circuit, stats: dict, rubric: dict,
                 reach_min: int | None) -> list[str]:
    flags = []
    rt = rubric["routing"]
    if circuit.out_and_back:
        flags.append("out_and_back")
    if not float(rt["circuit_min_km"]) <= stats["km"] <= float(rt["circuit_max_km"]):
        flags.append("length_outside_ideal")
    if reach_min is None:
        flags.append("home_unreachable")
    elif reach_min > int(rt["within_home_min"]):
        flags.append("far_from_home")
    return flags


def _travel_seconds(npz: dict, feats: dict, rubric: dict) -> np.ndarray:
    legal = feats["legal_speed"].astype(np.float64)
    cruise = float(rubric["time_model"]["cruise_factor"])
    return npz["edge_len"].astype(np.float64) / np.maximum(legal / 3.6 * cruise, 2.0)


def _lonlat(x: float, y: float) -> tuple[float, float]:
    from pyproj import Transformer

    tf = Transformer.from_crs(projected_crs(), "EPSG:4326", always_xy=True)
    lon, lat = tf.transform(x, y)
    return round(float(lon), 6), round(float(lat), 6)


def _gmaps_link(line: list[list[float]]) -> str:
    if not line:
        return ""
    picks = np.unique(np.linspace(0, len(line) - 1, min(8, len(line))).astype(int))
    points = [line[int(i)] for i in picks]
    start = f"{points[0][1]},{points[0][0]}"
    params = {"api": 1, "origin": start, "destination": start, "travelmode": "driving"}
    if len(points) > 2:
        params["waypoints"] = "|".join(f"{lat},{lon}" for lon, lat in points[1:-1])
    return "https://www.google.com/maps/dir/?" + urlencode(params)


def _top_roads(stretches: list[Stretch], npz: dict, side: dict,
               scores: dict, limit: int = 12) -> list[dict]:
    """Highest-fun named stretches, one entry per road name."""
    from pyproj import Transformer

    tf = Transformer.from_crs(projected_crs(), "EPSG:4326", always_xy=True)
    out = []
    seen: set[str] = set()
    for stretch in sorted(stretches, key=lambda s: (-s.fun_km, s.edges[0])):
        roads = route_roads(npz, side, scores, stretch.edges)
        if not roads or roads[0]["name"] in seen:
            continue
        seen.add(roads[0]["name"])
        x, y, _ = route_geometry(npz, stretch.edges)
        if len(x) > 300:
            keep = np.unique(np.linspace(0, len(x) - 1, 300).astype(int))
            x, y = x[keep], y[keep]
        lon, lat = tf.transform(x, y)
        line = [[round(float(a), 6), round(float(b), 6)] for a, b in zip(lon, lat)]
        access = npz.get("edge_access")
        mask = int(np.bitwise_and.reduce(access[stretch.edges])) if access is not None else 255
        out.append({"name": roads[0]["name"], "fun": roads[0]["fun"], "line": line,
                    "windows": sorted(label for bit, (label, _) in enumerate(WINDOWS)
                                      if mask & (1 << bit))})
        if len(out) == limit:
            break
    return out


def reverse_stretch(npz: dict, edges: list[int]) -> list[int]:
    """Reverse a mined stretch only if each physical slice permits car travel."""
    g0, u, v = npz["edge_g0"], npz["edge_u"], npz["edge_v"]
    opposite = []
    for e in reversed(edges):
        other = e + 1 if e + 1 < len(g0) and g0[e + 1] == g0[e] else e - 1
        if other < 0 or g0[other] != g0[e] or u[other] != v[e] or v[other] != u[e]:
            return []
        opposite.append(other)
    return opposite


def reverse_is_fun(forward: list[int], reverse: list[int], fun: np.ndarray,
                   excluded: np.ndarray, threshold: float) -> bool:
    """The way back must be legal everywhere and fun wherever the way out was.

    Bridged junction stubs were below threshold outbound too, so only their
    legality is required in reverse.
    """
    if not reverse or excluded[reverse].any():
        return False
    was_fun = fun[forward][::-1] >= threshold
    return bool(np.all(fun[reverse][was_fun] >= threshold))


def sprint_quality(fun: np.ndarray, length: np.ndarray, threshold: float,
                   bridge_max: float) -> bool:
    """Bridged road is allowed, but cannot erase the sprint's fun floor."""
    total = float(length.sum())
    return bool(total > 0 and
                float(np.dot(fun, length)) / total >= threshold and
                float(length[fun < threshold].sum()) / total <= bridge_max)


def mine_sprints(stretches: list[Stretch], npz: dict, side: dict,
                 feats: dict, scores: dict, rubric: dict, sampler=None) -> list[dict]:
    """National point-to-point drives from the SAME stretches as circuits."""
    import hashlib

    from pyproj import Transformer

    tf = Transformer.from_crs(projected_crs(), "EPSG:4326", always_xy=True)
    home_xy = {name: Transformer.from_crs("EPSG:4326", projected_crs(),
                                        always_xy=True).transform(*point)
               for name, point in origins().items()}
    access = npz.get("edge_access", np.full(len(npz["edge_u"]), 255, np.uint8))
    seen: set[tuple[int, ...]] = set()
    out = []
    for st in stretches:
        key = tuple(sorted(int(npz["edge_g0"][e]) for e in st.edges))
        if key in seen:
            continue
        seen.add(key)
        reverse = reverse_stretch(npz, st.edges)
        if not reverse:
            continue
        threshold = float(rubric["routing"]["stretch_fun_threshold"])
        excluded = scores.get("excluded", np.zeros(len(access), np.uint8)).astype(bool)
        if not reverse_is_fun(st.edges, reverse, scores["fun"], excluded, threshold):
            continue
        mask = int(np.bitwise_and.reduce(access[st.edges + reverse]))
        if not mask:
            continue
        e = np.asarray(st.edges, dtype=np.int64)
        length = npz["edge_len"][e].astype(np.float64)
        fun = scores["fun"][e].astype(np.float64)
        if not sprint_quality(fun, length, threshold,
                              float(rubric["routing"]["sprint_bridge_share_max"])):
            continue
        avg = float(np.average(fun, weights=length))
        x, y, s = route_geometry(npz, st.edges)
        if len(x) < 2:
            continue
        keep = np.unique(np.linspace(0, len(x) - 1, min(len(x), 400)).astype(int))
        lon, lat = tf.transform(x[keep], y[keep])
        line = [[round(float(a), 6), round(float(b), 6)] for a, b in zip(lon, lat)]
        mid = int(np.searchsorted(s, s[-1] / 2))
        nearby = {name: round(float(np.hypot(x[mid] - hx, y[mid] - hy)) / 1000, 1)
                  for name, (hx, hy) in home_xy.items()}
        roads = route_roads(npz, side, scores, st.edges)
        stats = circuit_stats(npz, feats, scores, st.edges, rubric)
        profile_line, seg, elev, curv = route_profiles(npz, feats, scores, st.edges, sampler, profile_max=16)
        if projected_crs() == "EPSG:3301":
            line = profile_line
        name = roads[0]["name"] if roads else f"Road {min(st.edges)}"
        breakdown = {dim: round(float(np.average(scores["score_" + dim][e], weights=length)), 2)
                     for dim in ("corners", "flow", "quiet", "speed", "elevation", "surface", "scenery")}
        head = float(np.average(feats["head_per_km"][e], weights=length))
        engaged = float(np.average(feats["engaged_per_km"][e], weights=length))
        # Character descriptions are independent of rank and never reward speed
        # over the legal limit. Legal-pace rhythm includes flowing sweepers.
        traits = [label for label, good in
                  (("flowing", head >= 70 and breakdown["flow"] >= .5),
                   ("technical", engaged >= 1.5),
                   ("scenic", breakdown["scenery"] >= .7),
                   ("quiet", breakdown["quiet"] >= .7),
                   ("smooth", breakdown["surface"] >= .8)) if good]
        out.append({
            "id": "sprint-" + hashlib.sha256(
                np.asarray(key, dtype="<i8").tobytes()
            ).hexdigest()[:16], "name": f"{name} Sprint",
            "km": round(st.length_m / 1000, 2), "fun": round(avg, 3),
            "fun_km": round(st.fun_km, 2), "drive_min": stats["drive_min"],
            "line": line,
            "start": {"lon": line[0][0], "lat": line[0][1]},
            "end": {"lon": line[-1][0], "lat": line[-1][1]},
            "distance_km": nearby, "roads": roads,
            "score": breakdown, "traits": traits,
            "climb_m": stats["climb_m"], "corner_count": _corner_count(feats, st.edges),
            "corners": route_corners(npz, feats, st.edges),
            "stops": route_warnings(npz, feats, st.edges),
            "seg": seg, "elev": elev, "curv": curv,
            "why": why_strings(npz, feats, stats, st.edges,
                               "A reversible stretch of scored driving road"),
            "windows": sorted(label for bit, (label, _) in enumerate(WINDOWS)
                              if mask & (1 << bit)),
            "return": "Reverse the line only after finding a safe, legal place to turn around",
        })
    return sorted(out, key=lambda s: (-s["fun_km"], -s["fun"], s["id"]))


def sprint_report(sprints: list[dict]) -> str:
    """A local 100 km VIEW of the national sprint catalogue, not a mining cap."""
    lines = [
        "# National sprints, Zaandam / Haarlem view",
        "",
        f"{len(sprints):,} nationally mined, reversible point-to-point drives. "
        "They use the same high-fun stretches and absolute score as circuits; "
        "the 100 km straight-line radius is only a view around either home, "
        "never an extraction filter. A U-turn is **not** guaranteed at the endpoint.",
        "Window labels are sampled access checks, not live permission or traffic estimates.",
        "",
    ]
    for center in ("Zaandam", "Haarlem"):
        local = [s for s in sprints if s["distance_km"][center] <= 100]
        lines.extend([f"## Within 100 km of {center}: {len(local):,} sprints", "",
                      "| Sprint | km | Fun | From centre km | Traits |",
                      "|---|---:|---:|---:|---|"])
        for item in sorted(local, key=lambda s: (s["distance_km"][center], -s["fun_km"], s["id"]))[:50]:
            lines.append(f"| {item['name']} | {item['km']:.2f} | {item['fun']:.3f} | "
                         f"{item['distance_km'][center]:.1f} | {', '.join(item['traits'])} |")
        lines.append("")
    matches = [s for s in sprints if any(r["name"] == "Duinlustweg" for r in s["roads"])]
    lines += ["## Positive anchor: Duinlustweg", ""]
    lines += [f"- {s['name']}: {s['km']:.2f} km, fun {s['fun']:.3f}, "
              f"{s['distance_km']['Haarlem']:.1f} km from Haarlem; "
              f"windows {len(s['windows'])}/{len(WINDOWS)}."
              for s in matches] or ["- Not mined; inspect feature and access gates."]
    return "\n".join(lines) + "\n"


def assemble(routes: list[tuple[Circuit, dict]], stretches: list[Stretch],
             npz: dict, side: dict, feats: dict, scores: dict, rubric: dict,
             sampler, generated: str) -> dict:
    """Assemble the stable JSON contract consumed by the parked web app."""
    from pyproj import Transformer

    tf_home = Transformer.from_crs("EPSG:4326", projected_crs(), always_xy=True)
    home_name, home_point = next(iter(origins().items()))
    hx, hy = tf_home.transform(*home_point)
    csr = CSR(npz)
    home_node = int(np.argmin((csr.nx - hx) ** 2 + (csr.ny - hy) ** 2))
    access = npz.get("edge_access", np.full(len(npz["edge_u"]), 255, np.uint8))
    route_masks = [int(np.bitwise_and.reduce(access[c.edges])) for c, _ in routes]
    starts = {c.area.best.start_node for c, _ in routes}
    travel = _travel_seconds(npz, feats, rubric)
    reach = {}
    for bit in sorted({min((i for i in range(len(WINDOWS)) if mask & (1 << i)),
                           key=lambda i: WINDOWS[i][1])
                       for mask in route_masks}) if projected_crs() == "EPSG:28992" else []:
        seconds = np.where(access & (1 << bit), travel, np.inf)
        reach[bit] = csr.dijkstra_times(seconds, home_node, starts)

    represented = {c.area.idx: c.area for c, _ in routes}
    areas = []
    area_names = {}
    for idx, area in sorted(represented.items()):
        lon, lat = _lonlat(*area.centroid)
        area_id = f"area-{idx + 1:03d}"
        name = _area_name(area, npz, side)
        area_names[idx] = (area_id, name)
        areas.append({"id": area_id, "name": name, "lon": lon, "lat": lat})

    out_routes = []
    variants: dict[int, int] = {}
    for (circuit, stats), mask in zip(routes, route_masks):
        idx = circuit.area.idx
        variant = variants.get(idx, 0)
        variants[idx] = variant + 1
        route_id = f"area-{idx + 1:03d}-{'main' if variant == 0 else f'alt-{variant}'}"
        area_id, area_name = area_names[idx]
        roads = route_roads(npz, side, scores, circuit.edges)
        road_name = roads[0]["name"] if roads else area_name.removesuffix(" area")
        name = f"{road_name} Circuit" + (f" {variant + 1}" if variant else "")
        line, seg, elev, curv = route_profiles(npz, feats, scores, circuit.edges, sampler)
        start_lon, start_lat = _lonlat(
            float(csr.nx[circuit.area.best.start_node]),
            float(csr.ny[circuit.area.best.start_node]),
        )
        window_bit = min((i for i in range(len(WINDOWS)) if mask & (1 << i)),
                         key=lambda i: WINDOWS[i][1])
        seconds = reach.get(window_bit, {}).get(circuit.area.best.start_node)
        reach_min = None if seconds is None else int(round(seconds / 60.0))
        out_routes.append({
            "id": route_id,
            "name": name,
            "area_id": area_id,
            "area_name": area_name,
            "km": stats["km"],
            "drive_min": stats["drive_min"],
            "reach_min": reach_min,
            "fun_km": stats["fun_km"],
            "climb_m": stats["climb_m"],
            "corner_count": _corner_count(feats, circuit.edges),
            "score": stats["score"],
            "why": why_strings(npz, feats, stats, circuit.edges),
            "flags": [flag for flag in _route_flags(circuit, stats, rubric, reach_min)
                      if projected_crs() == "EPSG:28992" or flag != "home_unreachable"],
            "windows": sorted(label for bit, (label, _) in enumerate(WINDOWS)
                              if mask & (1 << bit)),
            "start": {"lon": start_lon, "lat": start_lat, "label": "Start point"},
            "line": line,
            "seg": seg,
            "elev": elev,
            "curv": curv,
            "corners": route_corners(npz, feats, circuit.edges),
            "stops": route_warnings(npz, feats, circuit.edges),
            "roads": roads,
            "links": {
                "gmaps": _gmaps_link(line),
            },
        })

    return {
        "meta": {
            "title": "FunRoads",
            "generated": generated,
            "tagline": "Spirited drives, scored by rubric",
            "windows": "Sample departures in Netherlands local time; check current signs before driving",
        },
        "home": {"name": HOME_NAME if projected_crs() == "EPSG:28992" else home_name,
                 "lon": home_point[0], "lat": home_point[1]},
        "areas": areas,
        "toproads": _top_roads(stretches, npz, side, scores),
        "routes": out_routes,
    }


def run() -> None:
    """Build routes from the national caches, falling back to the bbox caches."""
    from .elevation import Sampler

    t0 = time.perf_counter()
    p = ensure_dirs()
    bbox = not (p.cache / "scores.npz").exists()
    suffix = "_bbox" if bbox else ""
    graph_dir = p.cache / ("graph_bbox" if bbox else "graph")
    npz, side = graph_mod.load(bbox)
    with np.load(p.cache / f"features{suffix}.npz") as z:
        feats = {k: z[k] for k in z.files}
    with np.load(p.cache / f"scores{suffix}.npz") as z:
        scores = {k: z[k] for k in z.files}
    rubric = load_rubric()

    lam = float(rubric["connectors"]["lambda"])
    gamma = float(rubric["connectors"]["gamma"])
    length = npz["edge_len"].astype(np.float64)
    fun = scores["fun"].astype(np.float64)
    base_cost = length * np.power(1.0 + lam * (1.0 - fun), gamma)
    csr = CSR(npz)
    access = npz.get("edge_access", np.full(len(fun), 255, np.uint8))
    stretches = []
    circuits = []
    seen_masks: set[bytes] = set()
    for bit, (label, _) in enumerate(WINDOWS):
        open_edges = (access & (1 << bit)) != 0
        signature = np.packbits(open_edges).tobytes()
        if signature in seen_masks:
            continue
        seen_masks.add(signature)
        window_fun = np.where(open_edges, fun, 0.0)
        subset = find_stretches(npz, window_fun, scores["excluded"].astype(bool), rubric)
        areas = cluster_areas(subset, rubric)
        for area in areas:
            area.idx += len(circuits) + 1000 * bit
        cost = np.where(open_edges, base_cost, np.inf)
        circuits.extend(build_variants(csr, areas, cost, npz, rubric))
        stretches.extend(subset)
        log.info("access %s: %d candidate circuits", label, len(circuits))
    unique = {tuple(c.edges): c for c in circuits}
    ranked = rank_circuits(list(unique.values()), npz, feats, scores, rubric)

    source_files = [
        graph_dir / "graph.npz",
        p.cache / f"features{suffix}.npz",
        p.cache / f"scores{suffix}.npz",
    ]
    source_time = max(path.stat().st_mtime for path in source_files)
    generated = datetime.fromtimestamp(source_time, timezone.utc).isoformat(timespec="seconds")
    sampler = Sampler(p.cache, offline=True)
    data = assemble(
        ranked, stretches, npz, side, feats, scores, rubric,
        sampler, generated,
    )
    data["sprints"] = mine_sprints(stretches, npz, side, feats, scores, rubric, sampler)
    dest = p.cache / "routes.json"
    tmp = dest.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    tmp.replace(dest)
    report = p.reports / "sprints.md"
    report_tmp = report.with_suffix(".md.tmp")
    report_tmp.write_text(sprint_report(data["sprints"]), encoding="utf-8")
    report_tmp.replace(report)
    log.info("routes written to %s: %d routes, %d areas (%.1fs)",
             dest, len(data["routes"]), len(data["areas"]), time.perf_counter() - t0)


if __name__ == "__main__":
    from .config import setup_logging

    setup_logging()
    run()
