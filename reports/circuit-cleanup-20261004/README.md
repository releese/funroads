# Shared circuit cleanup, 4 October 2026

## Plan and implemented scope

1. Clean generated circuits in the shared builder before ranking/statistics.
2. Cancel consecutive exact reverse physical edges. Remove a closed side
   excursion only when the existing geometric retrace measure reaches 80%.
3. Preserve real loops, the chosen start and its access stem. Reject a path
   that collapses to nothing. Do not touch sprints or linked rides.
4. Back up catalogues, reconstruct current graph paths, stage a circuit-only
   update, validate, replace locally and rebuild the frontend package.

Production change: `src/funroads/route.py`, `clean_circuit_spurs`, called by
`build_circuit`. About 40 added lines, no dependency or country exception.
Geometry uses existing `retrace_share`: 25 m proximity, opposing headings,
20 m probes and a 150 m along-route separation to exclude the turn itself.
Exact reversals do not need a geometric approximation. Genuine repeated-node
loops are not deleted merely for repeating a node. Whole-circuit geometric
removal and moving the start are deliberately excluded.

When cleanup changes a circuit, its out-and-back flag is recomputed from its
remaining geometry, not the removed legs. Unchanged circuits keep their
existing flag calculation. Full future pipeline runs use this before candidate
ranking. The local update below intentionally did not rerank.

## Actual local catalogue update

The existing Dutch source file already had a user edit (`meta.title = FunRoads`).
It is preserved. Current circuits were matched against exactly reconstructed
pre-cleanup lines. The Dutch line-downsampling rule and access-window costs
were preserved. Two Dutch area IDs share a start, so matching uses complete
paths, not an assumed one-to-one start-to-area mapping.

Only changed circuit objects were rebuilt using existing profile/statistic/
assembly helpers. All names, IDs, starts and ordering are preserved. Every
sprint object is unchanged. Linked files are byte-identical. Graph/features/
scores hashes are unchanged; no fetch, scoring, dependency install, source
manifest or raw-input edit. EE circuit edge evidence was updated, with all
sprint/linked evidence preserved. EE current quality hashes were updated;
candidate rejection counts are explicitly historical.

| Example | Before km | After km | Before min | After min | After retrace |
|---|---:|---:|---:|---:|---:|
| EE Viljandi → Rõngu | 72.2 | 71.8 | 60 | 60 | 0 |
| EE Võru → Kuigatsi → Tõrva Circuit 2 | 53.2 | 45.6 | 46 | 39 | 0 |

Two EE and five NL circuits changed. Counts remain 790 EE and 3,853 NL.
Full per-circuit results: `changes.json`.
Source/package hashes: `final-hashes.json`. Current route hashes:
- EE: `e9e299daf1e95d93d297f4ed85edf833be00a683aa22458e07ffee97d4223f19`
- NL: `a2786ca40209cfb9ac2896cbc30d4657e1c1b7ebe98fa29ccf68c5ded4c7fbcb`

## Validation

- Baseline focused routing/EE: 21 passed.
- Focused routing/EE/linked with initial cleanup tests: 41 passed.
- Full suite after real-path fixtures and again after catalogue updates:
  **119 passed, 3 skipped**. Existing unregistered network-marker warning.
- Frontend: **113 Vitest + 6 Node passed**, typecheck passed, production build
  and one build-integrity test passed. All four packaged catalogues match
  their respective inputs byte-for-byte.
- Exact and multi-edge reversals, separate carriageways, genuine loops,
  start access, invalid gaps, collapsed paths and idempotence are covered.
- Frozen, self-contained pre-cleanup paths from both real EE examples:
  `tests/fixtures/circuit-spurs.npz`, tested in `tests/test_route.py`.
- Browser: updated EE 71.8/45.6 and NL 74.8 km detail checks passed.
  Each exposes one whole-circuit Maps link, 9 intermediate points, <2048
  characters, same origin/destination. Evidence: `browser-checks.json`.
- Visual long-tail removal: `ee-long-cleaned.png`; details:
  `ee-long-details.png`. The selected route was captured after tiles loaded.
- Failed attempts were not counted: initial broad staging replay timed out
  after 300 s; limiting reconstruction to published areas revealed duplicate
  Dutch starts and was corrected to match full paths. Neither replaced
  catalogues. An incorrectly namespaced Dutch browser link timed out; the
  correct legacy link passed. No code/test failure remains.

## Backups and reproduction

`before/{nl,ee}/` contains original route/linked files and EE edge evidence;
`before/ee/quality.{json,md}` preserves prior reports. `baseline-hashes.json`
records graph/scoring/source catalogue hashes. `staged/` matches applied routes.

`rebuild.py` is a one-off local reproduction script, not a new product command.
It refuses changed baseline files and stages both countries before replacement.
It completed a staging pass and a separate `--publish` pass with identical
staged hashes. After applying it, baseline route hashes no longer match, so it
deliberately refuses another invocation against those files. Do not restore
backups over subsequent user work just to rerun it.

From the repository:
```powershell
$env:PYTHONPATH="$PWD\src"
.\.venv\Scripts\python.exe -m pytest -q
cd web
npm test
npm run typecheck
npm run build
```

## Limits and preview

This removes retracing side excursions, not every overlap. Some Dutch routes
retain shared access/carriageway sections (including two >40% whole-route
retrace examples); changing NL's overall circuit gate is a separate scope.
The fraction can rise slightly when a short spur is removed from a route
with much larger remaining overlap. No gates were relaxed.

The router remains node-based: retaining legal directed edges and connectivity
does not establish live turn permission or a safe turning place. This fix does
not guarantee Google Maps road fidelity. No new Android/iOS Maps trial or axe
audit was run; previous physical-device/contrast limits still apply.

Desktop-owned preview remains on port 5174, listener 22140 (verify ownership).
The corrected long circuit is open:
`http://127.0.0.1:5174/?country=ee&qa=circuit-cleanup-final-20261004#route=ee%3Acircuit%3Aarea-041-alt-1`.
Only that QA origin's service worker/cache was reset; favorites were untouched.
No commits, pushes, deploys or new dependencies.
