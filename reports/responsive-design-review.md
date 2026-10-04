# FunRoads design-session audit and design review

Scope: the current working tree, the original responsive/PWA proposal, current
design guidance, handover notes and the decisions recorded during this session.
The initial audit below is preserved as decision history. The implementation
follow-up at the end supersedes resolved findings and older layout descriptions.

## Verdict

Keep the current direction. The redesign now supports the intended journey:
**find → compare → preview the map → inspect → save/navigate → return**.
The remaining work is a small consistency and interaction pass, followed by
honest production/device acceptance testing, not another redesign.

Most original UI mechanisms exist. Several original prescriptions were
deliberately replaced with simpler designs. However, “Tier 1–3 complete” currently
overstates acceptance: some interaction edges remain, and production PWA/device
exit criteria have not been demonstrated.

## 1. What landed, changed or remains open

| Original commitment | Current implementation | Audit status |
|---|---|---|
| Hidden collapsed content must leave the tab order | Browse body uses `hidden`; modal background uses `inert` | Implemented; covered by component tests |
| Collapsible discovery and enough map space | Desktop rail collapses; below 1320 px details replace discovery; mobile details are full screen | Implemented; final resize/device replay still open |
| Compact map information | Legend and live attribution share a popover | Implemented; attribution remains accessible |
| Blank-map deselection and one-layer dismissal | Map handles zero hits, gestures and chooser dismissal; App protects legend and listbox clicks | Partly complete: home/ranking popovers are missing from the pointer guard |
| Useful discovery before advanced filters | Search, compact setup row, count, family choices and results; curated lists follow results | Implemented |
| Peek/results/expanded sheet | One named open/closed Browse surface | Intentionally superseded; do not restore three states |
| Selected preview separate from full details | Phone card selects/fits/collapses; Details is explicit; desktop cards open details | Implemented; phone preview omits the shared route-kind label |
| Preserve return context | Mounted phone results preserve scroll; filters/selection remain; hash history handles details and filters | Implemented for tested flows; desktop Show list and focus fallback need attention |
| Summary-first details | Distance, length, route time and score precede secondary disclosures | Implemented |
| Visible safety summary adjacent to navigation | Practical guidance retained in lower “Before you drive” disclosure | Intentionally relocated; original adjacency criterion is no longer met |
| Explicit fit action | Selection fits; desktop preview also has Fit route; phone preview has Details only | Partial coverage; a separate phone re-fit action after panning was not established |
| Reduce marker clutter | Corner pins hide below zoom 12; warning pins remain | Implemented, not clustering |
| Lazy profile rendering | Disclosure mounts the chart only when opened; text describes the profile | Implemented |
| Route-load recovery | Retry reloads data without resetting discovery preferences | Implemented |
| Verified offline/readiness/update/install feedback | PWA state and worker protocol exist; no forced update activation | Mechanisms implemented, discoverability weak and production acceptance open |
| Quiet sticky-toolbar divider | White sticky mask and spacing exist; no divider | Missed polish item |
| Reach-time filtering from home | No estimate fabricated from direct distance | Explicitly deferred for missing data |
| Payload restructuring, draggable sheets, clustering, stable favorite identity | Not added | Conditional/deferred, not missed UI work |

Evidence: `web/src/components/App.tsx:196-307,400-609`,
`web/src/map/MapView.tsx:171-239,334-424`,
`web/src/components/ui.tsx:41-54`,
`web/src/components/RouteDetail.tsx:77-274`.

## 2. Why the design changed

These are intentional choices from the session, not regressions to undo.

| Earlier direction | Current choice | Reason |
|---|---|---|
| Pills for almost all actions | 8 px action corners, 16 px surfaces, circular map/star controls | More compact and uniform; retain generous touch targets |
| Several sheet expansion levels | Browse open/closed | Remove an unnecessary state and clipped intermediate content |
| Search outside/above browsing | Search inside Browse | Reduce persistent map obstruction while keeping a named discovery entry |
| All/type tabs | Independent circuit/linked/sprint toggles below count | Allow combinations and soften control prominence |
| Full home/profile controls or dropdowns | Place-name home popover and ranking popover | Reduce chrome; make styles recognizable with distinct symbols |
| Favorites switch in the browse header | Favorites in Filters, removable active chip | Reserve primary browsing space for discovery |
| One long filter form | Route/More tabs, bounded body, fixed Reset/Done | Make common edits manageable without hiding dismissal actions |
| Sampled-departure filtering/lists | Removed from UI; underlying access evidence retained | Avoid turning sampled examples into implied live permission |
| Card opens phone details immediately | Card opens map preview first | Let users inspect the route line without an obstructing detail view |
| Navigation-options disclosure and compact fallback link | One Navigate action using the full Maps link | Remove redundant navigation choices; real app waypoint retention remains unverified |
| “Show on map” and Clear selection buttons | Back to map, blank-map tap/Escape | Remove duplicate actions; separate dismissal from deselection |
| Overlap sentence and percentages in cards | Overlap in Roads and route composition | Remove unwanted extra card content, not a scrolling-layer fix |
| Limits inside profile, then promoted into summary | Compact limit/share grid in road composition | Keep long mixes from overwhelming the first decision screen |
| Badges/score/source details high in the view | Badges in Why this route; technical facts lower | Lead with route usefulness rather than methodology |
| Heads-up among disclosures | Heads-up/flags directly under description | Keep meaningful route warnings visible without breaking the disclosure sequence |
| Safety guidance earlier | Before you drive after facts, before Similar routes | Approved reading order; comes with lower warning visibility |
| Slower disclosures | 250 ms, 100 ms content delay; reduced-motion override | Faster inspection without additional animation machinery |

The earlier sticky “text bleed” report was clarified as an unwanted sentence
inside a result card. That sentence was removed. It is not evidence that a new
scroll-mask repair was completed or still required.

## 3. Current UI contract to keep

- **Browse:** search → home/ranking/Filters → active chips → result count →
  independent route families → cards → curated lists.
- **Phone return:** results → map preview → deliberate Details → Back to map →
  Back to results, preserving list position and filters.
- **Filters:** Route contains Favorites, distance/radius, length, minimum fun
  and time on the route. More contains scenery, quiet and corners.
- **Families:** all three are selected by default; combinations and an empty
  selection are allowed. Linked shape is editable when Linked is the sole
  family. Its constraint remains applied to linked rides in mixed selections,
  with a removable chip when active. That persistence should be explained and
  checked, not mistaken for the shape Select remaining visible.
- **Details:** toolbar → identity/shape/area → home distance, length, route time,
  score → short description and Heads-up → Why → profile → composition/limits →
  score breakdown → facts/sources → Before you drive → Similar routes.
- **Semantics:** direct kilometres are straight-line, not driving distance;
  route minutes are not travel-to-start minutes; missing values are not zero;
  quiet/access data is not live information.
- **Visual grammar:** Inter 400/500/700, black/white/soft gray, 8 px actions,
  16 px surfaces, square text inputs, decorative outline symbols plus text,
  visible keyboard focus and at least 44 px main touch targets.
- **Toolbar:** matching soft-gray Back/Navigate/favorite actions are deliberate.
  Do not make Navigate black just to force a new hierarchy.

The phone/desktop card behavior differs intentionally because desktop has room
for side-by-side inspection. The <768 px and <1320 px composition thresholds
are the current decisions, not the older starting-point breakpoints.

## 4. Prioritized findings

### First: complete the interaction contract

**1. Home/ranking outside clicks are not protected from map deselection.**
The map pointer capture records only `legendOpen` or a listbox. Home and ranking
are independent Base Web popovers, and the blank callback otherwise clears the
selected route. Thus the newer surfaces are not covered by the original
“dismiss one layer” guard. Escape does check for a Base Web popover, so the
pointer and keyboard contracts differ.

Evidence: `web/src/components/App.tsx:295-307,456-477`;
`web/src/components/DiscoveryControls.tsx:21-62`.
Recommendation: extend the existing guard to these popovers and add a selected
route + ranking/home + blank-map regression. Do not introduce a state framework.
The guard omission is confirmed in code; the exact event sequence has not been
replayed in the live canvas during this audit.

**2. Narrow-desktop Show list leaves the detail URL/state behind.**
Its handler sets `detailOpen` false and opens the rail, without using the detail
history/URL close path. The visible view becomes the list while the hash can
still say `detail=1`; reopening that URL restores a different surface.

Evidence: `web/src/components/App.tsx:270-284,411-424`;
`web/src/navigation.ts:7-20`.
Recommendation: make this another coherent detail-close transition and test it
with Back and URL reopening.

**3. Focus restoration lacks a visible fallback.**
After a similar-route change the originating button is unmounted; after
filtering/pagination a matching card may be absent; on phones cards may be
connected but hidden. Restoration checks connection or queries a card, but
does not check visibility or fall back to the visible sheet handle/list control.

Evidence: `web/src/components/App.tsx:89-105,270-284`;
`web/src/components/RouteDetail.tsx:239-269`.
Recommendation: restore to a visible opener, otherwise the visible Back to
results/Browse handle or a stable discovery control. This is a confirmed
fallback gap, not a claimed fresh screen-reader reproduction.

**4. Stale-favorite cleanup ignores storage failure.**
Normal saving reports persistence failure; removing stale saved routes ignores
the boolean from `saveFavorites`. Removed entries may return next launch without
an explanation if storage rejects the write.

Evidence: `web/src/components/App.tsx:161-166`;
`web/src/data/favorites.ts:42-50`.
Recommendation: reuse the existing persistence feedback for cleanup.

### Next: finish the small uniformity pass

**5. Finish the requested toolbar divider.**
The sticky white masking is present; the proposed quiet 1 px `#e2e2e2` divider
with 12 px below the buttons and 16 px before content is absent.
Evidence: `web/src/global.css:40-57`;
`web/src/components/RouteDetail.tsx:79-102`.
Treat this as missed polish, not a reason to change the toolbar layout.

**6. Close the remaining component-family inconsistencies.**

| Surface | Current mismatch | Minimal recommendation |
|---|---|---|
| Result favorite | Unicode ☆/★, while details/filter use an SVG star | Reuse the existing SVG path; keep the circular card affordance |
| Phone selected preview | No `KindLabel`/swatch, unlike desktop/cards/chooser/details | Add the existing shared kind label |
| Similar-route title | 16/24 px, weight 700 vs result title 16/22 px, weight 500 | Use the card-title treatment unless a stronger title is intentional |
| Missing detail distance | “Not available” vs cards’ “Distance unknown” | Use one missing-distance phrase |
| Preview/similar metadata | Home omitted from `RouteStats`, so no home distance | Decide consciously which summaries need it; not fabricated or mislabeled data |
| Curated Favorites state | Favorites still applies, but the normal active chip is absent and main copy says filters paused | Expose the exception and enabled state beside curated results |
| Long scroll surfaces | Thin scrollbar styling covers filters/sheet/chooser/popovers, not desktop rail/detail or phone detail | Apply the existing class if uniform scroll chrome is desired |

Evidence: `web/src/components/Results.tsx:64,78-103`;
`web/src/components/App.tsx:504-579,715-746`;
`web/src/components/RouteDetail.tsx:116,259-268`;
`web/src/global.css:74-96`.

These are leftovers, not grounds for replacing the shared UI helpers or adding
an icon library. Different icon *sizes* for metadata and standalone actions are
appropriate; different star *drawings* are not needed.

### Then: resolve visibility trade-offs and geometry

**7. PWA feedback exists but is too hidden to count as prominent status.**
It is mounted only after Map information → App and data. Offline preparation,
failure, update and install availability have no ordinary-discovery indicator.
Recommendation: one quiet status indicator when useful, linking to the existing
panel. Do not add a permanent large warning or forced install prompt.

Evidence: `web/src/components/App.tsx:480-494`;
`web/src/components/PwaStatus.tsx:5-34`.
This is a discoverability gap against the original plan, not missing worker logic.

**8. Preserve the approved safety order, but acknowledge its cost.**
Navigate is sticky and immediately actionable; access/rerouting/turnaround
guidance is collapsed well below it. The current code and tests deliberately
keep that guidance hidden until Before you drive opens. This meets the later
reading-order request, not the original adjacent-caveat acceptance criterion.
Recommendation for a separate decision: keep the detailed disclosure where it
is, but consider one quiet sentence near the action/summary. Do not silently
restore the rejected navigation disclosure or a large warning card.

Evidence: `web/src/components/RouteDetail.tsx:83-87,217-234`;
`web/src/components/App.test.tsx:85-93`.

**9. Route fitting uses estimates, not measured overlay geometry.**
Mobile preview bottom padding is fixed at 224 px. The preview can grow with
wrapped names/metadata/exclusion messages. `safePadding` prevents impossible
padding but can then use 24 px, which does not account for the actual preview.
Recommendation: replay long-name/excluded previews at 320 px and short
landscape first; measure the existing preview only if those checks demonstrate
occlusion. No speculative fitting rewrite.

Evidence: `web/src/components/App.tsx:198,564-575`;
`web/src/map/MapView.tsx:122-131,409-424`.
Actual current occlusion is unverified, not asserted.

## 5. Documentation drift

- `reports/responsive-design-proposal.md:4` still says no implementation changed,
  but its implementation section marks three tiers done and cites 63 tests.
- `DESIGN.md` already identifies the historical plan and implemented UI.
  Its implemented 8 px action tokens take precedence over marketing references.
- `PLAN.md:6,45,168` still describes no frontend/bundle and roughly 21 MB payload.
  Those are historical, not current product facts.
- `HANDOVER.md:187-201` records the newer 70-test implementation; its final
  older section still references 48 tests, phone fallback links and a
  clear-selection control. The opening inventory still mentions sampled-access
  UI without clarifying that its controls were removed.
- Existing screenshots are intermediate evidence, not a final visual baseline.
  The compact-filter image predates the Favorites move and final spacing;
  the summary-icons image retains older speed-limit placement/copy;
  the inspected refined chooser image is black and proves no chooser behavior.

Recommendation: add explicit historical/superseded labels, reconcile the token
reference and distinguish “mechanisms implemented” from “acceptance verified.”
Do not rewrite the entire historical plan.

## 6. Validation and remaining acceptance

Fresh checks in this audit:

- `npm test`: **70 Vitest tests and 4 worker tests passed**.
- `npm run typecheck`: passed.
- `git diff --check`: passed; existing LF/CRLF notices only.
- Base Web `defaultProps` deprecation warnings remain non-failing.

No application code was changed. The production build was not rerun for this
report; the previous implementation build/build-contract pass is historical
evidence. No data regeneration, deployment, commit or push was performed.

Fresh live visual verification was blocked: an isolated tab could not be
created, and the attached pane changed to Google Maps. No navigation or changes
were made to the Maps route. Previous geometry/axe checks are useful but do not
verify the final compact redesign. Component tests mock MapLibre and cannot
prove real canvas hits, camera bounds, pointer gestures or pixel geometry.

Required next acceptance pass:

1. Final Filters with distance enabled at 375×812 and 320×568: body scroll,
   footer visibility, no page overflow, keyboard focus. The previous
   radius-enabled measurement still needed 59 px of internal scroll before
   the final spacing reduction; final fit was never established. A bounded
   scrolling body is acceptable on short screens, an inaccessible footer is not.
2. Selected route + home/ranking/legend/chooser: one outside click or Escape
   closes one layer; pan/pinch/zoom preserves selection.
3. Phone result → map → detail → similar route → Back → results; excluded or
   paginated routes; scroll and visible focus recovery.
4. 320 px, portrait/short landscape, 768/800 px, 1120 px and wide desktop;
   rotation while menus/details are open; manual contrast on translucent chrome.
5. Production cold load, offline relaunch, failed installation, waiting update
   with multiple windows and project-subpath navigation.
6. Physical iOS/Android browser and standalone: keyboard, notches, OS Back,
   assistive technology and actual Google Maps waypoint retention.
7. Measure cold-load/parse/memory cost before considering Tier 4. Stable
   favorite identity and GPX/KML remain separate data/product work.

## Suggested next scope

One small pass: dismissal guard, coherent Show list transition, visible focus
fallback, stale-save feedback, divider and shared glyph/title/copy cleanup.
Then validate those flows and the final filter geometry. Keep the approved
information hierarchy; take PWA status and safety visibility as explicit
trade-off decisions rather than silently reversing earlier choices.

## Implementation follow-up: floating details and responsive scaling

User approved the floating/inset detail design after the audit:

- Mobile details are a rounded, safe-area-aware card with 12 px outside space.
  The background remains modal/inert; visible map edges are context.
- Desktop/tablet details float inside the map, at 320–420 px width and a maximum
  900 px height. The right map-control lane remains clear. Below 1320 px the
  discovery rail hides while details are open; wide/ultrawide screens retain
  bounded reading columns and give additional space to the map.
- Kind/swatch, favorite and close X live in the fixed header. Navigate lives in
  the fixed footer. Only the middle content scrolls. Quiet dividers replace the
  earlier sticky-toolbar divider proposal; no sticky inset mask is needed.
- Thin rounded scrollbars now apply to detail content and the desktop rail,
  with no custom arrow buttons in Chromium. Charts follow container width
  instead of imposing a 260 px minimum.
- Blank-map guards now include home/ranking popovers; Show list uses the detail
  close/history path; focus restoration has a visible fallback; stale-favorite
  cleanup reports storage failure.
- Stars share the SVG drawing, phone preview has the kind/swatch and home
  distance, missing distance wording is consistent, similar titles match cards,
  and curated mode explains/exposes the Favorites exception.
- Explicit route fitting measures current map overlays. Short-screen fallback
  preserves as much blocked bottom/right space as possible instead of dropping
  all overlay padding.

Fresh checks: 78 Vitest tests, four worker tests, TypeScript and production
build/build-contract pass. Live matrix evidence is recorded below after the
viewport checks; earlier geometry and screenshots are not substituted for it.

Still separate: prominent PWA status, any new adjacent safety sentence, physical
standalone/offline/Maps testing, reach-time data and conditional Tier 4 work.
The existing safety reading order remains unchanged.

### Final responsive evidence

Checked the selected Duinlustweg Sprint with real catalogue data. This is a
geometry/interaction sample, not every route/journey at every viewport.
Raw final measurements: `reports/responsive-layout-checks.json`.

| Viewport | Composition | Detail width × height |
|---|---|---|
| 320×568 | Inset modal | 296×544 |
| 375×812 | Inset modal | 351×788 |
| 600×900 | Inset modal, bounded width | 560×876 |
| 768×1024 | Map + floating details, rail hidden | 320×900 |
| 800×900 | Map + floating details, rail hidden | 320×820 |
| 1024×768 | Map + floating details, rail hidden | ~328×688 |
| 1120×800 | Map + floating details, rail hidden | ~358×720 |
| 1280×800 | Map + floating details, rail hidden | ~410×720 |
| 1366×768 | Rail + map + floating details | 420×688 |
| 1440×900 | Rail + map + floating details | 420×820 |
| 1920×1080 | Rail + map + floating details | 420×900 |
| 2560×1440 | Rail + map + floating details | 420×900 |
| 3440×1440 | Rail + map + floating details | 420×900 |
| 812×375 | Short-height floating details, rail hidden | 320×295 |

All final matrix samples had no page or detail-content horizontal overflow and
a Navigate footer within the viewport. Desktop zoom controls did not intersect
the panel; phone map controls remain intentionally behind the modal.
The scrollbar is 8 px inside the card (9 px measured from the desktop panel's
outer border), removing the edge-notch effect while preserving text alignment.
At 320 px an expanded profile also fit without horizontal overflow.

On 375×812, final default Filters measured 655 px tall. With distance enabled,
the dialog measured 780 px, body 628 px with 631 px content, and Done remained
visible. Thus there is only 3 px internal overflow in that checked state, not
the earlier 59 px. No no-scroll promise is made for shorter screens.

Targeted axe checks found zero violations. Detail scans at 320/375 px had no
incompletes; other map/filter scans retained manual contrast/bypass incompletes.
No automated scan establishes physical-device or full screen-reader compliance.

The embedded browser did not consistently deliver media-query changes during
emulated viewport swaps. The hook now also reconciles on resize, with a unit
test. Final matrix checks dispatched a resize event after each emulated size.
Early stale-state and initial modal-transition measurements were discarded.
Nonanimated mobile details explicitly avoid the library's initial 20 px
translation, so opening does not briefly overflow and create a root scrollbar.
Some wide screenshots duplicated viewport fragments; DOM measurements are the
geometry record, not those captures as pixel-perfect visual baselines.

### Subsequent desktop design-mode iteration

This supersedes the earlier desktop rail/top-bar composition:

- Full-viewport map, floating text title, no white header/subtitle or Hide/Show
  list button. Desktop Browse floats bottom-left; its 26.25 em width and 52 em
  height are viewport-bounded. It stays open on selection, map gestures and
  map-information use; its state/scroll survive details.
- Every result selection stays in compact preview. Details is deliberate.
  Preview and overlap chooser share bottom-right placement with 72 px control
  clearance and responsive bottom breathing room. Fit route is removed.
- The bounded desktop detail panel is vertically centered on the right.
- Detail-header favorite/close use matching bare 20 px icons with 4 px spacing
  and a stronger 2 px close stroke, without filled
  squares or visible circles. Both retain invisible 44 px targets and hover/focus
  states; a filled star indicates saved state. Result-card circles are unchanged.
- Explicit route fits reserve the tall desktop Browse panel on the left, not
  below the route. Multiple bottom overlays retain the largest padding.

Validation: 81 frontend tests, four worker tests, typecheck and production/build
contract pass. Nine Browse/preview viewport checks covered 320×568, 375×812,
768×1024, 800×900, 1024×768, 1366×768, 1920×1080, 3440×1440 and 812×375.
No measured page/body horizontal overflow or Browse/preview intersection.
At 1080p Browse measured 420×832; a 20 px root font yielded 525×985 within the
viewport. Details measured 420×900 with equal 90 px top/bottom gaps, a visible
Navigate footer and zero targeted axe violations/incompletes.

Real-data consecutive desktop card selections remained previews. A synthetic
MapLibre click at a real overlap opened the chooser; choosing an option through
the browser opened a compact preview, not details. Both surfaces measured 72 px
from the right and about 43 px from the bottom at 1080p. This is not a physical
pointer/touch test. A settled circuit's projected line fit between the panels:
x 444–1416 and y approximately 371–705 in the 1920×1080 map.

The expanded Browse matrix passed, but a subsequent multi-size centered-detail
replay stopped when no selected detail remained after its first resize. Do not
count that attempt as a successful fresh detail matrix. The earlier detail
matrix remains historical evidence. Physical-device limits remain unchanged.
The pane was restored to 1920×1080. This iteration remains local; the previous
`cf43d96` release, not these follow-up changes, is deployed on Pages.

### Final small-screen uniformity and feedback check

Final common details/header replay passed at 320×568, 375×812, 600×900,
768×1024, 1024×768, 1366×768, 1920×1080, 3440×1440 and 812×375.
Both header icons remain 20 px with 44×44 px targets. No page/detail-content
horizontal overflow; Navigate remains inside the viewport. At 1080p and
ultrawide, capped details have equal top/bottom gaps. This settled replay
supersedes the earlier interrupted new-detail matrix.

Save feedback is now a fixed floating top banner with a three-second TTL.
Its expiry is covered by a regression test that also verifies saved state
persists after dismissal. Long feedback CSS probes at 320/375/768/2045 px fit
within the viewport without changing main bounds. Phone placement is below
header actions. The actual-toggle geometry attempt was interrupted when the
selected detail disappeared; later probes waited for settled app markup and
did not modify saved routes. Do not count the failed attempt as a passing
actual-toggle interaction test.

Latest validation: 82 frontend tests, four worker tests, typecheck and production
build/build-contract pass. Desktop Browse intentionally remains open during
comparison, while phones collapse it for map space. Shared controls, metadata,
details and scrollbar treatments remain consistent. Physical-device, manual
assistive/contrast, performance and production PWA acceptance remain open.
Publication follow-up: these refinements are now committed as `edd7524` and
deployed successfully by Pages run `37120051141`. The live page and current CSS
return HTTP 200; published rules include fixed feedback and centered details.
The earlier local-only notes describe the pre-publication validation stage.
