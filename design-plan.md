# FunRoads NL — earlier design notes (preserved)

## Status: UI deferred (2026-09-27)

Decision: get the data core right and accurate first. The UI waits.

What already exists (built early, now parked):
- `web/` — single-page map app (MapLibre 5.9.0, uPlot 1.6.9, CARTO dark basemap),
  built against `web/routes.example.json`. Filtering, re-ranking, hover sync,
  elevation/curvature profile drawer, corner markers, comet animation, 375px layout.
- `dist/demo.html` — self-contained demo render of the above.

Open UI items when we resume:
1. Browser QA with real `routes.json` (earlier screenshot capture failed, CDP error
   10060 — verify visually with agent-browser before shipping).
2. Contract: `route.py` must emit the `routes.json` schema exemplified by
   `web/routes.example.json` (routes[], areas[], toproads[], meta, home; per-route
   line/seg/elev/curv/corners/stops/roads/score/why/links).
3. `render.py` — Jinja2 step inlining CSS/JS/data into `dist/index.html`.
4. GPX/KML/Google Maps links per route (`export.py` writes files, UI links to them).

## Core pipeline (the focus now)

fetch → graph → features → score → calibrate → route → linked → export → (render, deferred)

`linked` builds a separate nationwide catalogue of rides joining two high-fun
stretches using bounded directed-road searches (`data/cache/linked.json`).
Its 100 km Zaandam/Haarlem views and scenic/technical/quiet rankings filter
completed rides only, never the national stretch eligibility. UI remains deferred.

Accuracy principles:
- Absolute rubric anchors, no national percentiles (flat country must not look hilly).
- Never reward exceeding the limit: engaged corner = comfortable corner speed below
  the legal limit; speed dimension rewards 60–80 km/h flow.
- Validate every algorithm on synthetic ground truth and named real roads.
- Deterministic: pinned inputs (data/manifest.json), stable tie-breaks, hash-checked
  route output.
