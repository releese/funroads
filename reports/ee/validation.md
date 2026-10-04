# Local Estonia setup validation

Checked 3 October 2026, after the move from the southern pilot to **national
coverage** (user-approved). No commit, push, deployment or external publication.

## Delivered data

- Real OSM snapshot: 2026-10-02T20:21:34Z, Geofabrik download 123,243,406 bytes
  (full-country extract, reused from the pilot).
- Real official dtm-25 terrain: **221 grid-aligned 20 km WCS tiles**
  (EPSG:3301 / EH2000, 25 m) covering the extraction boundary; 20 further
  grid tiles fully outside the DTM coverage extent (open-sea polygon margin)
  returned HTTP 400 and are recorded as absent. `_fetch` now retries transient
  5xx/connection failures (1/3/9 s backoff); a real 502 proxy error occurred
  mid-run and would have killed the pilot-era code path.
- Teeregister (Transpordiamet WFS, native EPSG:3301): **101,805 surface
  records (`n_kate`, 103 pages) and 10,727 speed-limit records
  (`n_kiiruspiirang`, 11 pages)** over the national bounds. Overlapping
  OID-sorted paging + dedupe + count-vs-hits check as before. Rights caveat
  preserved in the manifest (`AccessConstraints=private` vs no-conditions
  catalogue metadata); used locally at the owner's request.
- Coverage: Geofabrik `estonia.poly` extraction boundary, WGS84 bounds
  [20.85, 57.49, 28.22, 60.0]. The pilot's 5 km inward buffer is gone (it
  would have deleted every border town and coastline); ways must lie inside
  the extraction boundary (+1 m float margin), cutting 152 cross-border stubs.
- **790 published routes: 5 circuits, 701 reversible sprints, 74 linked open
  rides and 10 linked loops** (the pilot had 119: 2/105/12/0).
- All 5 circuits pass the retrace gate (0.0–0.181, limit 0.20): Viljandi —
  Rõngu 72.2 km, Võru — Kuigatsi — Tõrva 53.2 km, Paunküla — Vetla 50.1 km,
  Tartu — Jõgeva — Aravete 45.9 km, Sihva — Vidrike — Kärgula — Järvere
  30.5 km. The gate rejected **110 of 116** closed candidates as out-and-backs.
- The pilot-concession 10 km circuit soft minimum was removed; Estonia uses
  the standard 25 km rubric gate like the Netherlands.
- 14,259.1 km eligible physical road network (pilot: 1,164.0 km); 52,604 nodes
  and 87,967 directed edges; terrain coverage **87,967/87,967 (100%)**;
  unknown speed/surface on retained edges: 0/0.
- 2,934 weak components (islands and rural fragments; ferries are excluded),
  largest 7,056 nodes.
- Teeregister recovered speed evidence on 13,834 directed edges (4,661 OSM
  ways) and surface on 2,779 edges (936 ways). Confirmed register gravel/earth
  stays excluded: 156,562 segments / 8,423.7 km. Still dropped for missing
  evidence: 99,175 unknown-surface segments (3,709.2 km) and 156,139
  unknown-speed segments (5,502.2 km).
- Circuits carry straight-line Tallinn/Tartu distances as before.
- Both pairs packaged under `site/data/{nl,ee}/`, with country/version metadata,
  provenance, source licences and integrity-checked service-worker entries.

## Automated checks

- `PYTHONPATH=src` and `.venv\Scripts\python.exe -m pytest -q`:
  **112 passed, 3 skipped** (the 3 skips are the pre-existing opt-in
  network/slow tests; the Estonia terrain test runs against the real national
  tiles). `tests/test_estonia.py`: 9/9.
- `npm run typecheck`: passed.
- `npm test`: **95 Vitest tests** (including the real national Estonia
  catalogue integration test) **and 6 Node tests passed**.
- `npm run build`: passed, including the build/package/integrity test.
- Repeated `route --country ee` generation produced byte-identical
  `routes.json` and `linked.json`
  (routes `65c65c01…6e60a845`, linked `e0615b31…f439a1b3`).
- Dutch catalogue hashes unchanged
  (routes `9ab4b607…22963`, linked `cf2a1c0a…345e2`).
- Source SHA-256 and catalogue SHA-256 are in the manifest and quality report.

## Browser checks

Production preview at `http://127.0.0.1:5174/`, using the embedded browser
(service-worker registrations/caches reset in page context first, as the app
deliberately does not activate a new worker over an open tab):

- Estonia loads **790 routes** ("790 routes match").
- Deep link `?country=ee#route=ee%3Acircuit%3Aarea-041-main` opens the
  Viljandi — Rõngu Circuit preview and, after Details, shows
  "Straight-line from Tallinn: 168.9 km" and "Length: 72.2 km" — matching the
  catalogue — with no out-and-back warning.
- Teeregister and Maa- ja Ruumiamet attribution present in the page DOM.
- Default Netherlands unchanged: 3,853 routes.
- Northern coverage confirmed in data (sprints near Kehra/Hara/Valingu;
  northernmost route point lat 59.65).

### Browser harness limitations

Verification used DOM/text assertions; pixel-level screenshot comparison was
**not** completed (earlier harness timeouts). Basemap tiles are deliberately
not cached.

## Setup/run

The full commands are in `web/COUNTRY-DATA.md`. Existing local dependencies:

```powershell
Set-Location C:\Users\risto\funroads
$env:PYTHONPATH = "$PWD\src"
.\.venv\Scripts\python.exe -m funroads all --country ee
Set-Location web
npm run build
npm run preview -- --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174/?country=ee`. A full national run took about
12 minutes here (fetch ~2.5 min with cached OSM, prepare ~7.5 min, the rest
~2 min). The test server was stopped after QA; the embedded browser itself was
not closed.

## Remaining limits

Ferries are excluded, so island networks are separate components with
straight-line (not driving) home distances. No ETAK vector, population,
AKS/KNR or DATEX source is integrated or claimed. 3,709 km unknown-surface and
5,502 km unknown-speed segments remain excluded after register matching.
Conditional access is excluded; unmapped restrictions can still exist. The
node-only router cannot model arbitrary via-way turns (63 ways excluded).
Terrain is coarse ground, not road-deck surveying; width is unknown on 86,777
of 87,967 edges; quiet is an OSM proxy, not traffic counts. Safe
parking/turnaround and live access are not verified. Teeregister's
redistribution terms remain officially contradictory; the local use note
travels in the manifest and published metadata.

Raw inputs (~803 MB), pipeline/configuration, Python tests and reports remain
Git-ignored as requested. Preserve them when backing up/transferring this local
setup. Mutable download URLs cannot guarantee the same bytes on a fresh later
download; retain the local raw inputs and manifest for exact reproduction.

## Close-out follow-up, 4 October 2026

See `reports/ee/acceptance-20261004.md` for the latest checked evidence and
`reports/ee/acceptance-20261004/` for screenshots, detail geometry and a mobile
accessibility audit. Python remains 112 passed / 3 skipped; frontend is now
97 Vitest + 6 Node tests, with typecheck/build/package integrity passing.
All four source hashes and their packaged counterparts remain unchanged.

Place-name em dashes now display as arrows without changing source data or
route identities. Mobile screenshots succeeded; wide-pane capture duplication
still prevents claiming a clean desktop pixel baseline. Teeregister release
clearance and physical-device navigation/offline acceptance remain unresolved.
The Google Maps dynamic handover proposal is local and not implemented:
`reports/ee/google-maps-handover-plan.md`.

### Subsequent navigation trial, 4 October 2026

Implementation is in progress, not accepted. The user rejected splits and
requested a whole-loop desktop Maps trial, which retained nine intermediate
destinations and computed 74.4 km for the 72.2 km Viljandi → Rõngu catalogue
route. See `acceptance-20261004-maps-test.md` for the exact trial and partial
automated results, including the unresolved mobile chooser focus failure.
Earlier acceptance evidence remains intact. Physical-device retention and
road-by-road fidelity remain untested/unaccepted.

### Final single-link navigation close-out, 4 October 2026

The work-in-progress status above is superseded. The user rejected splits;
the chooser and stage builder were removed. One shape/length-aware Maps URL
now requests each whole route, up to 9 desktop/3 compact intermediate points,
with unchanged identities, endpoints and catalogue hashes. A visible
accessible caveat discloses point limits, stops/snapping/rerouting and lack
of exact fidelity. See `acceptance-20261004-maps-handover.md`.

Final automated results: 113 Vitest + 6 Node passed, typecheck, build and
separate package integrity passed; Python baseline 112 passed/3 skipped.
Both country pairs under `site/data/{nl,ee}/` match the source hashes.
Measured target misses: NL desktop 328/3,853, compact 1,091; EE desktop
52/790, compact 241. One URL per route; max 492 encoded characters.
The final Viljandi desktop link retains nine intermediate points and yields
71.6 km. The user confirmed the adjusted trial's unwanted hook disappeared
and its visual shape appeared to match the original app line.

Nineteen browser detail-layout checks passed. Mobile/desktop Escape preserves
selection and return context. Scoped desktop axe: zero violations/incomplete;
compact: zero violations, one incomplete contrast determination.
Physical Android/iOS retention and road-by-road fidelity remain unvalidated,
especially for long compact requests. Preview remains locally running for
inspection; ownership/reproduction details are in the acceptance report.

### Shared circuit-spur cleanup, 4 October 2026

User-approved scope changed: the shared pipeline builder now removes exact
reverse-edge pairs and >=80% geometrically retracing closed side excursions.
This uses the existing 25 m/opposing-heading check and preserves genuine loops
and the specified start. Collapsed exact out-and-backs are rejected.

Only existing published circuits were rebuilt, with no reranking, ID/name/start
changes, sprint changes or linked-file changes. EE affected circuits are now
71.8 km/60 min and 45.6 km/39 min; both retrace 0. The longer pictured tail
is fully removed. Five Dutch circuits also lost spurs. Counts remain 790 EE
and 3,853 NL; graph/features/scores/rubric/raw inputs/manifest unchanged.

119 Python passed/3 skipped; 113 Vitest + 6 Node passed; typecheck, build and
integrity passed. Browser checks verified both corrected EE circuits and one
corrected NL circuit, including the bounded single Navigate URL. The original
NL browser probe used a wrongly namespaced link and timed out; rerunning with
the preserved legacy `circuit:...` key passed. A staging replay timeout and
duplicate-anchor mismatch were fixed before any catalogue replacement.
No new physical-device Maps trial or axe audit. All new evidence and
backup/hash details: `reports/circuit-cleanup-20261004/README.md`.
