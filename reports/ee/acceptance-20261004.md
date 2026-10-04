# Estonia local close-out checks, 4 October 2026

## Outcome

The conservative national catalogue remains unchanged: 790 Estonia routes and
3,853 Netherlands routes. Local automated and browser checks passed as listed
below. No commit, push, deployment, external publication, dependency addition,
pipeline change or catalogue regeneration occurred.

This is not public-release clearance or physical-device acceptance.

## UI change

Place-name separators display as small arrows, not em dashes. Normalization
occurs in the shared route model for results, map labels, previews, details,
similar routes, roads, anchors and search areas. Old saved names for missing
routes are formatted when displayed. Search accepts old separators and arrows.
Hyphenated place names, en-dash numeric ranges and approximate `~` values stay
unchanged.

Source JSON and route/favorite keys are unchanged. Two new regression tests
check name formatting, search/filter consistency and source non-mutation; the
real Estonia integration check asserts names contain no em dashes. DESIGN.md
now records the UI wording rule.

## Automated checks

- Python: 112 passed, 3 skipped. Existing unregistered `network` marker warning.
- Narrow frontend name/integration check: 40 passed.
- Full frontend: 97 Vitest tests and 6 Node tests passed.
- Typecheck passed.
- Production build and its separate package/integrity test passed.
- `git diff --check` passed. Git emits line-ending notices.
- Base Web React `defaultProps` deprecation warnings remain non-failing.
- PowerShell profile prediction warnings did not affect command execution.

The build integrity test verifies every packaged file and confirms both
country pairs are byte-identical to their source files.

## Browser checks

Production preview: http://127.0.0.1:5174/

Service-worker registrations and caches were reset in page context before
verification and again after the frontend rebuild. The desktop-owned browser
pane was not closed. Its original 1730×1288 emulated viewport was restored and
the QA-owned preview process tree was stopped after checks.

- Estonia Browse shows 790 routes. Netherlands shows 3,853 with Zaandam home.
- Viljandi → Rõngu details: 72.2 km, approximately 60 route minutes,
  168.9 km direct from Tallinn and 49.6 km direct from Tartu.
- A selected result stays in preview until Details is requested.
- Closing mobile details preserves selection; Back to results restores Browse.
- Desktop loop selection/details/close preserves the open Browse panel and its
  exact 120 px scroll position.
- Linked-loop details use the returning-to-start shape label.
- The longest linked-route name wraps within the mobile scrolling body, without
  horizontal overflow or hiding the fixed Navigate footer.
- Saaremaa sprint Läätsa → Jämaja → Sääre → Mäebe loads as a sprint with
  straight-line home distance, distinct start/end in its Maps URL, and three
  intermediate waypoints. Its safe/legal-turnaround and sampled-permission
  caveats appear after opening Before you drive.
- The island sprint's elevation/curvature chart renders within the detail body.
- Route/More filter views retain fixed Done/Reset actions.
- Favorite toggling shows a fixed top banner which expires, with saved state
  retained. The test toggle was reversed.
- Mobile modal background is inert through an ancestor containing the map.
- Map information retains live basemap links and OSM, terrain and Teeregister
  attribution/source links.
- Current observed body text and accessible labels contain no em dashes.
- Targeted detail accessibility audits: zero violations and zero incomplete
  checks on desktop and mobile. This is not a full-app accessibility audit.
- Google Maps hrefs were inspected, not claimed to match Google's computed
  roads or physical-app navigation.

Detail geometry matrix: 320×568, 375×812, 768×1024, 1024×768, 1280×800,
1366×768, 1920×1080 and 812×375. Every sample retained the selected circuit,
had no page/detail-body horizontal overflow, kept Navigate inside the viewport,
and retained 44 px header targets. Measurements:
`acceptance-20261004/detail-layouts.json`.

## Screenshot evidence and limits

Usable, visually inspected mobile captures (375×640):

- `acceptance-20261004/mobile-circuit-details.png`
- `acceptance-20261004/mobile-long-name.png`
- `acceptance-20261004/mobile-filters-more.png`
- `acceptance-20261004/mobile-island-sprint.png`
- `acceptance-20261004/mobile-island-profile.png`
- `acceptance-20261004/mobile-netherlands.png`

Wide captures sometimes repeat strips of the desktop pane. DOM checks showed
one title and one Browse panel, not duplicated app elements. These images are
not accepted as clean desktop pixel baselines. A screenshot named
`desktop-circuit-profile.png` was captured after the pane had switched to
Google Maps; it is not FunRoads acceptance evidence.

Some intermediate browser commands used a stale control name, inspected a
closing disclosure before its animation completed, or ran after the pane
changed pages. These attempts were not counted as passing. The applicable
interactions were repeated on the local page with fresh selectors/waits.

## Final SHA-256

Each packaged counterpart under `site/data/{ee,nl}/` has the same hash.

| Source | SHA-256 |
| --- | --- |
| data/ee/cache/routes.json | 65c65c0178c13e60e15df3b2e2b6c86d9ba89d7a238fd5563b21dd7b6e60a845 |
| data/ee/cache/linked.json | e0615b3120ed750b44293cd10a0b11651526a353b71be930de0756b2f439a1b3 |
| data/cache/routes.json | 9ab4b6078ca74747c8141c211215744f6fd2704e37a4cb450e14aee3ff122963 |
| data/cache/linked.json | cf2a1c0a5ce25c54af4c3466718d173b95007265f8c38e5455d4ee21dfa345e2 |

## Remaining work, not disguised as completion

- Teeregister's contradictory redistribution metadata still needs clarification
  before an unambiguously cleared public release.
- Clean desktop pixel baselines remain limited by the embedded capture harness.
- Physical iOS/Android standalone, offline relaunch, OS Back, keyboard/notches
  and Maps waypoint retention were not tested.
- Unknown surface/speed and register-confirmed gravel remain excluded. Circuit
  retrace gate remains <= 0.20; no evidence or quality gate was relaxed.
- No municipal source, loop-search improvement or turn-aware router was added.
- Raw inputs, manifest, ignored pipeline/config/tests and reports remain local
  and untouched except these local notes. No backup archive was created.

The requested cross-country dynamic Maps proposal is in
`google-maps-handover-plan.md`. It is a plan only, not implemented functionality.
