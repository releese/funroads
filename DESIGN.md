---
version: alpha
name: Uber-Inspired-design-analysis
description: An inspired interpretation of Uber's restrained black-and-white web design, not an official Uber brand guide.

colors:
  primary: "#000000"
  on-primary: "#ffffff"
  ink: "#000000"
  body: "#5e5e5e"
  mute: "#afafaf"
  hairline-mid: "#4b4b4b"
  canvas: "#ffffff"
  canvas-soft: "#efefef"
  canvas-softer: "#f3f3f3"
  surface-pressed: "#e2e2e2"
  link: "#0000ee"
  on-dark: "#ffffff"
  black-elevated: "#282828"

typography:
  display-xxl: {fontFamily: "UberMove, UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 52px, fontWeight: 700, lineHeight: 64px}
  display-xl: {fontFamily: "UberMove, UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 36px, fontWeight: 700, lineHeight: 44px}
  display-lg: {fontFamily: "UberMove, UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 32px, fontWeight: 700, lineHeight: 40px}
  display-md: {fontFamily: "UberMove, UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 24px, fontWeight: 700, lineHeight: 32px}
  display-sm: {fontFamily: "UberMove, UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 20px, fontWeight: 700, lineHeight: 28px}
  body-lg: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 18px, fontWeight: 500, lineHeight: 24px}
  body-md: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 16px, fontWeight: 400, lineHeight: 24px}
  body-md-strong: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 16px, fontWeight: 500, lineHeight: 20px}
  body-sm: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 14px, fontWeight: 400, lineHeight: 20px}
  body-sm-strong: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 14px, fontWeight: 500, lineHeight: 16px}
  caption: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 12px, fontWeight: 400, lineHeight: 20px}
  button-large: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 18px, fontWeight: 500, lineHeight: 24px}
  button-md: {fontFamily: "UberMoveText, system-ui, Helvetica Neue, Arial, sans-serif", fontSize: 16px, fontWeight: 500, lineHeight: 20px}

rounded:
  none: 0px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 999px
  pill-tab: 36px
  full: 9999px

spacing:
  xxs: 4px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  3xl: 32px

components:
  nav-bar: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body-md-strong}", padding: "{spacing.lg} {spacing.3xl}"}
  nav-link: {textColor: "{colors.ink}", typography: "{typography.body-md-strong}"}
  button-primary: {backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", typography: "{typography.button-md}", rounded: "{rounded.md}", padding: "{spacing.md} {spacing.md}"}
  button-secondary: {backgroundColor: "{colors.canvas-soft}", textColor: "{colors.ink}", typography: "{typography.button-md}", rounded: "{rounded.md}", padding: "{spacing.md} {spacing.md}"}
  button-subtle: {backgroundColor: "{colors.canvas}", textColor: "{colors.hairline-mid}", typography: "{typography.button-md}", rounded: "{rounded.md}", padding: "{spacing.md} {spacing.lg}"}
  button-floating: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.button-md}", rounded: "{rounded.md}", padding: "{spacing.md}"}
  button-large-rounded: {backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", typography: "{typography.button-large}", rounded: "{rounded.xl}", padding: "{spacing.lg} {spacing.xl}"}
  button-tab-translucent: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body-md-strong}", rounded: "{rounded.pill-tab}"}
  text-input: {backgroundColor: "{colors.canvas-soft}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.none}", padding: "{spacing.lg}"}
  text-input-on-soft: {backgroundColor: "{colors.canvas-softer}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.none}", padding: "{spacing.lg}"}
  card-content: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  card-elevated: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  card-soft-tinted: {backgroundColor: "{colors.canvas-soft}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  promo-card-illustrated: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.display-md}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  promo-card-on-dark: {backgroundColor: "{colors.ink}", textColor: "{colors.on-dark}", typography: "{typography.display-md}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  request-form-card: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.xl}", padding: "{spacing.lg}"}
  request-form-input-row: {backgroundColor: "{colors.canvas-soft}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.none}", padding: "{spacing.lg}"}
  category-button: {backgroundColor: "{colors.canvas-soft}", textColor: "{colors.ink}", typography: "{typography.body-sm-strong}", rounded: "{rounded.md}", padding: "{spacing.sm} {spacing.lg}"}
  faq-row: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body-md-strong}", padding: "{spacing.lg} 0"}
  app-download-pill: {backgroundColor: "{colors.ink}", textColor: "{colors.on-dark}", typography: "{typography.body-md-strong}", rounded: "{rounded.pill}", padding: "{spacing.md} {spacing.xl}"}
  hero-band-light: {backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.display-xxl}", padding: "{spacing.3xl} {spacing.3xl}"}
  hero-band-dark: {backgroundColor: "{colors.ink}", textColor: "{colors.on-dark}", typography: "{typography.display-xxl}", padding: "{spacing.3xl} {spacing.3xl}"}
  showcase-image-card: {backgroundColor: "{colors.ink}", textColor: "{colors.on-dark}", typography: "{typography.display-xxl}", rounded: "{rounded.xl}", padding: "{spacing.3xl}"}
  link-blue: {textColor: "{colors.link}", typography: "{typography.body-md}"}
  link-on-dark: {textColor: "{colors.on-dark}", typography: "{typography.body-md}"}
  link-mute: {textColor: "{colors.hairline-mid}", typography: "{typography.body-md}"}
  link-mute-soft: {textColor: "{colors.mute}", typography: "{typography.body-md}"}
  icon-button-circular: {backgroundColor: "{colors.canvas-soft}", textColor: "{colors.ink}", rounded: "{rounded.full}"}
  footer: {backgroundColor: "{colors.primary}", textColor: "{colors.on-dark}", typography: "{typography.body-sm}", padding: "{spacing.3xl} {spacing.3xl}"}
  ex-pricing-tier: {backgroundColor: "{colors.canvas-soft}", textColor: "{colors.ink}", borderColor: "{colors.surface-pressed}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  ex-pricing-tier-featured: {backgroundColor: "{colors.ink}", textColor: "{colors.on-primary}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  ex-product-selector: {backgroundColor: "{colors.canvas-soft}", rounded: "{rounded.none}", padding: "{spacing.2xl}"}
  ex-cart-drawer: {backgroundColor: "{colors.canvas}", rounded: "{rounded.xl}", padding: "{spacing.2xl}", item-divider: "{colors.surface-pressed}"}
  ex-app-shell-row: {backgroundColor: "{colors.canvas}", activeIndicator: "{colors.primary}", rounded: "{rounded.md}", padding: "{spacing.md} {spacing.lg}"}
  ex-data-table-cell: {headerBackground: "{colors.canvas-soft}", headerTypography: "{typography.body-sm-strong}", bodyTypography: "{typography.body-sm}", cellPadding: "{spacing.md} {spacing.lg}", rowBorder: "{colors.surface-pressed}"}
  ex-auth-form-card: {backgroundColor: "{colors.canvas-soft}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  ex-modal-card: {backgroundColor: "{colors.canvas}", rounded: "{rounded.xl}", padding: "{spacing.2xl}"}
  ex-empty-state-card: {backgroundColor: "{colors.canvas-soft}", rounded: "{rounded.xl}", padding: "{spacing.3xl}", captionTypography: "{typography.body-md}"}
  ex-toast: {backgroundColor: "{colors.canvas}", rounded: "{rounded.xl}", padding: "{spacing.md} {spacing.lg}", typography: "{typography.body-sm}"}
---

# Uber-inspired visual design, adapted for FunRoads

This document captures the supplied *Uber-inspired interpretation*, not Uber's
official brand or a license to use Uber's name, illustrations, logo, or fonts.
`design-plan.md` preserves the earlier FunRoads implementation notes.
`HANDOVER.md` records the implemented frontend. `PLAN.md` includes historical
planning notes. UI refinements below reflect the user's approved implementation;
this document alone does not authorize further work.

## Visual grammar

The page is a restrained black-and-white duet. White carries browsing,
typography and the map controls; black anchors primary actions. Avoid a
second brand accent, gradients, dense shadows and atmospheric decoration.
On the map, distinguish routes with line weight, dashes, patterns, labels,
and selection contrast, not color alone. Browser-default blue is for
ordinary text links, not a new decorative theme. Preserve required map
attribution and safety/error contrast even when that overrides brand styling.

Action buttons and removable filter chips use consistent 8 px rounding, not
999 px pills. Grouped filter choices use 8 px buttons inside a 12 px soft-gray
container. Cards, floating bars and popovers use 16 px rounding. Circular map
controls and favorite stars are intentional exceptions: a subtle 28–32 px visual
inside a minimum 44 px hit target. Noninteractive badges may retain pill shapes.
Text inputs are
square in the supplied tokens, although the prose describes an 8 px input;
the token definitions above take precedence. The 36 px tab rounding and
16 px large-form CTA are documented exceptions. Use the attached spacing
scale, with ~1200 px centered content, 32 px desktop gutters, 16 px mobile.
Keep card shadows for raised request surfaces and floating controls, not
every result.

Sentence-case display headlines use the 700-weight display family; body
and controls use the 400/500-weight text family. The specified UberMove
families are proprietary: **do not ship or fetch them without a license**.
Use an openly licensed Inter 700 display and Inter 400/500 text substitute,
or the system sans stack, until a font license is documented. Do not claim
the substitute is UberMove. No letter-spacing flourish or all-caps headline;
uppercase belongs only to small eyebrows.

Use black primary/soft-gray secondary/transparent tertiary actions; in a route
browser, "Explore routes" or the selected route's valid export is the
primary action, not Uber's pickup form, prices, signup, app download or
marketing conversion. Editorial 4:3 imagery is optional only when it
helps explain a driving area and has a clear license. Do not invent
rider/driver art or include mock pricing, commerce, or unsupported features.

## Component and layout direction

Prefer Uber's open-source **Base Web** (`baseui`) React components with its
supported Styletron setup for the UI controls. Build a small Base Web light
theme using the tokens above. Use its buttons, inputs, select, tabs, drawers,
popovers, alerts, sliders, and accessible focus management before writing
new component chrome or bespoke CSS. MapLibre remains the geospatial canvas
and uPlot the profile visualization: neither comes from Base Web. The
existing `web/` static dark prototype is reference behavior only and must
be migrated, not layered under Base Web styling. Do not import Uber product
branding or claim Base Web reproduces Uber's public marketing site exactly.
Official library: https://github.com/uber/baseweb ;
setup: https://baseweb.design/getting-started/setup/ .

All screens use a full-viewport map and floating name, without a white top bar,
marketing subtitle or Hide/Show list button. A 12/16 px, 500-weight country
control sits beneath FunRoads, left-aligned and independent of Browse.
Its chevron and standard underline on hover/press indicate interaction,
without a background box. Preserve a transparent 44 px touch target,
visible keyboard focus, and focus return from the country menu.
Desktop Browse floats at the bottom left.
Its open panel is 26.25 em wide and 52 em tall, capped by the available viewport
and narrowed when necessary to leave the preview lane clear. Its closed handle
is 15 em wide. Keep it open during desktop selection, panning and map-information
use; only deliberate dismissal closes it. Below 1320 px hide it while full
details are open, then restore its previous open state and scroll position.
Details float above the map in a 16 px rounded panel, 320–420 px wide,
at most 900 px tall and vertically centered on the right.
Reserve the right-hand map-control lane; wider screens retain both bounded panels
instead of stretching reading columns across the map. Fit explicit selections
around measured left/right/bottom overlays, not a guessed size or treating a
tall left panel as bottom padding. Stack information and zoom at the top right.
A bottom floating "Browse routes" bar opens one results surface containing
search, discovery controls and results. It has only open/closed states, not
multiple expansion steps. On phones, map taps and drags close results. Selected routes
get a spaced preview with name/stats above a separate actions row. On phones,
selecting a result fits the map and collapses Browse rather than opening details
immediately. Every desktop result selection also stays in compact preview until
Details is explicitly requested. Desktop previews and overlap choosers share a
fixed bottom-right position with responsive breathing room above the bottom edge.
Result cards, selected previews, similar routes and overlap choosers show the
score gauge and value first in their metadata row, before length, route time
and home distance. Retain the sprint road-average
score label rather than implying a whole-route total.
Overlap chooser cards use separate type, name and metadata rows in the same
order as Browse. Do not wrap the type and metadata together into one row.
There is no Fit route action; selection already fits the route.
"Back to results" restores the same list position and filters;
"Details" is deliberate, and closing it returns to the map preview.
Browse hierarchy is search, a compact home/ranking/Filters row, result count,
then three independently selectable route-family buttons and result cards.
Home choices show only the place names. Ranking offers driving-style tiles and
other sort choices; balance/landscape/winding-road/leaf outline symbols distinguish
Balanced/Scenic/Technical/Quiet. Symbols always accompany text.
Ranking choices apply live without closing the popup; Close, Escape and outside
clicks dismiss it.
Mobile details are an inset modal card with 12 px outside spacing, safe-area
allowances and 16 px corners. Visible map edges provide context; the background
remains inert. Details use a fixed header: kind/swatch on the left, GPX export,
favorite and close X on the right, with 44 px targets. Navigate occupies a fixed bottom row.
Only the middle content scrolls, with thin rounded scrollbars and quiet 1 px
dividers. Inset the scrolling body by 8 px, with 8 px internal padding, so the
thumb does not touch the card outline while text keeps its 16 px alignment.
Use the same subtle scrollbar across the app, including menus and popovers:
6 px rounded light-gray (`#dedede`) thumbs, transparent tracks and a slightly
darker (`#c4c4c4`) hover. Honor system colors in forced-color mode.
Inset the Browse scrollbar by 2 px while preserving its 16 px content alignment.
Navigate uses soft-gray fill and 8 px corners. Header export, favorite and close use
matching 20 px bare icons, without circles or background fills, spaced 4 px
apart. Give the close glyph a 2 px stroke to balance the saved star.
Keep invisible 44 px hit areas and clear hover/focus; a filled star shows saved
state. Result-card favorites retain their circular outline.
Save feedback is a fixed, centered floating top banner with a three-second
lifetime, never a footer or flex item that resizes the map. Bound its width and
place it below phone header actions; retain polite status announcements.
Close details preserves route selection, filters and return context.
The export icon sits immediately left of favorite. Share the complete ordered
route geometry as a GPX 1.1 track through native file sharing when supported;
otherwise download a `.gpx` file. Use capability-appropriate "Share GPX" or
"Download GPX" labels and icons. Cancelling sharing does not download anything.
Do not promise a direct Sideways launch or exact third-party import behavior.
Navigate opens Google Maps,
identified in its accessible label and tooltip; returning already restores the
selected map route, so there is no duplicate "Show on map" action.
Mobile and desktop request the same route with up to nine intermediate points.
Mobile guidance explains that a browser may retain only three points and asks
users to open Maps and check the route before driving. Updates apply on refresh
or open, not periodic polling or unsolicited mid-session reloads. Keep the manual
"Check for updates" action inside Map information → App and data.
Keep the summary first: route name/type, fun score, length, estimated route
drive time and straight-line distance from the selected home, in that order.
Heads-up and route flags
sit directly below the summary description, not between disclosures.
Then show driving character, profile and road composition. Speed-limit shares
live in a compact grid inside road composition, not a dense summary row.
Roads use the same card styling as similar routes, with gauge and length icons.
Where a matching sprint shares the current route's line, clicking the road opens
its compact map preview, not full details. Do not link an unrelated same-name road
or fabricate a route for roads without standalone geometry. Gray out and
disable road cards without a matching standalone sprint, keeping text readable.
Keep practical measurements in "Route facts". Put source attribution, links and
country-wide caveats in the separate collapsed "Data sources and limitations"
disclosure, not repeated in "Why this route", which describes route character
and traits. Keep score breakdown and
sources lower down, then "Before you drive", with similar routes last. Navigate is the only navigation
action; omit a separate navigation-options disclosure. Preserve access/turnaround caveats
and truthful route-shape labels, without a large warning card ahead of the summary.
Do not expose raw sample-departure lists or nested validation cards in route
details. "Before you drive" contains only concise, practical access, turnaround
and endpoint guidance; sampled data must never be presented as live permission.
Nearby filtering uses a "Limit distance" toggle and straight-line radius slider,
not a country selector. Filters have separate Route/More views, a bounded body,
thin rounded scrollbar and fixed Reset/Done actions. Route contains favorites,
distance, length, minimum fun (0–100) and route time; More contains optional
scenery/quiet/corner thresholds. Do not expose sampled-departure filtering.
Favorites only belongs in Filters, with an active chip when enabled.
Result-card stars have a subtle circular outline to
signal clickability while retaining their generous invisible touch target.
Result-card titles use Inter 500 at 16/22 px. Compact 12/18 px metadata uses
score, route, clock and home icons with accessible labels. Home distance has no
visible "direct" suffix; its accessible label and tooltip explain straight-line,
never driving distance. Missing home
distances say "Distance unknown"; never substitute area names in that field.
Avoid repeating
loop descriptions already conveyed by the route type.
Do not repeat "Ends elsewhere" or other route-shape descriptions on Browse cards;
keep shape explanations in details and meaningful route-family filter choices.
Do not repeat "Legal turnaround required" on sprint result cards; retain the
practical turnaround guidance in route details.
Reuse the same route-type line samples, small map-matching swatches, and
14 px route/clock/home/gauge/road-sign outline icons across results, overlap chooser, previews,
details and similar routes. Symbols supplement readable text, never replace it.
Keep overlap percentages inside road composition, not result cards or the summary.
All enabled actions signal interaction on hover and press. Base Web supplies
its normal hover states; custom icon controls darken their outline and gain a
soft-gray fill, with a darker pressed fill. Use 120 ms color transitions, no
scale/bounce effects, and do not rely on hover alone for touch or keyboard use.
Reserve 44 px or larger targets for all map controls and controls within
the sheet; keep escape/back, focus return, labels and reduced-motion behavior.

Use short, sentence-case labels consistently: "Browse routes", "Close results",
"Details", "Save"/"Saved", "Reset filters", and "Done".
Do not use em dashes in UI text. Use small arrows (`→`) between place names,
commas or separate sentences in prose, and `~` only for approximate values.
Keep source catalogue names and route identities unchanged; normalize display
names consistently across results, search, previews, details and saved routes.
Clear selection with a
blank-map tap or Escape, not a redundant button in the preview. Distinguish
time on a route from travel to its start. Do not estimate driving minutes from
straight-line distance; home-to-route time filtering remains deferred until
the catalogue has modeled reach times from both Zaandam and Haarlem.
Combine legend and live map attribution in one Base Web popover with intact
source links. Pointer clicks have no lingering blue outline; keyboard focus
has a visible black outline. Route overlap choosers are bounded inside the
map, fill the mobile width with equal 12 px outside margins, scroll when needed,
and include type, distance and duration. Touch/narrow
screens use a 22 px hit tolerance, mouse layouts 10 px.
Shared disclosures use 250 ms transitions with a 100 ms content delay, twice
as fast as the library default. Reduced-motion preferences override animation.

The black promo bands, pill nav and editorial photos in the supplied
marketing examples are design references, **not required product features**.
Do not put a ride-request card or conversion footer on a driving discovery
tool. See `PLAN.md` for user stories, data contracts, filtering semantics,
warnings, map behavior, accessibility and QA acceptance gates.
