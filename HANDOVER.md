# FunRoads handover, 2026-10-04

## Start here: current state and next work

### Nine-point mobile Maps links and refresh/open PWA updates

Current release changes:

- Mobile and desktop request the same whole-route Google Maps URL with up to
  nine intermediate points. Mobile copy warns that the browser may retain only
  three; native Maps waypoint retention still requires real-device testing.
- Updates are checked on page load/refresh, reopening a standalone PWA, return
  from the back-forward cache, or the manual **Check for updates** button inside
  Map information → App and data. There is no interval polling, reconnect check,
  ordinary-tab foreground check, or unsolicited mid-session reload.
- Updates initiated by an open/check install their entire integrity-checked
  offline release before explicit activation and one reload. Other already-open
  tabs keep their current UI until their next open/refresh/check. Incomplete
  installs preserve the current release; offline opens use its cached data.
- Production catalogue filenames contain their SHA-256 digest. The compiled
  app uses those immutable URLs and integrity checks even before worker control.
  App and worker share a content-derived build identifier; unchanged rebuilds
  keep the same worker/cache version. Installation reuses already-verified
  unchanged immutable catalogues, fonts and assets, avoiding route-data downloads
  for UI-only releases. Old immutable files remain available to older tabs.
  Cache cleanup never removes another app's cache or a pending/newer release.
- Tab-local sessionStorage restores home, ranking, search/filters, favorites-only,
  collection, result pagination, Browse state and scroll positions on update or
  refresh. Route/detail context stays in the URL; saved favorites/country retain
  their existing localStorage keys. Blocked storage falls back to safe defaults.
- Existing installations running the earlier code may need a one-time close of
  every old tab/app window and reopen to acquire this update behavior. Offline,
  failed-download and OS-suspended clients cannot be guaranteed current at deploy
  time. No service-worker-free browser auto-update mechanism is claimed.

This supersedes the earlier three-point compact budget and close-all-only update
behavior documented below.

Validation: all 169 Vitest tests and 13 Node catalogue/worker checks passed.
Typecheck, production packaging/integrity checks and two consecutive identical
builds passed; unchanged builds produced byte-identical service workers.
Local Chromium checks confirmed nine requested points on desktop and a 390 px
mobile client, the mobile caveat, and the update notice/action inside App and data.
A newly opened same-origin iframe client updated while its older parent retained
its release and state. Explicit update restored Haarlem, Scenic and 240 px Browse
scroll; the final release cleaned retired caches. A native unchanged-worker check
left the page loaded, created no installer/waiting worker and added no catalogue
requests. Separate desktop tabs were blocked by the embedded browser's target
policy, so the dual-client check used an iframe, not a claimed two-tab/device test.
Physical Android/iOS Maps handoff and deployed GitHub Pages updates remain untested.
Existing Base Web React defaultProps warnings remain.
Pre-publication review found and fixed an installation/standalone-mode mix-up:
installing from a normal tab must not enable foreground update checks in that
tab. A regression test keeps ordinary tabs unchanged after `appinstalled`.

### Latest shared design-comment audit

The following comments are implemented in the shared NL/EE UI:

- Country selector beneath FunRoads, flush text alignment, transparent 44 px
  target and underline interaction cue (published).
- Score-first icon metadata in Browse cards, previews, overlap choosers and
  similar-route cards; expanded details now use fun, length, time, distance.
  Sprint scores remain explicitly road averages.
- Overlap chooser cards use separate type, name and metadata rows in Browse
  order, with matching 16 px title text, white fill and 16 px corners.
- No visible `direct` suffix; accessible labels still explain straight-line
  distance. Browse cards omit both `Legal turnaround required` and
  `Ends elsewhere`, while retaining traits. Shape and safety guidance remain
  in details; meaningful shape filter choices remain.
- Browse scrollbar inset by 2 px without changing the 16 px text alignment.
- Ranking choices apply without dismissing the popup. Close, Escape and
  outside interaction still dismiss it.
- `Why this route` contains route character, not country-wide source caveats.
- Practical measurements are in `Route facts`; attribution, links, coverage
  and source caveats are in the separate collapsed `Data sources and limitations`.
- Road composition uses the same card component as similar routes, with
  score and length icons. Roads with a matching geometrically shared sprint
  open a compact map preview. Same-name roads elsewhere are rejected.
  Roads without a matching standalone sprint are disabled and grayed out,
  with readable gray text and a soft-gray background, not fake links.
  Road matches reuse existing circuit overlap data and stay memoized while
  the selected route/catalogue is unchanged; linked routes use the same
  overlap primitive without repeating map-color assignment.

Validation: 145 Vitest tests, 6 Node checks, typecheck, production build and
build-integrity check passed. Country-parity regressions cover all four Browse
families, both layouts, detail ordering, hidden source notes and road previews.
Live EE mobile (390×844) and NL desktop (1789×1288) checks also confirmed the
detail ordering, collapsed source disclosure and matching 16 px road cards.
All three roads in the reported EE circuit were clickable; the first opened
its matching sprint in compact preview. The NL check kept an unmatched road
noninteractive instead of choosing a same-name sprint elsewhere.

The mobile overlap chooser now fills the available width with equal 12 px
outside margins. Its conflicting MapLibre width cap is removed; the separate
desktop sizing/control gutter is retained. Browser layout probes measured
296/366 px widths with equal 12 px margins at 320/390 px, and unchanged
286.72/420 px widths with a 72 px right gutter at 1024/1789 px.
Chooser interaction tests and the
typecheck/build/integrity check passed.

Earlier browser hover/favorites/contrast limitations and physical-phone Maps
retention checks are not resolved by these UI changes. Catalogues are unchanged.

The circuit cleanup and shared country UI pass are complete for both countries.
The latest approved scope also includes publishing all project sources,
tests, documentation, acceptance evidence and both country catalogue pairs
to main, including its automatic GitHub Pages deployment. Downloaded raw data,
generated graphs, environments, dependencies and build output stay local.
The complete release was pushed as five scanned commits; GitHub main was
verified at `9539d4f`. Pages workflow completion has not been verified.
The Teeregister redistribution caveat remains documented, not legally resolved.
Two EE and five NL circuits changed; IDs, names, starts, favorites keys and
counts stayed unchanged. NL has 3,853 routes; EE has 790. Sprints and linked
rides remain unchanged. Whole-route Google Maps navigation is implemented
with 9 desktop/3 compact intermediate-point budgets and a visible caveat.

Authoritative cleanup evidence, source/package hashes, backups and commands:
`reports/circuit-cleanup-20261004/README.md`. Estonia current status:
`EE-TEEREGISTER-HANDOVER.md`. Earlier sections retain historical results.
Latest checks: 119 Python passed/3 skipped; 138 Vitest + 6 Node passed;
typecheck/build/package integrity passed. Both countries' circuit, sprint,
linked-open and linked-loop details passed 24 browser layout/link checks at
1789×1288, 1024×768 and 390×844. Both country menus fit at 320×740.
Country switching and browser Back preserved the saved-route set in a focused
check; an earlier long-run fingerprint discrepancy remains unexplained.
See `reports/ee/ui-parity-20261004.md` for scope and limits.

The country control is outside Browse, beneath FunRoads. Its smaller label and
chevron use an underline hover cue, flush text alignment and a 44 px touch target.
Country links preserve deployment paths and query parameters, clear route
context, and leave favorites intact. About copy now distinguishes EE's static
OSM quiet proxy from NL's traffic inputs and reflects actual direct-distance
availability. Partial catalogue failures now offer Retry route data.

The next increment was published at `60ca0d9`:
remember the chosen country and use a first-visit timezone hint
(`Europe/Tallinn` → EE, `Europe/Amsterdam` → NL, otherwise the NL default).
Explicit country URLs win. No geolocation prompt or IP lookup service.
The user dropped legacy-link requirements; new route selections write an
explicit country query parameter. Constrained Maps requests now reserve
end-to-end distance regions and refine bend candidates from both ends inward.
The user authorized this publication to main for phone testing. Measurements,
validation and shape trade-offs: `reports/navigation-defaults-20261004.md`.

**Linked follow-up is deferred by the user.** Only code inspection began;
no new linked measurement, implementation or catalogue update occurred.
Existing linked safeguards remain: immediate-return U-turn blocking,
alternative connector/return searches and a 20% geometric retrace limit.
Do not apply circuit pruning blindly to linked rides: their intended anchors,
anchor order and open-route endpoints must survive any future change.

### Suggested next priorities, not authorization to start

1. **Audit the remaining Dutch circuit overlap.** Start with
   `area-12113-main` (~42.5% measured retrace) and `area-12090-main` (~43.8%).
   Distinguish unavoidable start-access/carriageway sections from avoidable
   excursions, and compare feasible alternatives from the cached graph.
   Explain the difference between NL's current circuit policy and EE's
   <=20% whole-circuit shape gate before proposing a policy change.
   Do not just prune more geometry, change the start or tighten thresholds.
   Success is a measured diagnosis and a small recommendation, not inflated
   route counts or silently deleting useful routes.
2. **Validate Maps on actual phones.** Try Android and iOS, using a short loop
   and a longer underconstrained route. Check retained stops, route shape,
   unexpected U-turns and return-to-app selection. Desktop/browser checks
   do not establish Maps-app fidelity; a URL cannot guarantee exact roads.
3. **Verify the authorized release.** The user explicitly selected main plus
   Estonia Pages deployment and all project changes. Verify the remote commit
   and Pages workflow after pushing. Preserve the outstanding Teeregister
   rights caveat; authorization to release does not establish a licence.

Linked-tail measurements are a lower-priority, deferred follow-up. If resumed,
measure existing open rides and loops in both countries first and protect all
intended high-fun anchors and endpoints. Add a fix only for verified cases.

The shared UI is available in the desktop-owned QA preview on port 5174.
Listener 22140 was verified during cleanup; recheck ownership
before stopping it. Do not close the desktop pane or clear favorites.
The one-off circuit rebuild script now refuses its old baseline hashes:
do not restore backups over newer work merely to rerun it.

## What exists

The pinned Netherlands pipeline is `fetch → graph → features → score → route →
linked`. The scoring weights in `config/fun.yaml` are the original weights; the
failed retune was reverted. `route` writes national circuits and reversible
sprints to `data/cache/routes.json`; `linked` writes short open rides and loops
to `data/cache/linked.json`. Both write atomically. The old outputs before
bridging are in `data/cache/before-bridging/`; the immediately preceding
catalogues are in `data/cache/before-quality/`.

The 2026-09-28 route regeneration has 12 national circuits in 10 areas and
3,351 sprints. The 2026-10-03 linked regeneration (retrace rule, below) has
490 linked rides (304 open, 186 loops); 39 chain three stretches, the rest
two. Against the previous 523 it kept 438, added 52 and removed 85. No linked
ride exceeds 20% low-fun connector road or 20% retrace, and all average at
least 0.45 fun. The 523-ride catalogue is backed up with `routes.json` in
`data/cache/before-retrace-20261003/`. The 479-ride catalogue before that is
in `data/cache/before-linked-quality-20260928/`. The older
catalogues had 3,796 sprints and 1,027 linked rides (277 open, 750 loops).
All five named sprint anchors
(Duinlustweg, Brikweg, Autoweg, Camerig, Langevelderslag) remain. Kleine
Tocht (fun 0.42) is gone; Buikslotermeerdijk (fun 0.697) remains.

`web/` is a working React/TypeScript browser with Base Web, MapLibre and uPlot.
It offers national/nearby discovery, road and circuit-area search, filters,
route details, sampled access windows, map/list selection, favorites in
localStorage, and line-derived Google Maps links. No GPX/KML export files,
address search, live traffic/access, or town gazetteer exist. Circuit areas
do not form a national place index, and the nearby radius is straight-line,
not driving distance. Original national circuits lack a comparable nearby
distance. Some elevation samples are missing from the offline AHN cache, so
charts must be conditional.

## Quality rules

- Sprints require both directions to be legal in a shared sampled window and
  the return to be fun where the outbound road is fun. Bridged edges may be
  below the 0.55 edge threshold, but the length-weighted outbound average
  must be at least 0.55 and below-threshold road at most 25% of length.
  `reports/probe_bridges.py` measures this before changing thresholds.
- Linked open rides join two or three distinct stretches that each pass the
  sprint average and bridge-share quality gates in the direction driven.
  Reversibility is not required for a linked anchor. Loops close only rides
  that already chain multiple stretches, never one isolated sprint. If the
  cheapest connector retraces an anchor or fails ride quality, a second bounded
  search avoids the anchored physical roads. Loop returns also get a bounded
  non-retracing fallback. Both open rides and loops require a whole-ride fun
  average of at least 0.45 and at most 20% distance on edges below fun 0.35
  or excluded. National circuits retain their separate 45% connector limit.
  These are different metrics: sprint bridge share uses the 0.55 threshold;
  linked low-fun road share uses 0.35. Excluded edges still count against that
  share when used as connectors; do not silently turn this into an outright
  exclusion without checking named loops such as Zeeweg.
- Retrace is measured geometrically (`route.retrace_share`): the share of a
  ride's length that runs within 25 m of an earlier part of the same ride in
  the opposite heading. This catches dual carriageways, where the two
  directions are separate graph segments and the segment-ID checks saw no
  overlap. Connectors, loop returns and whole rides are rejected above
  `routing.linked_retrace_share_max` (0.20); the output carries
  `retrace_share`. On the old catalogue, out-and-back rides measured 0.53 to
  0.92 and genuine loops at most about 0.20. Deduplication also uses a
  geometric containment check, so a ride on the other carriageway of a
  kept ride is dropped.
- Loop returns first block the reverse of the last chain edge (no U-turn
  start). The fallback return blocks the anchored roads and, if that fails,
  penalises them by `connectors.linked_loop_reuse_penalty` (15.0). The
  low-fun cutoff is `routing.linked_low_fun_below` (0.35). Both were
  previously hard-coded.
- Linked rides are named after their anchors in driving order
  ("Zeeweg → Duinlustweg Ride"); a repeated anchor reads
  "Lekdijk (2 stretches) Loop". `anchor_roads` names the mined high-fun
  stretches in driving order; `roads` remains the top three road names by
  fun-kilometres across the whole ride, which can also include connector or
  return roads. Search and the road filter use both.
- Sprints and linked rides now emit reasons, climb, corner counts/pins,
  warnings, curvature and, where offline AHN is cached, elevation. Sprints
  also emit a modeled drive duration (not reach time). The UI
  shows these only when present. Map selection suppresses the crowded
  overview and shows the selected route (plus overlapping circuit context).
  The result-card star uses a 44 px soft pill at the card's padding inset.
- Map pins are not verified driving instructions. Start/end mark route
  endpoints; L/R pins are engaged corners; letter pins flag sampled warnings.
  A sprint end is not a verified turning place. Google Maps may reroute
  between exported points; check the on-page line and current signs.
  Warning pins read Cam, Bump and Bike. When several routes overlap at a
  map click, a chooser lists them instead of picking the first hit.
- Google Maps links space waypoints evenly by distance along the line, 8
  per link. Google documents only 3 waypoints for mobile browsers, but the
  Maps app may accept more. Navigate uses the full link; the extra phone
  fallback action was removed with the navigation-options disclosure.
  Whether Android and iOS apps keep all 8 points remains unconfirmed on a device.
- Quietness is a static model. New outputs say "Modelled as usually quiet
  (static estimate, not live traffic)"; the UI relabels the older wording
  still in `routes.json` until `route` is rerun. Access windows are sample
  dates, and the header date is the road data snapshot, not a build date.

## Run and verify

```powershell
cd C:\Users\risto\funroads
$env:PYTHONPATH='src'
.\.venv\Scripts\python.exe -m funroads.cli route
.\.venv\Scripts\python.exe -m funroads.cli linked
.\.venv\Scripts\python.exe -m pytest -q

cd web
$env:Path = "$env:USERPROFILE\scoop\apps\nodejs-lts\current;$env:Path"
npx tsc --noEmit
npx vitest run
npm run build
npm run dev -- --port 5173
```

Do not browse midway through regeneration: the two catalogue files update
separately. Do not edit pipeline code during a running regeneration. Before
another scoring change, replay the exact weights with `reports/probe_weights.py`
and verify its error is near zero, then compare anchor roads (Duinlustweg,
Brikweg, Autoweg, Camerig, Langevelderslag) before running the national
pipeline. Before another mining change, compare bridge share, quality bands,
urban examples, and linked connector share. The contract test asserts
invariants and anchor roads rather than brittle content-hash IDs.

`PLAN.md` and `design-plan.md` contain historical "UI deferred" text that
predates the now-working frontend. `DESIGN.md` is the visual guidance; its
proprietary font names are not a license to ship those fonts. Local favorites
are currently keyed by content-hash route IDs and may disappear after a
regeneration; a stable identity needs a separate migration design. The app
now stores saved route names (`funroads:favorites:names:v1`) and lists
favorites that no longer exist, with a "Remove from saved" action.

## Outstanding

### Current responsive UI and PWA implementation

The approved responsive implementation supersedes the historical UI notes below.
No data pipeline or catalogue regeneration was performed for this UI work.

- Phones have a floating text title and a two-state floating browse bar. Search,
  route types, sort and filters open with results; there is no second expansion
  step. Map taps/drags collapse results. Selected-route previews separate the
  name/stats from their actions.
- Desktop discovery uses a bottom-left floating Browse panel matching phone
  chrome, with 26.25 em width/52 em height capped by the available viewport.
  It stays open during desktop selection, panning and map-information use.
  The white top bar, subtitle and Hide/Show list button are removed.
  Every result selection stays in preview until Details is explicitly requested.
  Desktop previews and overlap choosers share a raised bottom-right position;
  there is no redundant Fit route action. Selection measures the Browse panel
  as left padding, not bottom padding, so routes do not get pushed upward.
  Details float over the map in a vertically centered rounded
  320–420 px panel capped at 900 px height; the control lane remains clear.
  Below 1320 px Browse hides while details are open, preserving its state.
  Mobile details use a
  12 px inset rounded modal card and make background content inert.
  Close preserves selection and
  discovery context; blank-map taps deselect without confusing drags with taps.
- Information, zoom in and zoom out form a subtle top-right stack with 44 px
  targets. Information combines the legend, live MapLibre attribution links,
  and optional app/data information in a Base Web popover.
- Overlapping routes use a bounded, scrollable chooser with type/distance/time
  metadata. Hit tolerance is 22 px on narrow/coarse-pointer screens and 10 px
  otherwise. A real-data chooser was verified through a synthetic MapLibre
  click and browser selection at 1920×1080; do not equate that with physical
  touch/device acceptance.
- Buttons use 8 px rounding, except intentional circular map/favorite controls
  and 16 px cards/bars. Native controls have hover/pressed/focus states. Result
  titles are 16/22 px with compact icon metadata. Filters use grouped choices,
  a "Limit distance" toggle, minimum fun-score threshold and optional advanced
  controls. Route/More tabs replace an expanding stack; Reset/Done stay visible.
  Favorites only moved into Filters. Sampled-departure filtering was removed.
  Home/ranking/Filters form one compact setup row. Result count precedes the
  independent circuit/linked/sprint toggles. Home choices omit "From".
  Driving-style icons differ from the score gauge. Distance metadata consistently
  shows direct kilometres or "Distance unknown", never an area-name fallback.
  On phones, result selection fits the map and collapses Browse into a preview;
  reopening results restores scroll position and filters. Details is a separate
  action, with "Close details" returning to the preview.
- Details have a fixed kind/favorite/close-X header and a wide Navigate action
  in a fixed footer. Favorite and close use matching bare 20 px icons without
  circles or background fills, retaining invisible 44 px targets.
  The close stroke is 2 px; header action spacing is 4 px.
  Result-card favorites keep their circular outline.
  Navigate retains secondary styling.
  Only the body scrolls, inset 8 px so its thin rounded scrollbar does not notch
  the outer card. Quiet dividers separate the fixed controls from content.
  The summary includes straight-line distance from the selected home,
  length, estimated route time and fun score. Heads-up and route flags follow the
  summary description before the disclosures. Speed limits appear as a compact
  grid inside road composition. Driving character/profile and roads precede
  score/source detail. "Before you drive" follows
  route facts; similar routes come last. The navigation-options disclosure and raw
  sample-departure lists were removed. "Before you drive" retains concise
  current-access, rerouting, legal-turnaround and endpoint caveats.
  Overlap percentages live only inside road composition, not cards or summaries.
  Chooser, results, preview, details and similar routes share route line symbols,
  map-matching swatches and small outline metadata icons, including a score gauge.
- Disclosures run at 250 ms with 100 ms content delay; reduced motion remains
  respected. Charts size to their actual container, including below 260 px.
  Explicit route fitting measures detail/preview overlays. Breakpoints reconcile
  on resize as well as media-query events. Home/ranking outside clicks preserve
  selection; detail close preserves coherent history; focus has a visible
  fallback. Stale-favorite cleanup now reports persistence failures.
- App/offline/install/update status verifies complete cached worker versions.
  Waiting updates do not force activation. Failed favorite persistence is
  reported rather than claiming it was saved permanently.

Validation: TypeScript, 82 Vitest tests, 4 service-worker tests and the production
build/build-contract test passed. Before the desktop Browse iteration, detail
geometry was checked at 320×568,
375×812, 600×900, 768×1024, 800×900, 1024×768, 1120×800, 1280×800,
1366×768, 1440×900, 1920×1080, 2560×1440, 3440×1440 and 812×375.
All checked views had no page/content horizontal overflow and visible Navigate
footers. Desktop map controls were not covered; mobile map edges remain inert
modal context. Measurements are in `reports/responsive-layout-checks.json`.
Embedded emulation required a dispatched resize event to reconcile media state;
this is not physical-device rotation testing. Targeted axe checks found no
violations; some map/filter contrast and bypass checks remained incomplete.
Base Web emits a non-failing
React `defaultProps` deprecation warning.

The latest Browse/preview layout was checked at nine sizes from 320×568 through
3440×1440, including 812×375. No page/body horizontal overflow or overlapping
Browse/preview rectangles were found. At 1920×1080 the open Browse panel is
420×832; a 20 px root font grows it to 525×985 within the viewport. Centered
details at 1920×1080 have 90 px top/bottom gaps, a visible footer and zero
targeted axe violations/incompletes. A later multi-size detail replay stopped
when no selected detail remained; it is not a successful new matrix.
See the latest follow-up in `reports/responsive-design-review.md`.

Final shared details/header checks subsequently passed at 320×568, 375×812,
600×900, 768×1024, 1024×768, 1366×768, 1920×1080, 3440×1440 and 812×375.
All samples had 20 px bare icons with 44 px targets, no horizontal overflow,
and visible Navigate footers. This settled replay supersedes the interrupted
attempt described above. Save feedback now floats at the top and expires after
three seconds, with an expiry regression test. Invisible CSS probes of long
feedback at 320/375/768/2045 px stayed within the viewport without changing main
geometry. Actual-toggle banner geometry checks were interrupted by absent
detail/page state and are not counted as passing. Current viewport restored.

Still unverified: physical iOS/Android standalone behavior, OS Back, virtual
keyboard/notches, real offline relaunch and Google Maps app waypoint retention.
Worker offline behavior is covered by tests, not a claimed physical-device
offline test. Travel-time filtering from both homes is deferred by user choice:
only circuits have modeled Zaandam reach times, and Haarlem/all-route reach data
is missing. Tier 4 payload restructuring and draggable sheets remain deferred.
Commit `cf43d96` was pushed and deployed successfully to GitHub Pages.
The later desktop floating-Browse and feedback refinements are now committed
as `edd7524`, pushed to `main`, and deployed successfully by Pages run
`37120051141`. Live page/CSS returned HTTP 200 with the current asset hash and
fixed-feedback/centered-detail rules. Tests and production build passed;
working tree is clean and synchronized with upstream.
`DESIGN.md` records the current rules.

Browser QA covered desktop and 375 px: save/filter/reopen persistence,
selected circuit and sprint/linked details, map markers, mobile detail/back
navigation, and Google Maps targets without opening the external service.
The result swatch and map feature both use `RouteView.color`; nearby tints
are tested in `web/src/data/units.test.ts`. The embedded-browser screenshot
capture repeated parts of the viewport, so it is not a clean pixel-perfect
visual baseline. Browser error history included old sessions, but no
messages attributed to the current `127.0.0.1:5173` origin were found.

The current sprint catalogue still has 2,338 routes at most 2 km. Urban
quietness uses a static modeled proxy, not hour-specific or live traffic;
no built-up penalty was added without evidence. Around Haarlem, the 14.4 km
Zeeweg loop was dropped in the 2026-10-03 pass: 53% of it drove Zeeweg out
and back on opposite carriageways, and no loop under the retrace cap exists.
Zeeweg now forms a 4.9 km open ride with Duinlustweg
(`linked-9868380d97dcf10e`). The Leimuiderweg, Nijswillerweg and
Amsterdamseweg out-and-back rides are gone for the same reason. The
Bentveldsweg anchor forms a 4.7 km open ride with Duinlustweg
(`linked-c5e94910ae9961f8`, retrace 0) through an alternate legal connector
via Elswoutslaan; Zijweg is no longer one of its anchors. Elswoutslaan is not
a mined sprint anchor under the 0.55 edge threshold, and the simulated
7 km Bentveldsweg/Duinlustweg loop fails the 20% low-fun cap (20.6%).
Langevelderslag Sprint remains (fun 0.667); the weak Langevelderlaan anchor
no longer pads it into a linked ride. Start/end pins remain graph endpoints,
not verified parking, turning or safe meeting points. A separate endpoint
policy needs reliable landmark/access evidence and real examples.
Local favorites are still keyed by content-hash IDs and can be invalidated
by a regeneration.

Known gaps: selection still favours longer rides; excluded edges may still
serve as connectors (counted as low-fun); `meta.generated` is the source
data time, not a build time; `dist/demo.html` still ships.

Historical checks before the responsive UI refinements: after the 2026-10-03
retrace regeneration, `pytest` 103 passed,
3 skipped (existing unregistered `network` marker warning); TypeScript
typecheck, 48 Vitest tests (including real-cache contracts for the retrace
cap, anchor-road search and 3-waypoint phone links), and the production
build passed. Browser checks at 800 px and 375 px confirmed the map, loop
detail, phone Google Maps link and clear-selection control; the overlap
chooser and stale-favorites notice were covered by code and unit tests only.

## Shared circuit-tail cleanup, 2026-10-04

User-approved pipeline follow-up, not a frontend map-hiding workaround.
`src/funroads/route.py` now cleans exact reversals and closed side excursions
that geometrically retrace >=80% of themselves, before circuit ranking and
statistics. It preserves genuine repeated-junction loops and the start point,
and rejects collapsed exact out-and-backs. No dependencies or country-specific
exceptions. The existing 25 m/opposing-heading helper is reused.

Existing published circuits were rebuilt from cached graph paths only, without
reranking: five NL circuits and two EE circuits changed. Route identities,
names, starts and counts are unchanged; every sprint and both linked files
are unchanged. Graph/features/scores/raw inputs/rubric are unchanged.
The existing Dutch `meta.title = FunRoads` edit is preserved. Both source
catalogues were backed up before updating; `site/` was rebuilt and checked.
This does not eliminate every kind of overlap, including some Dutch
carriageway/start-access retracing.

119 Python passed/3 skipped, 113 Vitest + 6 Node passed, typecheck/build/package
integrity passed. Three app distance/whole-route Maps-link checks passed.
Full evidence and bounds: `reports/circuit-cleanup-20261004/README.md`.
No commits, pushes or deploys. Pipeline/tests/fixtures/reports remain local
under the existing Git-ignore policy.
