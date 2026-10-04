# FunRoads session handover: Estonia, now national

## Latest shared UI and publication scope, 4 October 2026

The shared NL/EE UI pass adds a small country control beneath FunRoads, outside
Browse, with an underline hover cue and a 44 px touch target. Native links
clear route context and preserve saved keys. Source/quiet/distance copy is
truthful per country. Partial-load failures can now be retried.
Validation: 119 Python passed/3 skipped; 126 Vitest + 6 Node passed;
typecheck/build/integrity passed. Country/family/browser acceptance and its
limits are in `reports/ee/ui-parity-20261004.md`.

The user explicitly authorized pushing all project sources, tests,
documentation, evidence and both country catalogue pairs to main, including
its Pages deployment. Raw downloads, generated graph caches, dependencies and
build output remain excluded. This does not resolve the Teeregister rights
caveat. Older “no push authorized” statements below describe earlier rounds.
Linked-routing investigation remains deferred; this UI pass changes no data.

Release push completed; GitHub main was verified at `9539d4f`. Pages workflow
completion is not verified. The next approved country-default/checkpoint
increment is implemented, validated and authorized for publication to main:
138 Vitest + 6 Node passed, typecheck/build/integrity passed. Country choices
are remembered, a first-visit Tallinn timezone hints EE, and new shared route
links include their country. Legacy-link fallback was dropped at the user's
request. Maps checkpoints balance constrained routes from both ends inward,
with geometry-based bends, not invented junctions. See
`reports/navigation-defaults-20261004.md` for measurements and remaining limits.

State as of 2026-10-04. Three rounds are complete:
(1) Teeregister evidence integration + circuit-shape gate on the southern
pilot; (2) **full-country coverage**, user-approved, replacing the pilot;
(3) a measured yield analysis explaining Estonia's route count vs the
Netherlands (below). Authoritative validation: `reports/ee/validation.md`;
measured data report: `reports/ee/quality.md`.

## Current published Estonia catalogue (national)

- **790 routes: 5 circuits, 701 sprints, 74 linked open rides, 10 linked
  loops.** Circuits: Viljandi — Rõngu 71.8 km, Võru — Kuigatsi — Tõrva 45.6 km,
  Paunküla — Vetla 50.1 km, Tartu — Jõgeva — Aravete 45.9 km, Sihva — Vidrike —
  Kärgula — Järvere 30.5 km; retrace 0.0–0.181, all genuine.
- 14,259.1 km eligible network; 52,604 nodes; 87,967 directed edges; terrain
  coverage 100%; 0 unknown speed/surface on retained edges.
- Current catalogue hashes after circuit cleanup: EE routes
  `e9e299da…4223f19`, NL routes `a2786ca4…4c7fbcb`.
  Linked unchanged: EE `e0615b31…f439a1b3`, NL `cf2a1c0a…345e2`.
  Original catalogues are backed up under
  `reports/circuit-cleanup-20261004/before/`.
- All gates standard: 25 km circuit soft minimum (pilot's 10 km concession
  removed), retrace gate <= 0.20 (original generation rejected 110 of 116
  closed candidates; the circuit-only cleanup did not rerank that batch).

## Why ~790 routes vs the Netherlands' ~3,853 (yield analysis, 2026-10-04)

Measured from both graphs/scores (`reports/ee/yield-analysis.json`), comparing
each country's **eligible network** (roads that survive ingest + score-time
exclusions and can actually join routes): Estonia 12,376 km, Netherlands
67,740 km.

**Headline: per eligible kilometre, Estonia yields slightly MORE routes than
the Netherlands. The totals differ because the eligible network is 5.5x
smaller, not because the pipeline or the roads underperform.**

| Metric (eligible base) | Estonia | Netherlands |
|---|---:|---:|
| Eligible network km | 12,376 | 67,740 |
| Routes total | 790 | 3,853 |
| Routes per 1,000 eligible km | **63.8** | 56.9 |
| Sprints per 1,000 eligible km | **56.6** | 49.5 |
| Linked rides per 1,000 eligible km | 6.8 | 7.2 |
| Fun >= 0.55 (stretch-eligible) share | **22.3%** | 19.3% |
| Fun score p50 | **0.424** | 0.395 |

Why the eligible base differs 5.5x:

1. **Estonia simply has far less paved road.** External context (Wikipedia/
   Transpordiamet figures, approximate): ~57,565 km total public roads of
   which ~12,926 km paved; national roads 16,465 km. The pipeline's 14,259 km
   retained network already covers essentially the country's entire paved
   public network — there is no large paved reserve being wrongly dropped.
   The Dutch graph alone holds 134,450 km of drivable road (similar land
   area, ~15x the population density).
2. **Evidence gates honestly exclude the rest of Estonia's network.** Of the
   ~32,070 candidate road-km reaching span evaluation, 55% is dropped:
   register-confirmed gravel/earth 8,424 km, unknown speed 5,502 km, unknown
   surface 3,709 km (overlapping sets per first failing gate), plus way-level
   exclusions. Teeregister covers state roads; municipal local roads have no
   official surface/speed source, so OSM silence stays excluded. The
   Netherlands has official WKD speeds for ~everything and CBS/NDW inputs, so
   its ingest drops little; it instead excludes 49.6% of its graph km at
   score time (urban/calmed/30 kmh mass). EE pre-filters at ingest (13.2%
   score-time exclusion), NL at score — the eligible bases above are measured
   after both, so the comparison is fair.
3. **Topology and fragmentation cap circuits and loops.** EE: 2,934 weak
   components, largest only 7,056 nodes (13.4% — islands are cut off because
   ferries are excluded, and gravel exclusion severs rural links). NL: 1,479
   components with 99.2% of nodes in one. Estonia's paved rural network is
   dendritic (forest/farm dead-ends): 110 of 116 closed circuit candidates
   were out-and-backs. NL's dike/polder lattice closes loops naturally. This
   shows in the mix: linked loops 10 vs 186, linked-open 74 vs 304, circuits
   5 vs 12 — but note NL circuits are a design cap (`top_routes: 12`), while
   EE's 5 is the honest uncapped count, so circuit counts are not a like-for-
   like comparison either way.

Road character (km-weighted dimension means over eligible edges): EE wins
elevation 0.387 vs 0.196 (real relief), surface 0.997 vs 0.818 (all proven
paved; NL includes brick and default-0.6 unknowns), scenery 0.598 vs 0.553,
quiet 0.664 vs 0.628 (caveat: EE quiet is an OSM proxy without CBS/NDW-grade
traffic/population inputs, so this may flatter EE). NL wins corners 0.139 vs
0.071 — curviness 75.9 vs 28.4 degrees/km, engaged corners 0.47 vs 0.20 per
km (dike bends vs straight forest corridors) — and, on eligible roads only,
speed 0.804 vs 0.765 (NL's eligible mass sits at the 60–80 kmh anchors that
score 0.9–1.0; 71% of EE eligible km is 90 kmh, which the rubric scores
~0.825 by design: flow over top speed).

What would honestly raise the Estonian yield: OSM surface/speed mapping
progress on municipal local roads (or a municipal data source) — most of the
9,211 unknown-evidence km is there. What would NOT be honest: relaxing the
evidence gates or fun thresholds to inflate counts. The circuit/loop scarcity
is real topology, not a code defect.

## What national coverage changed in code (round 2)

- `estonia.py`: `BBOX` is the national poly bounds `(20.85, 57.49, 28.22,
  60.0)`; `PILOT` renamed to `COVERAGE = "Estonia"`; `interior_boundary()` is
  the extraction polygon +1 m (no 5 km inland buffer); terrain is fetched as
  **221 grid-aligned 20 km WCS tiles** into `data/ee/raw/dtm-tiles/` (400 =
  outside DTM extent, recorded absent); `TerrainSampler` is a tiled LRU
  reusing `elevation.decode_geotiff`/`_sample_tile`; drop reasons renamed
  (`outside_country_bounds`, `outside_extraction_boundary`); cache file is
  `estonia.osm.pbf`.
- `fetch.py`: `_fetch` retries transient 5xx/connection/timeout failures
  (1/3/9 s backoff, then raises); success path byte-identical. A real 502
  proxy error occurred mid-run and is now survived.
- `config.py`: Estonia rubric override removed (standard 25 km circuit gate).
- `web/countries.json`: ee bounds national, `coverage` field removed (UI now
  shows "National circuits" / "nationally" wording).
- Tests updated: `tests/test_estonia.py` (tiled terrain test, national
  coordinates), `web/src/data/estonia.test.ts` (national wording asserted).

## Teeregister integration (round 1, still in force)

`src/funroads/teeregister.py`: native-EPSG:3301 WFS paging with 2-record
overlap + OID dedupe (MapServer drops boundary records otherwise); explicit
surface codes win over the contradictory INSPIRE category; base `kpp`/`kpv`
speeds only. Geometry matching: 12 m, >= 90% coverage, >= 95% endpoint
alignment, ref agreement, ambiguity rejection; OSM tags stay primary.
National yield: speed recovered on 13,834 directed edges (4,661 ways), surface
on 2,779 edges (936 ways); register-confirmed gravel excluded (8,423.7 km).
Rights caveat kept in the manifest (`AccessConstraints=private` vs
no-conditions catalogue metadata); used locally at the owner's request.

## Validation (all green)

- Python 112 passed / 3 skipped (opt-in network/slow tests); estonia 9/9.
- Frontend 95 Vitest (incl. live national catalogue) + 6 Node; typecheck;
  production build + package integrity.
- Browser (after in-page service-worker/cache reset): 790 routes load;
  circuit details show real Tallinn/Tartu distances; no out-and-back warnings;
  attribution present; NL unchanged at 3,853. Pixel screenshots not done
  (harness timeouts).

## Remaining limits / next ideas

Ferries excluded → islands are separate components with straight-line home
distances. 3,709 km unknown-surface and 5,502 km unknown-speed segments still
dropped after register matching. 2,934 weak components; largest 7,056 nodes.
ETAK vectors, population/AKS-KNR, DATEX unused. Node-only router; via-way
turns unmodelled (63 ways excluded). Width missing on 87k of 88k edges. See
`reports/ee/validation.md` for the full list.

## Constraints that still apply

No commits/pushes/deploys. Git-ignored `data/`, `reports/`, pipeline stay
local (~803 MB of ee raw inputs — preserve for reproduction).
`PYTHONPATH=$PWD\src` + `.\.venv\Scripts\python.exe` for Python. No new
dependencies were added. No invented surfaces/speeds; unknown stays excluded;
confirmed gravel stays out. Full national run: ~12 minutes.

## Close-out follow-up, 2026-10-04

- All EE/NL source catalogue hashes still match the values above; packaged
  `site/data/{ee,nl}/` files are byte-identical to their inputs.
- Python rechecked: 112 passed / 3 skipped. Frontend: 97 Vitest + 6 Node,
  typecheck and build/package integrity passed.
- User-requested UI rule: no em dashes. Place-name separators normalize to
  small arrows in the shared display model, including search and stale saved
  names; raw data, route IDs and favorite keys do not change.
- Local browser close-out evidence:
  `reports/ee/acceptance-20261004.md` and its screenshot/measurement directory.
  Eight detail viewport checks passed. Mobile captures are usable; wide-pane
  duplication remains a capture limitation, not a clean desktop pixel baseline.
  The QA preview server was stopped; the desktop-owned browser pane stayed open.
- User-requested NL/EE Maps handover plan:
  `reports/ee/google-maps-handover-plan.md`. Shape/length-aware points and
  waypoint-budgeted stages are proposed, not implemented.
- Teeregister redistribution clarification and physical-device acceptance
  remain outstanding. No commits, pushes, deploys, dependencies, pipeline
  changes or catalogue regeneration.

## Navigation work in progress, 4 October 2026

The user subsequently rejected route sections/splits and asked to inspect
a single whole-route Maps trial. Work is paused for that inspection, not
complete. See `reports/ee/acceptance-20261004-maps-test.md` and
`reports/ee/maps-nine-waypoint-test-20261004.json`.
The desktop trial retained all nine requested intermediate destinations for
Viljandi → Rõngu, but Maps computed 74.4 km versus the catalogue's 72.2 km.
Road fidelity remains unaccepted. The local unfinished chooser has one
unresolved mobile Escape/focus regression and must not be deployed.

## Navigation close-out, 4 October 2026

This supersedes the work-in-progress status above. The user rejected split
routes. Both countries/all families now use one shape/length-aware whole-route
Maps URL, at most 9 desktop or 3 compact intermediate points. The rejected
chooser/stage builder were removed, not shipped. Endpoints, route/favorite
keys and catalogue bytes stay unchanged; pipeline-provided circuit links
no longer bypass the shared frontend handover.

Budget-constrained sharp-bend points use bounded approach placement, not a
route-specific exception. The final Viljandi link retains nine intermediate
points and Maps computes 71.6 km. The user confirmed hook removal in the
adjusted trial and visually compared it with the original app line.
Exact road fidelity is not guaranteed. The visible footer caveat warns about
point limits, stops, snapping and rerouting; long compact routes remain
underconstrained.

Final: 113 Vitest + 6 Node passed, typecheck/build/separate package integrity
passed, Python baseline 112 passed/3 skipped. All four hashes and their
packaged pairs match. Nineteen detail layout checks passed; scoped desktop
axe has no violations/incompletes, compact no violations/one incomplete
contrast check. Physical-device Maps retention remains untested.

Authoritative new evidence:
`reports/ee/acceptance-20261004-maps-handover.md`.
Local measurement/reproduction script and full point-count histograms are
linked there. Existing 20261004 acceptance history is preserved. Preview
remains running for inspection (launcher 12736, listener 22140, verify
ownership before stopping); the desktop pane stays open.
No commits, pushes, deploys, dependencies, pipeline/data regeneration,
raw-input/manifest changes or evidence-gate changes.

## Circuit-spur cleanup, 4 October 2026

The user subsequently approved a shared pipeline fix and local catalogue
updates. This supersedes the earlier no-pipeline/no-regeneration scope.
`route.clean_circuit_spurs` runs inside the common circuit builder before
ranking/statistics: exact reverse pairs cancel; a repeated-node side
excursion is removed only at >=80% geometric retracing using the existing
25 m/opposing-heading measure. Real loops and start access are preserved;
collapsed exact out-and-backs are rejected. Sprints/linked rides are untouched.

The bounded update rebuilt only existing published circuits, without
reranking or changing IDs, names, starts, counts, or favorites keys. Two EE
circuits and five NL circuits changed. Viljandi → Rõngu is 71.8 km/60 min;
Võru → Kuigatsi → Tõrva Circuit 2 is 45.6 km/39 min, with the entire pictured
tail removed. Both now have retrace 0. Current EE count remains 790, NL 3,853.
All graph/features/scores/rubric/manifest/raw inputs remain unchanged, as do
the two linked files and every sprint record. Current `site/` packages match.

Validation: 119 Python passed/3 skipped; 113 Vitest + 6 Node passed;
typecheck/build/package integrity passed. Three browser distance/navigation
checks passed across both countries, plus visual verification of the long
tail removal. No new physical-device Maps trial or new axe audit.
Prior full-generation candidate statistics are historical, not recalculated.
Some Dutch overlap remains outside the local side-excursion rule.

Reproduction, backups, original graph-path fixtures, limitations and hashes:
`reports/circuit-cleanup-20261004/README.md`.
The corrected long circuit remains open in the desktop-owned preview pane
on port 5174 (listener 22140, verify ownership before stopping).
No commits, pushes, deploys or new dependencies.

## Handover stop point and next priorities, 4 October 2026

The user paused the proposed linked-ride investigation and requested handover
work instead. Only linked code was inspected; no new linked measurements,
code changes, regeneration or data edits occurred. Both linked files and all
sprints remain as they were before circuit cleanup. Linked loops already block
immediate return U-turns and use alternative searches and a <=20% geometric
retrace gate. A future cleanup must preserve anchor stretches/order and, for
open rides, both endpoints.

Recommended next work, not yet authorized:
1. Audit NL's two remaining >40% retrace circuits (`area-12113-main`,
   `area-12090-main`) before considering policy parity with EE's <=20% gate.
   Identify shared start access versus avoidable detours; do not blindly prune
   more, relocate starts or change thresholds.
2. Verify whole-route Maps handover on physical Android/iOS devices, including
   compact-budget long routes and return-to-app selection.
3. If a release is requested, review local/ignored pipeline and regression
   artifacts and resolve Teeregister redistribution rights before publishing.

Linked-tail auditing is deferred, not an unfinished implementation. The latest
resume checklist is at the top of `HANDOVER.md`; cleanup acceptance and backups
remain in `reports/circuit-cleanup-20261004/README.md`. No further code or
catalogue work was performed for this handover update.
