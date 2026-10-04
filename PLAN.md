# FunRoads — product state and frontend handover

Updated 2026-09-27. Read this document first, then `DESIGN.md` (the supplied
Uber-inspired visual language) and `design-plan.md` (preserved earlier
FunRoads design notes). `HANDOVER.md` is historical and predates the national
sprint and linked-ride work. **No frontend code yet; implementation is deferred
until explicitly requested.**

## 1. Product promise and boundaries

Help a driver discover *legal, enjoyable Dutch roads* and compare a short
out-and-back sprint, a point-to-point ride joining high-fun stretches, and
a circuit with an alternate return. Make the reason for a recommendation
legible. Preserve absolute scoring anchors; never present exceeding the
posted limit as desirable or suggest that a return turn is safe without
verification. Dutch OSM/traffic/elevation inputs are pinned snapshots,
not real-time road, weather, closure or traffic data.

The home places Zaandam and Haarlem are discovery origins, not a national
mining boundary. The **100 km value is a straight-line nearby-results view**,
not driving distance or reachability. Show dates and limitations on legal
access: sampled departure windows span weekdays/weekends, 08:00 and 20:00
in summer/autumn, with conservative conditional-access handling for a
three-hour trip. They are *examples* and need current roadside checks.
Scenery/quietness are modeled attributes, not live observation.

The data core is the priority. `web/` (a parked MapLibre/uPlot dark prototype)
and `dist/demo.html` are reference interactions, **not** the target design.
The supplied `DESIGN.md` replaces its visual direction. No prices, pickup
form, login, sharing, purchases, Uber logo, Uber illustrations, or UberMove
fonts are authorized or needed.

## 2. Current backend state, not aspirational UI

Pipeline: `fetch → graph → features → score → calibrate → route → linked
→ export → (render, deferred)`. The pinned national graph, features and
scores are built. National output last checked:

| Output | What exists | What does not yet exist |
|---|---|---|
| `data/cache/routes.json` | 12 ranked circuits (`routes[]`), 2,497 nationwide reversible sprints (`sprints[]`), 9 represented circuit areas, 12 `toproads` | These 9 `areas[]` are **not** a nationwide region index |
| `data/cache/linked.json` | 560 linked rides: 337 open, 223 circuits, in 245 local clusters; scenic/technical/quiet profile ID lists and Zaandam/Haarlem `nearby_100km` ID lists | Linked `area` is an integer cluster id, **not** an `areas[]` reference or a place name; linking covers two high-fun stretches, not arbitrary chains |
| `reports/sprints.md` | Nearby 100 km overview and Duinlustweg anchor | Not a live listing service |
| `reports/calibration.md` | KMZ diagnostic and caveats | Stale relative to the later reweighted scoring; do not claim its ranking figures describe the current catalogue |
| Export/render | Circuit `links.gmaps` and *reserved* GPX/KML URLs | No `export.py`, `render.py`, GPX/KML files, frontend API, or production bundle yet |

`src/funroads/options.py` can compare a named road, such as Duinlustweg,
with a legal short-circuit alternative on demand. Its results are **not**
yet materialized into the national JSON. Duinlustweg is a 1.1 km eligible
sprint; an on-demand 3.9 km loop uses Elswoutslaan and Zijweg, but it is not
in `linked.json`. Avoid implying every sprint already has a return loop.

Preserve the legal/score gates when building UI. A `sprint` requires both
directions to be high-fun and accessible in a shared sampled window.
`linked` searches legal directed connectors for two distinct mined stretches,
then may close them into a circuit; connector roads can be lower-scored but
are capped at 45% of its distance. The original national circuits remain
separate, with an ideal 40–120 km target. `linked` exposes both shorter rides
and circuits and should not be mislabeled as the same algorithm.

## 3. Technology and visual language decision

Choose **Base Web** (`baseui`), Uber's open-source React implementation of
the Base design system, with its documented Styletron integration and
`BaseProvider`. Source: https://github.com/uber/baseweb ; setup:
https://baseweb.design/getting-started/setup/ . At implementation time,
pin compatible package versions and review React/Styletron requirements;
do not install or migrate anything in this documentation phase.

Build a small themed React + TypeScript shell. Base Web supplies controls,
focus behavior, forms, tabs, drawers, filters and menus, not the map,
charts or Uber's proprietary identity. Keep **MapLibre GL JS** for map
geometry and **uPlot** for elevation/curvature; treat these as controlled
canvas islands around Base Web components. Use the `DESIGN.md` tokens and
an openly licensed Inter/system font substitute, not UberMove. Do not
hand-roll a parallel component kit or copy Uber product content. Base Web
does not guarantee the public Uber marketing site's exact appearance;
our monochrome skin is intentional.

The old static `web/app.js`, `web/style.css`, `web/template.html` and
`web/routes.example.json` are *behavioral references only*. Replace the
dark/red palette, tiny chips, handmade card/input chrome and direct DOM
state when frontend work begins. Do not silently treat the example data
as the live schema. Keep attribution visible on every map state.

## 4. User stories and acceptance signals

1. **Find a nearby drive.** From Zaandam or Haarlem I can choose “Nearby
   (100 km straight-line)” or “All Netherlands,” see the number of
   matches and distinguish location from reach time. Leaving nearby
   restores national results without remine. Nothing implies the radius
   means 100 km of driving.
2. **Search an area or road.** I can search a displayed area or road name,
   choose a suggestion, see its footprint on the map and clear the query.
   Search is grounded in indexed names/geometry actually present: circuit
   areas (9), road names and eventually enriched linked-cluster names.
   There is no address/geocoding API today. “No matching mapped area”
   is a real empty state, not an invented place or an OSM query.
3. **Compare forms of driving.** I can switch Circuit, Linked ride, Sprint,
   and All. A sprint is an outbound road that *may* be reversed after a
   safe legal turnaround; a linked open ride ends elsewhere; a circuit
   returns to the beginning. Show this on the map with different line
   patterns, start/end glyphs and text labels, never color alone.
4. **Filter without changing legality.** I can adjust type, length/drive
   duration where available, distance from selected home, area/road,
   sampled window, scenery, quiet, corners, and sort. Changing UI
   preferences **reorders already eligible routes**; it never rescales
   national anchors, bypasses exclusions, or promises an arbitrary
   departure is legal. A missing field makes the corresponding filter
   unavailable or “unknown,” not zero.
5. **Understand a route.** Selecting a result focuses its route and
   a card/drawer shows km, estimated drive time where present, fun score,
   dimension breakdown, roads, estimated low-fun connector share if
   present, reason, applicable sampled windows and relevant access/turn
   caveats. Circuit detail may show corners, stops, elevation/curvature,
   and legal speed where the corresponding real data exists.
6. **Use it on a phone.** Map and result sheet coexist on a 375 px screen;
   I can open full details, return with preserved filters and map
   position, and use every action without hover. Keyboard and screen
   reader users can reach the same result cards, markers and information.
7. **Take a route out.** Show Google Maps only for valid links. GPX/KML
   actions must be disabled or absent until the referenced files exist;
   never offer a dead download or equate a mapping link with real-time
   routing/permission.

## 5. Information architecture and interactions

Desktop (>=1120 px): restrained top bar with product name and
source/date help; a ~360–400 px left discovery rail; a generous map;
and a detail panel (right or bottom depending on available width). Rail
sequence: home/nearby toggle → search → route-type tabs with counts →
profile presets (balanced, scenic, technical, quiet) → compact filters
and “Reset” → results list. Show active filter pills and a result count;
never force a user to understand weight sliders first. Selected result
persists when filtering unless it is excluded, in which case explain
why and offer a clear return to results.

Tablet (768–1119 px): collapsible rail and map, details over the map.
Mobile (<768 px): full-screen map, persistent search/menu entry, one
expandable results sheet and a dedicated detail surface with Back;
no narrow desktop sidebar shrunk to fit. Target >=44 px controls,
safe-area padding, sensible map-control placement, no content hidden
behind the sheet or map attribution. Use Base Web's navigation, Input,
Select, Button, Tabs, Drawer, Checkbox and Slider where appropriate;
the map and uPlot remain distinct widgets.

Map: zoom-to-selected bounds without hiding the route under a rail/sheet;
visible selected path versus subdued context routes, clustered or
viewport-limited overviews so 3,069 routes do not draw simultaneously;
start/end markers and optional corner/stop marks only for the selected
route. A list selection highlights a line; a line selection focuses the
corresponding list card. Fit/follow only on explicit selection, never on
every filter change. Respect reduced motion; turn off decorative comet
by default. Offer a readable list when tiles fail or graphics cannot
load, with attribution still available.

Visual style: implement `DESIGN.md` as a Base Web **light** theme:
black/white/soft grays, 16 px cards, pill controls, sentence-case headers,
clear type hierarchy. This is a driving tool, not an Uber landing page:
do not create a ride-request/pricing card, promo band or branded rider art
merely because the inspiration has one. Chart series and map feature
types need distinguishable styles and textual legends; grayscale
contrast and accessibility take precedence over imitation.

## 6. Data-to-visualization contract and gaps

Load the two *static generated* JSON documents independently and validate
their schemas before rendering. They total roughly **21 MB**, so avoid
loading every polyline into MapLibre at once. In a future backend/output
pass, emit small indexed metadata for search/list/viewport and load
full geometry on selection or in bounded batches. Until that exists,
parse once, derive in-memory lightweight metadata, cap overview drawing
and avoid re-parsing or remounting the map for filter changes. Do not
simplify a circuit `line` without remapping its `seg.i0/i1` indices.

| Visual | `routes.json` | `linked.json` | Handling |
|---|---|---|---|
| Identity/type | `routes[].id`, `sprints[].id`; array supplies type | `rides[].id`, `type=open/circuit` | Prefix catalog IDs in UI state; never join by road name or assume numeric area IDs share a namespace |
| Geography | all route types expose `line` WGS84 `[lon,lat]`; circuit `start`, sprint `start/end` | `rides[].line`; circuits close at start | Use line endpoints for linked start/end, do not infer a safe turnaround from a line endpoint |
| Length, score | circuit `km`, `fun_km`, `score.total`/dimension scores (0–100); sprint `km`, `fun` (0–1), `score` dimension values (0–1) | `km`, `fun_km`, `score.total`/dimensions (0–100), `connector_share` (0–1), `drive_min` | Normalize **only for UI display/ranking**, label units, never feed back into routing or mutate caches |
| Nearby/reach | sprint `distance_km.Haarlem/Zaandam`; circuit `reach_min` from Zaandam graph origin | ride `distance_km`; `nearby_100km` IDs | There is no circuit straight-line `distance_km` and no sprint/linked `reach_min`. Add comparable fields in a future data build before a common reach filter; never substitute one for the other |
| Search/place | `areas[]` describes only selected circuit areas; route `area_id`, named `roads[]`, `toproads[]` | integer `area`, named `roads[]`; `profiles` and `nearby_100km` are lists of ride IDs | Cross-catalog area names and arbitrary municipality/postcode search require a new indexed gazetteer or named-cluster output; no fake join |
| Timing | circuit/sprint `windows[]`; linked `windows[]` | sampled local date/time strings | Display as sample departures with caveat. Filter by exact existing label, not fabricated recurrence, live closure, or guaranteed availability |
| Details/export | circuit `seg`, `elev`, `curv`, `corners`, `stops`, `why`, `links` | linked basic geometry, scores, roads, duration; sprint traits and turnaround text | No charts/corner pins/export links for linked/sprints until produced. Gate GPX/KML on file existence, never just the URL string |

Region searches are an explicit **backend/UI boundary**: 9 circuit
`areas[]` cannot act as a Netherlands-wide search index. Before making
“Search all places” a claim, generate a stable, non-proprietary
municipality/place lookup (or honest road/area autocomplete) and attach
point/area metadata to linked and sprint records. Use one place name
per concept; avoid confusion between a cluster, a municipality and an
individual named road. Near-me geolocation is opt-in and should have
a typed-place fallback; do not request location on first render.

## 7. Accessibility, reliability and trust

- Keyboard: logical tab order, visible focus, Escape to close panel,
  returned focus to its opener, arrow navigation only where the component
  documents it. Announce result-count/filter changes without spamming.
- Screen reader: labelled filters, map-as-supplement rather than sole
  information source, list equivalents for each map result; selected
  route name and type announced. Do not rely on hover, color, or tiny
  unlabeled chart lines.
- WCAG AA text/control contrast, zoom/reflow at 200%, reduced-motion
  preference, ≥44 px touch targets and testing at 375 px and desktop.
- Failure: distinguish unavailable map tiles, malformed data, absent
  exports and empty filter results. Keep a usable offline/static result
  list and source/date context when basemap fails.
- Display attribution for OSM and map tiles plus the source notices
  already present in the prototype. Check asset licenses, CSP and any
  external tile request before deployment; do not ship proprietary
  fonts or artwork without a license.
- Safety: show “check current signs and restrictions” alongside the
  sampled access note. Do not encode actual driving speed goals,
  “open now”, risk-taking claims, or a guaranteed U-turn.

## 8. Delivery order and definition of done (future work only)

1. **Contract first:** document/version a normalized read-only route
   view model; supply representative fixtures from both real national
   JSON files and synthetic missing-field/closed-window samples. Decide
   any additional regional metadata and export requirements before UI
   work, without weakening road eligibility.
2. **Foundation:** pin React, TypeScript, Base Web/Styletron, MapLibre
   and uPlot; apply the light token theme and open-source font. Remove
   dependence on CDN globals and parked dark styling in the new build.
3. **Discovery:** accessible search and filters, route-type tabs,
   nearby views, result counts, map/list synchronization and meaningful
   empty/loading/error states. Use real data and bounded rendering.
4. **Detail:** source-aware route details and sampled access caveats,
   conditional charts/markers and legitimate export actions. Preserve
   original circuit profile indexing.
5. **QA/handover:** compare mobile 375/600/768 and desktop >=1120 px,
   keyboard/screen-reader/reduced-motion flows, no-map fallback, actual
   data counts and search results, province/road anchors including
   Duinlustweg, and correct type/window/unit labels. Browser QA with
   real data before shipping. Fail if a generated link is dead or a
   route is misrepresented as legal at an unsampled time.

Data work remaining: `export.py`, static packaging/render strategy,
regional search index, comparable reach fields if desired, and refresh
of the stale calibration report after confirming no external changes.
The old `HANDOVER.md` is historical, not the source of truth for these
steps. No npm packages, UI files or preview builds are created by this plan.

## 9. Runbook for backend validation

```powershell
cd C:\Users\risto\funroads
$env:PYTHONPATH="C:\Users\risto\funroads\src"
.\.venv\Scripts\python.exe -m funroads route
.\.venv\Scripts\python.exe -m funroads linked
.\.venv\Scripts\python.exe -m pytest tests\ -q
```

Last run before this docs-only handover: **86 passed, 3 skipped, 1 existing
unknown `network` marker warning**. No Git metadata exists in this folder;
check current files directly before making assumptions about later edits.
