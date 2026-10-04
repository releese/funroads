# FunRoads vs AllTrails — gap analysis and tiered 80/20 proposal

Date: 2026-10-03. Status: analysis document, no code changes.

Scope: compare the current FunRoads NL app (React/Base Web frontend over
static generated JSON, national pipeline for circuits/sprints/linked rides)
against AllTrails' mature trail-discovery product. Identify what AllTrails
does better, what FunRoads already does better, and a tiered proposal
ordered by 80/20 leverage, UI first, with backend dependencies called out.

---

## 1. What FunRoads already does better

Be honest: FunRoads is not behind on everything. Some of its strengths are
things AllTrails users routinely complain about.

- **Objective, reproducible scoring.** Every route carries a rubric with
  absolute anchors (corners 0.30, flow 0.15, quiet 0.15, speed 0.15,
  elevation 0.10, surface 0.10, scenery 0.10) and hard legality gates.
  AllTrails' "difficulty" is a coarse 3-bucket heuristic and its star rating
  is crowd noise; FunRoads can say *why* a route is fun, per dimension, and
  defend it. The dimension breakdown in `RouteDetail.tsx` is genuinely
  better than anything AllTrails shows.
- **Legality as a first-class constraint.** Sprints require both directions
  high-fun in a shared sampled access window; connectors are capped;
  retrace share is measured. AllTrails happily routes you across a posted
  closure and lets reviews sort it out. FunRoads' conservative access
  windows are a trust asset — if communicated well.
- **Route-form honesty.** Circuit vs linked-open vs linked-loop vs sprint is
  a real typology with different algorithms, not a marketing label. The
  `KIND_SHAPE` descriptions in `web/src/data/model.ts` are clearer than
  AllTrails' loop/out-and-back/point-to-point, which regularly mislabels.
- **No dark patterns.** No ads, no engagement bait, no fake urgency. The
  DESIGN.md restraint is a differentiator if the content underneath it is
  trustworthy.
- **Working discovery at scale.** 3,300+ routes with filters, search, map
  sync, favorites, mobile sheet — the skeleton is real and tested
  (103 Python + 48 Vitest passing).

The strategy below therefore focuses on **trust, freshness, and take-out** —
the places where AllTrails converts browsers into users who actually drive
the route — rather than on rebuilding discovery.

---

## 2. What AllTrails does better (the critical gaps)

Ordered by how much each gap costs FunRoads a user who found a route and is
deciding whether to drive it this weekend.

### 2.1 Critical — the route never leaves the app

AllTrails' entire product is built around one moment: the user standing at
the trailhead, phone in hand, route loaded. Everything (offline maps,
off-route alerts, GPX export, "Get directions") serves that moment.

FunRoads today:

- `export.py` does not exist. `exports.json` is an empty manifest; the
  GPX/KML buttons in `RouteDetail.tsx` are gated on it and therefore dead
  for every route. PLAN.md lists this as outstanding item #1.
- The only way to take a route out is a Google Maps link (8-waypoint
  desktop, 3-waypoint compact fallback). That is a good humble choice —
  AllTrails does the same for trailheads — but it is the *only* choice.
- No evidence the start/end points are usable: "Endpoint policy — start/end
  pins are graph endpoints, not verified parking/turning/meeting points"
  (HANDOVER.md outstanding #8). For a driving app this is the equivalent of
  AllTrails dropping you at a trailhead with no parking.

**Why it is critical:** a route you cannot export, verify, or navigate to is
a screenshot, not a plan. This is the single largest gap.

### 2.2 Critical — nothing is fresh, and the app knows it

AllTrails' killer content feature is structured freshness: recent-conditions
strips ("muddy in sections as of 2 days ago"), "last reviewed N days ago",
condition tags on every review. Users trust the catalog because they can see
it being maintained.

FunRoads today:

- All inputs are pinned snapshots; `meta.generated` is the source-data
  snapshot time, not even a build time. The UI shows sampled access windows
  with caveats, which is honest — but there is no positive freshness signal
  anywhere. No "data as of", no per-route verification date, no way for
  anyone (even the maintainer) to flag "this road is now chipsealed / closed
  / resurfaced".
- `reports/calibration.md` is stale, which means even the maintainer's own
  quality evidence is out of date.

**Why it is critical:** roads change constantly (resurfacing, new speed
limits, 30 km/h zones, closures). A driving-fun catalog without any
freshness story decays into a liability, and the rubric's authority erodes
with it. AllTrails solved this with crowdsourcing; FunRoads can start with
something far cheaper (see Tier 1).

### 2.3 High — the detail page informs but does not convince

AllTrails' detail page is the center of gravity: hero photos, interactive
elevation profile, reviews with structured tags, nearby trails. It answers
"is this worth my Saturday?" in five seconds.

FunRoads' `RouteDetail.tsx` is informationally dense but visually austere:

- **No photos at all.** Not one. For a product whose entire premise is
  "this road is fun to drive", there is no visual evidence of the road.
  AllTrails understood that the photo of the trailhead parking lot is worth
  more than the description.
- Charts (uPlot elevation/curvature) exist only for circuits — linked rides
  and sprints get none, per the PLAN.md contract table.
- No "routes nearby" / "similar routes" rail. Selecting a route is a
  dead end; AllTrails always offers the next candidate.
- The scored dimensions are shown but the verdict ("should I drive this?")
  requires reading. AllTrails' difficulty chip + rating + photo strip
  answers it at a glance.

### 2.4 High — discovery is filter-first, not answer-first

AllTrails' home screen assumes geolocation and shows trails near you
immediately; its curated guides ("Best waterfall hikes near Denver") are
both an SEO engine and a browsing mode for people who don't know what to
filter for.

FunRoads today:

- Two fixed homes (Zaandam, Haarlem). Reasonable for a personal project,
  but "nearby (100 km)" is straight-line distance from one of two towns,
  with no geolocation, no municipality search (search index = 9 circuit
  areas + road names), and no address input.
- No curated entry points. The `profiles` in `linked.json` (scenic /
  technical / quiet top-12 lists) already exist in the data but surface only
  as badges on a detail page, not as browsable collections. This is the
  cheapest SEO/discovery win available.
- Profile presets (balanced/scenic/technical/quiet) are filter shortcuts,
  not destinations. AllTrails' guides are destinations.

### 2.5 Medium — no personal loop back into the app

AllTrails' retention hooks: saved lists, completion check-ins, personal
stats, the "scratch map" of visited trails. Cheap to build, powerful for
return visits.

FunRoads has favorites (localStorage, content-hash-keyed) — a good start —
but:

- Favorites break silently on regeneration (outstanding #6: stable route
  identity). The name-memory mitigation exists, but the underlying identity
  problem means any saved-route feature is built on sand.
- No "driven it" state, no history, no stats, no lists beyond one flat
  favorite set.

### 2.6 Medium — no community signal at all

AllTrails' reviews, photos, and completions are its content moat. FunRoads
has zero user-generated content and no plans for any. This is partly a
feature (no moderation burden, no social-network distraction) and the
objective rubric compensates — but it means the app cannot benefit from the
single most effective freshness and trust mechanism AllTrails has.

This analysis treats full community features as **out of scope** (they
violate the 80/20 rule at this project's scale) and instead picks the
minimal viable substitutes: maintainer-curated verification and
structured condition notes.

### 2.7 Low — web-only, no offline, no companion app

AllTrails' mobile app (offline maps, GPS recording, off-route alerts) is
where retention and paid conversion happen. FunRoads is a static web SPA.

For a driving app this matters less than for hiking: the driver will use
Google Maps / a dedicated nav app / CarPlay for the actual driving. The
humble "Get directions" deep-link strategy is correct. **Do not build a
nav app.** The take-out formats (GPX for nav devices, Google Maps links)
cover the real need at 5% of the cost.

---

## 3. Tiered proposal (80/20)

Each tier lists UI work first, then the backend it depends on. Effort
estimates assume the existing codebase (Base Web + MapLibre + uPlot,
Python pipeline) and no new services.

### Tier 1 — Make routes takeable and datable (the 80/20 core)

*Theme: a route you can actually drive, with a date you can trust.*

| # | UI work | Backend dependency | Effort |
|---|---------|--------------------|--------|
| 1.1 | **GPX/KML export that works.** Un-gate the existing export buttons in `RouteDetail.tsx`; show file size and generated date on the download row. | **`export.py`** — already specified, reserved URLs exist, manifest plumbing (`exports.json`) already ships to the UI. Highest-leverage backend item in the repo. | M |
| 1.2 | **Visible data dating.** Add a "Road data as of {date}" line to every detail drawer and a global note in the About modal. One line of UI, huge trust signal. | Promote `meta.generated` (or a new `built_at`) into a displayed, human-readable field; disambiguate snapshot time vs build time. | S |
| 1.3 | **Start-point honesty.** On each detail page, label the start pin: "route start (graph point) — verify parking and turning on arrival". If a known-good access point exists, link it instead. | Optional later: an `access_point` field per route. Ship the honest label first with zero data work. | S |
| 1.4 | **Similar routes rail.** Bottom of `RouteDetail.tsx`: "More like this" — same kind, nearest by bbox centroid, top 5. Pure client-side over the loaded catalogue; the `RouteView` model already has everything needed. | None. | S |
| 1.5 | **Curated collections as destinations.** Turn the existing `profiles` (scenic/technical/quiet top-12) and `nearby_100km` lists into first-class views: a "Collections" entry in the rail, one page per collection, map + list. The IDs already exist in `linked.json`; this is presentation only. | None for linked profiles. Extend to circuits/sprints later. | S–M |

**Payoff:** every route becomes exportable, dated, honestly located, and a
springboard to the next route. This is the 20% of effort that closes the
critical take-out gap (2.1), most of the freshness gap (2.2), and the
dead-end detail page (2.3).

### Tier 2 — Make it fresh and findable

*Theme: structured freshness without a community, discovery without filters.*

| # | UI work | Backend dependency | Effort |
|---|---------|--------------------|--------|
| 2.1 | **Per-route verification state.** Add a maintainer-curated `verified` field (date + optional note, e.g. "driven 2026-08, surface good"). Render as a small line on the detail page: "Last verified {date}" or "Not yet verified". This is the minimal viable substitute for AllTrails' review freshness — one maintainer with a spreadsheet, not a platform. | New optional field per route in the JSON; pipeline passes it through; a simple YAML/CSV the maintainer edits by hand. | S |
| 2.2 | **Structured condition tags.** Extend the same curator file with tags: `surface: smooth/rough`, `traffic: usually quiet / busy weekends`, `seasonal: winter closure risk`. Display as chips on the detail page, and (later) as filters. AllTrails' key insight: conditions as *structured data*, not prose. | Same curator file as 2.1; schema lives in `raw.ts`. | S |
| 2.3 | **Stable route identity.** Favorites survive regeneration. Prerequisite for any saved-state feature being trustworthy. | Pipeline emits a stable ID (hash of defining roads + geometry signature, not content hash); favorites migration per outstanding #6. | M |
| 2.4 | **Municipality/place search.** Honest autocomplete over real Dutch place names, mapped to the routes that intersect them. Replaces the 9-area ceiling. | **Regional search index** (outstanding #3): gazetteer build, point/area metadata on linked/sprint records. The biggest backend item in this tier. | M–L |
| 2.5 | **"Driven" check-in.** One-tap "I've driven this" alongside the favorite star; show a count on the card and a "Driven" list view. LocalStorage-only, same storage pattern as `favorites.ts`. Cheap personal loop, no accounts. | Benefits from 2.3 but can ship before it with the same caveat favorites have. | S |

**Payoff:** the catalog starts to look alive (2.2), discovery gains a
real search box (2.4), and users get their first retention hook (2.5).

### Tier 3 — Deepen conviction

*Theme: the detail page earns the drive.*

| # | UI work | Backend dependency | Effort |
|---|---------|--------------------|--------|
| 3.1 | **Photos, starting with Street View.** A photo strip on the detail page. Cheapest honest source: linked Street View imagery at route sample points (check ToS carefully; embedding via official URLs/API only). No upload pipeline, no moderation. | Sample-point selection per route; link/embed generation. Legal review of imagery terms comes first. | M |
| 3.2 | **Charts for all route kinds.** Extend elevation/curvature profiles to linked rides and sprints where geometry exists, per the PLAN.md contract table. | Pipeline emits `elev`/`curv` for linked and sprint records; UI conditionals already exist. | M |
| 3.3 | **Endpoint evidence.** Verified access points (parking, turning) for the top routes, replacing the generic honesty label from 1.3 where data exists. | Manual curation for top ~50 routes; new `access_point` field. | M (ongoing) |
| 3.4 | **Comparable reach fields.** One "getting there" number for every route kind, enabling a unified reach filter. | Outstanding #4: emit `distance_km` for circuits and/or `reach_min` for sprints/linked. | M |
| 3.5 | **Refresh calibration evidence.** Regenerate `reports/calibration.md` so the rubric's public claims match the current catalog. Link it from the About modal as the "how scoring works" deep-dive. | Re-run calibrate step; update report. | S |

### Explicitly not proposed

- **Reviews, ratings, photo uploads, follows, feeds.** AllTrails' moat, but
  a moderation and scale burden that violates 80/20 for this project. The
  rubric + maintainer curation is the chosen substitute.
- **GPS recording, offline maps, native app, CarPlay.** Wrong layer; the
  Google Maps deep-link strategy is correct for a driving tool.
- **Live traffic/weather/closure data.** Contradicts the pinned-snapshot
  honesty model and adds a service dependency. Display dating and condition
  tags deliver most of the trust at none of the operational cost.
- **Accounts/sync.** LocalStorage favorites + check-ins cover the personal
  loop until there is evidence users need cross-device state.

---

## 4. Suggested sequencing

1. **Tier 1 first, and 1.1 (`export.py`) before anything else** — it is the
   only gap where the UI already promises something the backend cannot
   deliver, and PLAN.md already lists it as outstanding work.
2. 1.2 and 1.3 are near-zero-cost trust wins; batch them with 1.1.
3. 1.4 and 1.5 are pure frontend on existing data; batch them next.
4. Tier 2 items 2.1/2.2 (curated verification + condition tags) are the
   highest-leverage move after Tier 1: they create the freshness story
   without building community infrastructure.
5. Re-evaluate before Tier 3 with real usage: if users export routes but
   don't return, prioritize 2.5-style personal loops; if they browse but
   don't export, prioritize 3.1 photos.

## 5. What to measure

- Export clicks per detail-page view (is the take-out gap actually closing?)
- Collection page views vs filter usage (are curated destinations working?)
- Return visits with a favorite/check-in present (is the personal loop
  catching?)
- Detail-page dwell time before/after photos (Tier 3 validation)

No analytics infrastructure exists today; a minimal privacy-respecting
counter (or server-log analysis of the static host) is enough for these
four numbers.
