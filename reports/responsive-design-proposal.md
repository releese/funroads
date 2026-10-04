# FunRoads responsive/PWA design critique and tiered proposal

Date: 2026-10-03

Status: original assessment preserved as history. Sections 1–11 describe the
pre-implementation review. See section 12 and `responsive-design-review.md` for
the implemented design and remaining acceptance checks.

## 1. Recommendation

Keep the design language. Change the hierarchy, layout rules and interaction contracts.

The black/white/soft-gray surfaces, Inter typography, pill actions, square inputs,
16 px cards and restrained map treatment are appropriate. The problem is not a
missing visual identity. Too much secondary information competes with discovery,
and several independently controlled panels can occupy the same space.

The desired product flow is:

**Find a drive → compare results → preview its line → inspect useful details → save
or open navigation → return without losing context.**

Implement Tier 1 first, then Tier 2. Treat Tier 3 as the PWA reliability release.
Tier 4 is conditional, not a requirement to make the interface usable.

## 2. Scope and evidence

Reviewed the working React frontend, theme, data loader, map and chart integration,
manifest, service worker, build packaging and Pages workflow. `HANDOVER.md` reflects
the working frontend; the deferred-frontend language in `PLAN.md` is historical.

Browser checks used the existing local application at `http://localhost:5173/`
with real catalogue data: 3,853 routes. Inspected viewport sizes included
320×568, 375×812, 667×375, 800×900, 1120×800 and 1440×900.
Not every journey was repeated at every size.

Tested journeys:

| Journey/check | Observed result |
|---|---|
| Open discovery on a phone | Collapsed sheet still exposes the beginning of the filter form and keeps its controls keyboard-reachable. |
| Open the sheet and look for routes | Home, scope, explanatory copy, search, type, profile and curated lists precede results. |
| Search Duinlustweg, click outside suggestions | Suggestions close correctly. Preserve this behavior. |
| Search Duinlustweg, select a result, open details, Back | Search remains selected, route remains selected, sheet remains expanded and focus returns to the originating route card. |
| Select a route on desktop, click map canvas | Selection and details remain open. The map click handler has no zero-hit deselection branch. |
| Open details at 1120 px | The 420 px details panel covers the top-right zoom controls. The full legend occupies much of the remaining map. |
| Resize from selected phone view to tablet | Rail and details can coexist and the legend can spill over the rail. The tablet rail collapse currently happens on selection, not on breakpoint transition. |
| Inspect selected toolbar at 320 px | Actions fit, but the result-count/selected-route identity becomes extremely narrow and truncated. |
| Inspect landscape phone | The fixed map minimum and percentage sheet height leave little useful room for either task. |
| Automated accessibility check in the landscape/search-selected state | axe-core reported 0 violations, 1 incomplete contrast check and 28 passes for WCAG 2 A/AA tags. This does not prove keyboard, screen-reader or WCAG 2.2 compliance. |

Measured at 1440×900 before scrolling: matching results began at approximately
document viewport y=1806 in the discovery rail. The expanded map legend measured
260×344 px. At 1120 px the map container was 728 px wide, with a 420 px detail
overlay. This is a space-budget problem, not something smaller typography fixes.

Keyboard check after collapsing the sheet reached “From Zaandam” inside the
collapsed body. Controls are not actually removed from interaction when collapsed.

Screenshots are saved as `reports/design-critique-*.png`. Embedded-browser
captures are supporting evidence, not pixel-perfect production baselines.

### Important limitations

- This was a local browser/code critique, not a physical-device study or usability
  study with representative users.
- GitHub Pages production behavior, iOS/Android standalone mode, mobile keyboards,
  OS Back gestures, offline installation and update lifecycle were not browser-tested.
- The development application does not register the production service worker.
- No Core Web Vitals, cold-load, memory or low-end-device measurements were taken.
- No source-code changes were made, so build/typecheck/unit suites were not rerun.
- Existing favorites were left unchanged. Tests did not open Google Maps or publish anything.
- Some overview captures showed an unnecessarily broad European framing. Verify
  initial fitting on fresh loads and after layout settles before asserting its cause.

## 3. Design foundations

These sources supply principles, not a recipe for cloning another application.
The proposal combines them with the observed FunRoads behavior.

| Source | Application to FunRoads |
|---|---|
| Ethan Marcotte, *Responsive Web Design*, and the [original essay](https://alistapart.com/article/responsive-web-design/) | Adapt the composition to available space; do not merely shrink three competing panels. |
| Luke Wroblewski, [*Mobile First*](https://www.lukew.com/resources/mobile_first.asp) | Start with finding and choosing a route. Search and results deserve space before the full filter vocabulary. |
| Scott Jehl, [*Responsible Responsive Design*](https://abookapart.com/products/responsible-responsive-design) | Responsive quality includes network, performance, capabilities and failure states, not just widths. |
| Jeremy Keith, [*Going Offline*](https://abookapart.com/products/going-offline) | Offline and updates need an intentional user experience, with clear capability boundaries. |
| Don Norman, *The Design of Everyday Things*, revised edition | Visible signifiers and timely feedback: chevrons for disclosure, selected-state indicators and predictable dismissal. |
| Steve Krug, *Don't Make Me Think, Revisited* | Support scanning: lead with useful route facts and recognizable actions, not implementation terminology. |
| NN/g, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Put advanced filters, methodology and detailed metrics behind clearly named entry points. |
| NN/g, [Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/) | Distinguish map-linked nonmodal browsing from focused modal tasks. |
| NN/g, [Hidden Navigation](https://www.nngroup.com/articles/hamburger-menus/) | Collapse secondary content, but do not bury primary discovery behind an unlabeled hamburger. |
| NN/g, [Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) | Show result count, active filters, selected route, saved state and offline readiness. |
| [web.dev PWA app design](https://web.dev/learn/pwa/app-design) and [MDN PWA best practices](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Best_practices) | Installed mode needs its own navigation, safe-area handling and reliable feedback. |
| WCAG 2.2: [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow), [Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Dragging](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | Reflow controls at 320 CSS px, keep focused actions visible, and provide buttons for any drag operation. |

WCAG 2.2 AA's target-size rule uses 24 CSS px with exceptions. FunRoads should
retain its stronger 44 px product target. Maps can have a two-dimensional reflow
exception; that does not excuse overflowing menus or inaccessible surrounding controls.

## 4. Existing libraries: use them better, do not replace them

Pinned dependencies in `web/package.json`:

| Library | Current use | Recommended use/caveat |
|---|---|---|
| React 18.3.1 / TypeScript 5.9.3 | Shell, state, data adapters | Keep. Define a small explicit surface/selection contract, not a global state-library migration. |
| Base Web 18.2.0 | Buttons, groups, Select, Tabs, Slider, Accordion, Modal, Checkbox | Reuse Accordion for optional details; Popover for legend/help; Drawer/Modal for genuinely modal filters and mobile details. |
| Styletron React 6.1.1 / monolithic engine 1.0.0 | Theme and layout | Keep tokens; centralize repeated responsive sizes and override patterns only where they already repeat. |
| MapLibre GL JS 6.11.2 | Persistent map, patterned lines, selection, overlap chooser | Keep. Add intentional empty-map selection handling, control placement and measured panel-aware fitting. |
| uPlot 1.6.32 | Conditional elevation/curvature profile | Keep. Mount when profile disclosure is opened, preserve textual summary and add a readable cursor value if useful. |
| @fontsource/inter 5.3.0 | Bundled 400/500/700 font weights | Keep. No proprietary-font fetch or new typography system. |
| Testing Library / user-event / Vitest | Existing test infrastructure | Use for surface state, focus, dismissal and data-semantic checks. Add real-browser journey tests for layout and canvas gestures. |

### Base Web caveats verified against installed code

- The installed Popover API supports outside-click and Escape dismissal. Use its
  controlled or stateful API rather than several global document click listeners.
- The installed Drawer has backdrop/Escape/close-source support and wraps content
  in focus lock. **`showBackdrop={false}` does not turn it into a nonmodal panel.**
  Do not use it blindly for a results sheet that must coexist with an interactive map.
- Keep a normal nonmodal layout surface for map/results browsing. Use Drawer/Modal
  for focused filter editing or full mobile detail, with appropriate naming.
- Portal-mounted Select menus count as part of their owning dialog. Outside-click
  logic must not mistake them for unrelated page content.
- Use the installed v18 types as the API authority; older Base Web documentation
  examples may not match the pinned version.
- Use small theme/override changes, not a parallel custom component kit.
- No new UI, animation, bottom-sheet or PWA dependency is justified for Tiers 1–3.

## 5. Target information architecture

### Discovery

Visible first:

1. Road/area search.
2. A compact scope control, with “Nearby · Haarlem” or “All Netherlands.”
3. Route-type choice.
4. Result count, sort and “Filters (n).”
5. Actual route cards.

Keep “straight-line” visible whenever distance/radius appears. Scope editing can
expand to home and radius controls without showing every explanation all the time.
Do not relabel the existing lookup as address, town or universal place search.

Move profiles into the filter surface or a compact ranking control. Move curated
lists into a clearly labeled expandable “Curated lists” section after results or
a separate browsing choice. Since curated lists replace filter membership/order,
show an unmistakable “Curated ranking; filters paused” state and a direct exit.

Do not hide sort among advanced filters. Make active filters visible and removable
near the result count. The number on Filters should count actual filtering
constraints, not silently mix sort, favorites and curated mode.

### Detail

Always visible:

- Route name, kind and route shape.
- Length, modeled drive duration and the correctly named fun score.
- One short reason to choose it.
- Save, show/fit on map, close/minimize and valid navigation action.
- A concise access/safety summary, including sprint turnaround or open-ride return
  limitations where relevant.

Expandable sections:

- “Why this route” for further explanation.
- “Score breakdown.”
- “Roads and route composition.”
- “Elevation and curvature,” only when data exists.
- “Access samples and source details.”
- “Similar routes.”

Keep meaningful warnings visible with a count/summary before collapsing their
full list. Put cluster IDs and scoring-normalization details into source/methodology
content, not the first decision screen. Do not show fabricated zero values for
missing data.

Keep the navigation caveat adjacent to Google Maps. Moving the action upward must
not separate it from the warning that Google may reroute or imply access is verified.

## 6. Responsive behavior

Breakpoints remain useful starting points, but use a space budget for simultaneous
surfaces. A discovery rail, readable map and full detail need more width than the
current 1120 px cutoff guarantees.

| Context | Recommended composition |
|---|---|
| Phone, portrait | Map with a compact search entry; results sheet with peek, results and expanded states; filters/details as focused surfaces. |
| Phone, short landscape | Prefer an explicit full results/detail view and a compact map toggle over forcing a tall sheet plus tiny map. |
| Tablet/small desktop | One substantial side surface at a time. Opening full details replaces/collapses discovery; compact selected preview can coexist with the map. |
| Wide desktop | Discovery rail plus map; full details only when enough map width remains. Discovery must still be manually collapsible. |
| Zoomed desktop / narrow reflow | Follow available CSS space, not the device's nominal category. Controls reflow independently of the map. |

At a width budget of roughly 392 px rail + 420 px detail + 480 px map + gaps,
three-surface mode needs around 1320 px or more. This is a proposed starting budget,
not a new immutable breakpoint. Verify against real route bounds and zoom.

The sheet should use bounded, content-aware heights rather than only 132 px/68%.
The peek state must contain a deliberate summary, not a clipped fragment of the
filter form. Do not display a fake drag handle before drag actually works.

Reserve map controls/attribution clear space. Use actual surface geometry for
fitting when possible; the existing `safePadding` fallback can stop a fit error
but cannot make an obscured route usable. Preserve camera position on ordinary
filtering, disclosure and dismissal. Fit only on explicit selection/search/fit.

On breakpoint changes, reconcile surface state immediately. Do not rely on the
last click having occurred in the current viewport category.

## 7. Interaction contract: predictable dismissal

“Click outside closes it” is appropriate for temporary overlays, not every surface.
Distinguish dismissing a surface from clearing a selected route.

| User action | Required behavior |
|---|---|
| Click/tap outside a search suggestion menu | Close suggestions; keep query, selected search and filters. Already works in the tested flow. |
| Click outside legend/help/menu popover | Close only that popover. |
| Click a modal filter backdrop | Close filters; preserve live-applied changes. Label the close action “Done,” not “Cancel,” if changes are already applied. |
| Click inside a portal-mounted dropdown | Treat it as inside the owning surface; do not close its parent. |
| Click an accordion's surroundings | Do not collapse the accordion. It is document content, not a temporary menu. |
| Click a route line/start point | Select it; show a compact preview. A second click is not an implicit toggle-off. |
| Click several overlapping routes | Show chooser; pick selects once; outside/Escape closes chooser without clearing the previously selected route. |
| Click blank map with no temporary overlay | Clear selected route, highlight, auxiliary markers and cursor; restore the overview, preserve camera/filters/list position. |
| Click blank map while a popover/chooser is open | Close the top temporary surface only. Do not cascade the same click into clearing the route. |
| Pan, pinch, zoom, wheel or click map controls | Do not deselect. A gesture is not an empty-map click. |
| Click the persistent results rail/background | Do not deselect merely because it is outside details. |
| Minimize details / mobile Show on map | Keep selection; expose compact preview and map. |
| Explicit Clear selection | Clear selection. Do not reset filters or move the map. |
| Close full details / Back to results | Return to the prior browse surface and preserve selection, camera and result context. Keep a separate clear action. |
| Escape | Close only the topmost temporary surface; then details if open; then clear selection if only a preview remains. Never close multiple layers from one Escape. |
| OS/browser Back | Undo the last meaningful surface/route navigation; do not unexpectedly exit installed mode or trap the user in synthetic history entries. |

Route selection should use only eligible map hits. Exclude controls and overlay
DOM from blank-map dismissal. Use MapLibre's gesture/click behavior and verify it
on touch; avoid a bare document-level pointerdown handler.

After dismissal, restore focus when its opener still exists. If it was removed by
filtering, focus a sensible result heading/control instead. Hidden sheet content
must be unmounted, hidden or inert, not merely clipped or moved outside the viewport.

Keep ephemeral menus mutually exclusive. This can be one small surface state, not
a new state-machine framework. Maintain selection separately from detail expansion.

## 8. Tiered delivery

### Tier 1: remove friction and fix interaction defects

**Priority: immediate. Relative effort: small to medium. No new dependencies.**

- Collapsed, click-open legend on all sizes; include line keys and contextual
  selected-route markers, with longer explanation under “How to read the map.”
- Blank-map deselection and topmost-only dismissal contract.
- Fix collapsed sheet keyboard access and clipped-form appearance.
- Make discovery manually collapsible on desktop as well as tablet.
- Keep zoom/attribution and the selected route unobscured by details.
- Reconcile rail/detail states when resizing or rotating.
- Put sort, result count and active-filter summary where users can find them.
- Collapse optional route-detail sections; keep safety summary visible.
- Add persistent detail Back/close affordance during long scrolling.

**Exit criteria:** no hidden-but-focusable controls, no blocked map controls,
predictable outside-click/Escape behavior, and useful route context at 320/375/800/1120 px.

### Tier 2: rebuild the flow, not the design

**Priority: next. Relative effort: medium. Depends on Tier 1's surface contract.**

- Separate primary results browsing from the full filter form.
- Add results-sheet peek/results/expanded states with named button controls.
- Introduce compact selected-route preview versus expanded detail.
- Put search at the discovery entry point rather than behind a long sheet.
- Move curated lists and methodology out of the path to ordinary results.
- Make selected-state feedback consistent across map, card and preview.
- Preserve scroll position, filter settings and camera on every return flow.
- Add modest history integration for route/full-detail navigation, accounting
  for the GitHub Pages subpath. Query/hash navigation avoids deep-path 404s.
- Reduce selected-route marker clutter with zoom-dependent corner display;
  retain warnings in the readable detail/list equivalent.

**Exit criteria:** users can find a road, compare three routes, inspect a route and
return without rereading the filter form or reconstructing their state.

### Tier 3: make the installed/offline experience trustworthy

**Priority: before declaring PWA polish complete. Relative effort: medium.**

- Show verified “Available offline,” “Preparing offline data,” and failure/retry
  states. Online status alone does not prove routes or tiles are available.
- Explain that cached routes/list may work without the external basemap.
- Surface “Update available” while retaining the current coherent catalogue.
- Preserve the existing complete, integrity-checked version install behavior.
  Do not add unconditional `skipWaiting` or silently mix old/new catalogue data.
- Initially explain that all app windows must close to activate the waiting
  version. A one-button immediate update requires a separate, tested coordination
  design across tabs/windows; a simple reload alone is not guaranteed to activate it.
- Offer installation contextually after meaningful use, without blocking discovery.
  Provide platform-appropriate instructions where a prompt is not supported.
- Test safe areas, virtual keyboard, rotation and Back in standalone mode.
- Show source snapshot time separately from application/offline-build status.
- Improve route-load failure recovery without resetting the user's discovery state.

Current catalogue files total **38,498,404 bytes, about 38.5 MB uncompressed**.
The old plan's roughly 21 MB figure is no longer current. Service-worker installation
fetches the complete version, including both files. Assess transfer/cache cost,
including a possible extra catalogue fetch on first install; do not claim it was measured.

**Exit criteria:** production cold load, offline relaunch, failed installation,
waiting update and multi-window lifecycle work and are honestly explained.

### Tier 4: conditional optimization and refinement

**Priority: only after measurement/user evidence. Relative effort: medium to large.**

- If payload/parse time is a real bottleneck, generate small metadata/search
  manifests and fetch full route geometry on demand. This is an export/data-contract
  change, not a cosmetic frontend tweak.
- Add real draggable sheet snaps only if button-driven states prove insufficient.
  Maintain a non-drag alternative and resolve map/scroll/sheet gesture conflicts.
- Add marker clustering or more advanced collision suppression if the overview
  remains unreadable after better framing and bounded rendering.
- Address stable favorite identity in a separate data migration, not a UI patch.
- Introduce richer chart touch/keyboard exploration only if users need it.

Avoid new maps/charts/UI kits, elaborate animation, custom offline-tile caching,
onboarding carousels, login, sharing or unrelated features.

## 9. Interaction indicators

Use the existing language rather than a new accent color:

- Black outline/soft-gray fill plus “Selected,” not tint alone.
- Labeled chevrons and `aria-expanded` on expandable controls.
- “Filters (3)” plus removable active chips and reset.
- “Saved”/“Removed from saved” feedback, with restrained polite announcements.
- Loading/progress, empty, partial-data and map-failure states kept distinct.
- Tap-to-open legend/help; hover can supplement, never be the only access.
- Optional profile cursor readout with units; retain chart text summary.
- Reduced-motion handling for camera movement and panel transitions.

Do not use universal auto-closing or toasts as a substitute for an understandable
state. Every action should have a visible result and an obvious way back.

## 10. Real-use QA and acceptance plan

“Perfect” should mean predictable, recoverable and validated, not a claim that
every user/device behaves identically.

Run these journeys against both the production build locally and the deployed PWA:

| Real task | Required assertions |
|---|---|
| “Find a short drive near Haarlem.” | Nearby says straight-line; length/time filters distinguish route time from reach; national circuits without nearby distance are explained. |
| “Find Duinlustweg.” | Honest road search, visible suggestions, outside-click/Escape dismissal, clear query, list/map synchronization. |
| “Compare three overlapping routes.” | Chooser fits on screen; correct route selected; compact preview updates; dismissing chooser preserves existing selection. |
| “Look at the line without the details.” | Minimize keeps highlight; pan/pinch/zoom keep selection; intentional blank tap clears it without recentering. |
| “Read the full detail, then go back.” | Focus, query, filters, pagination and results scroll remain; full-detail scroll resets appropriately for a different route. |
| “Change filters while reading a selected route.” | Excluded selection is clearly explained; it is not silently replaced or mislabeled as matching. |
| “Open a curated list, then resume filters.” | Paused filter state is obvious and preserved; exit restores normal membership/order. |
| “Save a route and return later.” | Correct persistent saved state; stale-route notice remains truthful after catalogue update; storage failure is not reported as successful saving. |
| “Use it without a basemap.” | List remains useful; failure message/attribution remain reachable; no fictional offline map claim. |
| “Update with another app window open.” | No mixed build/catalogue state; waiting update explanation is accurate; favorites survive. |
| “Rotate while menus/details are open.” | No conflicting rail/detail surfaces, misplaced legend, keyboard trap or obscured map controls. |
| “Use only keyboard or a screen reader.” | Logical focus order, named controls, topmost Escape, return focus, useful announcements and list equivalent. |
| “Open navigation on a phone.” | Valid full/fallback links, adjacent caveats, no suggestion that stops guarantee exact routing or legal access. Verify real Maps behavior separately. |

### Device and state matrix

- Widths: 320, 375, 390/414, 600, 767/768, 800, 1024, 1119/1120, 1280, 1440.
- Heights: short landscape as well as tall portrait.
- Desktop zoom at 200%; reflow-equivalent narrow CSS viewport.
- Mouse, keyboard, touch, coarse pointer and reduced motion.
- Chromium desktop, iOS Safari browser/installed, Android Chrome browser/installed.
- Search keyboard open; notches and home indicators; large text.
- Empty results, missing duration/profile, failed catalogue, tile failure and offline.

### Test layers

1. **Vitest/Testing Library:** dismissal state, selected vs expanded detail,
   focus return, collapsed accessibility, filter preservation, no unsafe data labels.
2. **Real-browser journey tests:** layout geometry, outside clicks across portals,
   canvas hit behavior, pan-vs-tap, resize/rotation and visible controls.
3. **Production PWA tests:** service-worker installation/update, subpath deployment,
   offline and multi-window behavior. Development server tests are insufficient.
4. **Physical-device/manual assistive checks:** OS Back, keyboard, gestures,
   screen-reader announcements, safe areas and Google Maps handoff.
5. **Small moderated usability pass:** ask representative users to find, compare,
   inspect and return. Record confusion, mis-taps, backtracking and task completion.

Suggested acceptance targets, to validate rather than claim as research findings:

- Search/discovery entry visible without scrolling on a 375 px phone.
- First result visible in results mode without scrolling through curated content.
- Minimum 44 px primary touch controls.
- No ordinary control/menu overflow at 320 CSS px.
- No focused control obscured by author-created overlays.
- One Escape/outside click dismisses one temporary layer.
- Blank tap clears selection; map gestures do not.
- No unintended camera movement on Back, close, filter changes or legend changes.
- Critical access caveat visible with the route action.

## 11. Implementation touchpoints

- `web/src/components/App.tsx`: surface states, rail/sheet/detail composition,
  legend, resize reconciliation, focus and selection.
- `web/src/components/Controls.tsx`: primary vs advanced controls, filter summary,
  scope editing and sort placement.
- `web/src/components/RouteDetail.tsx`: summary-first hierarchy, disclosure sections,
  persistent navigation controls and adjacent safety caveats.
- `web/src/components/Results.tsx`: compact cards and explicit selection feedback.
- `web/src/map/MapView.tsx`: blank-hit handling, control placement, chooser semantics,
  bounds padding and marker density.
- `web/src/components/ProfileChart.tsx`: disclosure mounting and readable interaction.
- `web/src/theme.ts` / `global.css`: retain tokens; only responsive/layout refinements.
- `web/src/main.tsx` / `web/service-worker.js`: lifecycle feedback without weakening
  the existing version-integrity behavior.

Start with a narrow Tier 1 implementation and browser regression checks. Do not
rewrite the shell, add a second component system or couple UI improvements to a
national data regeneration.

## 12. Implementation status

- [x] Tier 1: disclosure/dismissal behavior, blank-map deselection, keyboard
  accessibility, collapsible discovery and non-obscuring details.
- [x] Tier 2: task-first browsing, compact previews, summary-first details,
  context-preserving Back/history, filter separation and retry loading.
- [x] Tier 3: verified offline-readiness status, non-forced update handling,
  install guidance and truthful favorite persistence feedback.
- [x] User-directed polish: one-step floating browse surface with search inside;
  text-only map title; information/zoom control stack; combined legend/sources
  popover; bounded route chooser and forgiving hits; compact icon metadata;
  consistent 8 px action buttons and hover/focus states; grouped filters;
  matching back/Navigate/favorite toolbar, top-inset masking,
  shorter safety guidance and twice-as-fast disclosures.
- [ ] Tier 4: deferred pending evidence. No new dependencies or pipeline changes.
- [ ] Home-to-route time filter: deferred by user choice until both homes have
  modeled reach-time data across the catalogue.
- [ ] Physical-device/standalone/offline-relaunch acceptance checks remain open.

Latest refinements: inset/floating rounded details, favorite/close-X header,
fixed Navigate footer, inset thin scrollbars, measured map padding and coherent
resize/return behavior. The earlier matching three-action toolbar is superseded.
Tier completion above describes implemented mechanisms, not completion of
physical-device or production PWA acceptance.

The subsequent desktop iteration uses a taller em-sized bottom-left Browse
panel, floating title, consistent preview-first selection, aligned bottom-right
preview/chooser and vertically centered details. Desktop Browse stays open on
selection/panning. Route fitting measures the tall panel on the left.

Save feedback is now a brief fixed top banner, not a layout-shifting footer.
The final shared detail/header replay passed at nine sizes from 320 px through
3440 px; physical-device/PWA acceptance remains separate.

Current validation: TypeScript, 82 Vitest tests, 4 worker tests, production
build and build contract. Browser review covered narrow phone through desktop;
axe filters/details scans found no violations. The earlier chooser replay was
interrupted; the later desktop chooser was verified with a synthetic MapLibre
click and browser selection using real route data.
The final floating-detail geometry matrix includes phone, tablet, laptop,
1920×1080 and 3440×1440 layouts. See `responsive-design-review.md` for exact
scope, `HANDOVER.md` for limitations and `DESIGN.md` for approved design rules.
