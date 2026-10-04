# Single-link Maps handover acceptance, 4 October 2026

## Outcome and changed requirement

Implemented locally for all 3,853 Netherlands and 790 Estonia routes.
The user explicitly rejected sections/splits after implementation started.
The final design therefore offers **one whole-route Navigate link**, not a
chooser or staged journey. This supersedes the original splitting proposal.
The full line cannot be transferred through Maps URLs: the request contains
the original endpoints and a bounded ordered selection of shaping points.
Exact road fidelity is not guaranteed or claimed.

No commits, pushes, deploys, external publication, dependencies, routing APIs,
keys, billing, scraping, pipeline changes or catalogue regeneration.
Existing modified/untracked work was preserved. The Dutch routes input was
already modified at the start; its supplied hash stayed unchanged.
Raw downloads, manifests, evidence exclusions and circuit gates were untouched.

## Implementation

- `web/src/data/gmaps.ts`: deterministic greedy selection prioritises metric
  chord deviation relative to 100 m and along-line distance relative to 5 km.
  These are selection targets, not fidelity guarantees. Straight intervals
  receive interpolated points on the actual polyline when distance wins.
- Closed lines start with a zero chord and explicitly receive a noncoincident
  shape point, preventing whole-loop collapse. Points carry increasing
  along-route distances; only adjacent exact duplicates are removed from the
  working copy. Nonadjacent coordinates are not globally deduplicated.
- Short routes stop adding points when targets are met. A single request has
  at most 9 intermediate points on desktop or 3 on compact layouts.
  Layout does not identify which Maps app will open.
- On budget-constrained routes only, selected bends of at least 45 degrees,
  measured over up to 100 m either side, request an approach point up to 500 m
  earlier along the line, bounded to one quarter of the preceding point gap.
  This is a geometry-only heuristic, not actual junction or safe-stop evidence.
  Well-represented short routes are not moved. No route-specific exception.
- Endpoints stay exact, open rides keep their direction and loops return to
  the start. Encoded URLs are checked against the documented 2,048 limit.
  No silent endpoint/coverage truncation or part splitting occurs.
- `RouteView.navigation` supplies both layout requests for every family in
  both countries, including circuits that previously preferred pipeline URLs.
  Source links remain unmodified in JSON. Route IDs/favorite keys are unchanged.
- `RouteDetail` keeps its existing fixed footer, direct link and focus/history
  patterns. A visible, accessible caveat states Google may treat points as
  stops, snap to other roads or reroute, and that shaping points are not driving
  instructions. Requests missing the geometry targets explicitly warn that
  point limits mean some route detail may not carry over.

The capped request cannot preserve every small detour, intersection visit or
5 km gap on a complex route. This is the explicit trade-off of the user's
no-splits requirement, not an unbounded-polyline export.

## Automated checks and self-review

- Initial Python baseline: **112 passed, 3 skipped**, unchanged opt-in
  network/slow skips and unregistered `network` warning.
- Initial pure staged helper: 11 synthetic checks passed. The initial chooser
  interaction run had 20 passes and one mobile Escape/focus failure.
  The user rejected that design. The chooser and stage builder were removed,
  not declared fixed or accepted.
- Final pure helper: **14 synthetic checks**, including straight/uneven lines,
  substantial detour, duplicate vertices, crossing/repeated coordinates,
  closed/tiny loops, very short/long lines, bounded approach placement,
  preserving well-represented short bends and explicit budget limitations.
- Final focused data checks: **71 passed**.
- Final full frontend: **113 Vitest and 6 Node tests passed**, no skips.
- `npm run typecheck`, `npm run build` and separate
  `node --test test/build.test.mjs`: passed.
- The build test verifies complete offline files and byte-identical packaged
  country pairs. `git diff --check`: passed.
- Non-failing Base Web defaultProps, PowerShell profile and Git line-ending
  notices remain. No new dependencies or abstractions were added.

Self-review checked endpoints/order, closure, URL/point limits, unchanged
source bytes and identities, preservation of existing country/name changes,
absence of chooser leftovers, direct-link accessibility and safety wording.

## Catalogue measurements

Reproduce with the local frontend-only script:
`reports/ee/measure-maps-handover-20261004.mjs`.
Full results, quantiles, histograms, eight example URLs and ordered points:
`maps-handover-measurements-20261004.json`.

Every route has one request per layout. Point counts include endpoints.

| Country/layout | Routes | Points p50 / p90 / max | Geometry targets unmet | Worst gap km | Worst chord deviation km | Max URL chars |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| NL desktop | 3,853 | 4 / 10 / 11 | 328 | 18.74 | 2.28 | 492 |
| NL compact | 3,853 | 4 / 5 / 5 | 1,091 | 49.31 | 8.57 | 252 |
| EE desktop | 790 | 4 / 10 / 11 | 52 | 14.00 | 1.37 | 464 |
| EE compact | 790 | 4 / 5 / 5 | 241 | 23.98 | 4.64 | 253 |

These are **local geometry/request measurements**, not differences measured
against Google's calculated road line. Long compact routes are especially
underconstrained. All eight recorded example families were checked locally:

- NL Noordzeeweg Circuit, 106.3 km; Veldjensweg Sprint, 1 km;
  Lekdijk (2 stretches) Loop, 34.2 km; long-name
  Oranjekanaal Noordzijde → Oranjekanaal Zuidzijde → Middenlinie Ride, 10.1 km.
- EE Viljandi → Rõngu Circuit, 72.2 km; Tohvri tee Sprint, 1.01 km;
  Tagavere → Vidruka → Oru → Tagavere Loop, 54.5 km; long-name
  Rõuge → Kurgjärve → Haanja → Rõuge → Rebäse → Haanja →
  Käätso → Rõuge → Luutsniku Ride, 40.6 km.

## Maps browser experiment

Official documentation fetched successfully on 4 October, last updated
28 September 2026:
https://developers.google.com/maps/documentation/urls/get-started .
It confirms 3 mobile-browser/9 other intermediate waypoints and 2,048 chars.
Some Maps products do not support waypoints.

The desktop-owned pane retained eleven total points for the original
nine-waypoint trial. Maps computed 74.4 km. The user identified an unwanted
hook near Kuigatsi. Moving only that waypoint about 588 m earlier on the
line produced 71.6 km; the user confirmed the unwanted hook was gone and
then visually compared the original FunRoads line, saying it seemed to match.
The source itself has a separate 192 m out-and-back spur in that interval;
no catalogue fix was made. See `acceptance-20261004-maps-test.md` for history.

The **final algorithm-generated desktop URL**, including its general
approach placement, retained all nine intermediate points and produced
**71.6 km, 56 min**. Its transformed Maps URL rounded interpolated coordinates
to seven decimals, so application-internal precision is not exact. The
catalogue says 72.2 km; haversine length of its line is 71.993 km.
These differing lengths and a visual match do not prove exact road fidelity.
Capture: `maps-final-link-desktop-20261004.png`.

No physical Maps-app/device test or automated road-by-road comparison.

## Local browser checks

Production preview on `127.0.0.1:5174`, using the desktop-owned pane.
In-page worker/cache resets preserved localStorage/favorites. A same-URL
reopen initially retained the old document and old asset hash, so one caveat
wait timed out. That attempt was not accepted. A fresh document URL with a
`qa` query then loaded `index-DGIp--mD.js`; all final checks used this build.
Do not confuse same-document navigation with replacing the open worker app.

- Eight examples at 1789×1288 and 375×640: **16 checks passed**.
  Exact generated href, one link, point/URL budgets, visible 44 px target,
  bounded fixed footer and no detail/page horizontal overflow.
  `maps-browser-layouts-20261004.json`.
- Long-name details at 320×568, 812×375 and 1789×1288:
  **3 additional checks passed**, positive scroll-body height, visible
  Navigate, keyboard focus and no visible em dash.
  `maps-browser-edge-layouts-20261004.json`.
- Mobile and desktop Escape closed details, preserved the selected linked
  ride and returned to preview/Browse focus. Automated interaction tests
  also retained the exact Browse scroll position.
- No external launch occurred automatically. Only the requested manual
  Maps trials opened externally; other hrefs were inspected locally.
- Scoped desktop accessibility: **0 violations, 0 incomplete**.
  Compact: **0 violations, 1 incomplete contrast check**, because axe could
  not determine the caveat's background in the overlapping modal context.
  The specified text is `#4b4b4b` on the footer's `#ffffff`.
  Files: `maps-a11y-{desktop,compact}-20261004.json`.
- UI captures: `maps-{desktop,compact}-{circuit,linked-open}-20261004.png`.
  Visually inspected compact captures retain readable long labels and footer.
  Desktop capture occurred before basemap/fit settled, so it demonstrates
  detail chrome only, not a clean full-map pixel baseline.

## Final SHA-256

Source and packaged counterparts are unchanged and equal:
`maps-final-hashes-20261004.json`.

| Source | SHA-256 |
| --- | --- |
| data/ee/cache/routes.json | 65c65c0178c13e60e15df3b2e2b6c86d9ba89d7a238fd5563b21dd7b6e60a845 |
| data/ee/cache/linked.json | e0615b3120ed750b44293cd10a0b11651526a353b71be930de0756b2f439a1b3 |
| data/cache/routes.json | 9ab4b6078ca74747c8141c211215744f6fd2704e37a4cb450e14aee3ff122963 |
| data/cache/linked.json | cf2a1c0a5ce25c54af4c3466718d173b95007265f8c38e5455d4ee21dfa345e2 |

## Reproduce and revisit

```powershell
Set-Location C:\Users\risto\funroads\web
npx vitest run src/data/gmaps.test.ts src/data/units.test.ts src/data/contract.test.ts src/data/estonia.test.ts src/components/App.test.tsx
npm run typecheck
npm test
npm run build
node --test test/build.test.mjs
node C:\Users\risto\funroads\reports\ee\measure-maps-handover-20261004.mjs
```

The QA-owned preview remains running for user inspection: launcher PID 12736,
listener PID 22140; confirm the process ancestry and command before stopping
it. The pane remains open at its restored 1789×1288 viewport.
For a new session, inspect port ownership, then start
`npm run preview -- --host 127.0.0.1 --port 5174 --strictPort` if needed.
Reset the local worker/caches in page context and open a fresh document URL.
Use `?country=ee#route=ee%3Acircuit%3Aarea-041-main&detail=1`.

Next priorities within navigation: physical Android/iOS waypoint retention,
actual missed roads on long compact requests, and more snapping examples
before changing approach placement. If exact route fidelity is mandatory,
revisit the handover format/provider rather than claim this URL can guarantee it.
No automatic progress, geolocation or safe-stopping claims were added.
Municipal evidence, loop yield, turn-aware routing, Teeregister redistribution
clarification and deployment remain outside this task.
