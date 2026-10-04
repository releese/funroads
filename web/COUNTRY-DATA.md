# Country datasets

Use the small country control beneath FunRoads, independently of Browse,
or select the dataset through the page URL:

- `?country=nl`: Netherlands.
- `?country=ee`: Estonia, national coverage from the Geofabrik extract
  (islands included; ferries are not routed). It never falls back to Dutch
  routes.

Explicit country URLs always win. Newly selected route links include the
country query parameter, so sharing does not depend on local defaults.
Without an explicit country, a manual choice is remembered in localStorage.
On a first visit, the browser's `Europe/Tallinn` timezone suggests Estonia;
`Europe/Amsterdam` and other timezones retain the Netherlands default.
This is a convenience hint, not a claim about the visitor's location. It uses
no IP service, network lookup or geolocation permission. Blocked storage does
not prevent switching countries.

Country choices are ordinary same-page links. They preserve the deployment
subpath and other query parameters, clear route/detail hashes, and load the
chosen country's default home and discovery state. Browser Back remains
available. Favorites stay in localStorage and keep country-specific keys.
The control remains available during catalogue loading or failure.

`countries.json` supplies country bounds, nearby origins, timezone, search
example, source/quiet descriptions, attribution and build input directory.
Country is independent of UI language. The existing scoring/routing
algorithms are reused. There is no geocoder.

## Files and normalization boundary

| Country | Build inputs | Published files |
| --- | --- | --- |
| Netherlands | `data/cache/{routes,linked}.json` | `data/nl/{routes,linked}.<sha256>.json` |
| Estonia | `data/ee/cache/{routes,linked}.json` | `data/ee/{routes,linked}.<sha256>.json` |

Paths above are relative to the repository root for inputs and the website root
for published files. Existing Netherlands pipeline outputs are not moved or
regenerated. Production uses content-hashed catalogue filenames, pinned in the
compiled app with integrity checks, so older code cannot silently load a newer
catalogue. Development keeps unhashed country paths and the old
`/data/routes.json` and `/data/linked.json` aliases.

Source-specific pipelines must emit this shared interchange contract:

- `routes.json`: `meta`, `routes[]` (circuits), `sprints[]`, optional `areas[]`
  and `toproads[]`.
- `linked.json`: `meta`, `rides[]`, optional `profiles` and `nearby_100km`.
- Both new-country documents require
  `"meta": { "country": "ee", "schema_version": 1 }`.
- Geometry is WGS84 `[longitude, latitude]`, never national projected metres.
- Distances/lengths are kilometres; route durations are minutes, not reach time.
- Circuit/linked scores are 0–100. Sprint `fun` and dimension scores are 0–1.
  `roads[].fun` is 0–100 for every family.
- `distance_km` keys match the configured origin names. All configured values
  must be finite and nonnegative; incomplete values remain unknown.
- `nearby_100km` uses the same origins and contains raw ride IDs.
- Sample departure labels are country-local wall time. `meta.generated` is the
  source snapshot instant. Neither establishes current permission.

Full field definitions are in `src/data/raw.ts`.
`src/data/validate.ts` validates the boundary; `buildCatalogue` in
`src/data/model.ts` converts all families to the same read-only `RouteView`.
The map, lists, filters and details consume that model, not source datasets.
The local Python adapter is `src/funroads/estonia.py` (repository-root path),
with Teeregister matching in `src/funroads/teeregister.py`. Estonia uses OSM
plus the official terrain model, supplemented by geometry-matched Teeregister
surface and base speed records (used locally at the owner's request; see the
rights caveat below). ETAK vector attributes are not used.

Legacy Netherlands metadata remains accepted. Existing Netherlands route keys
are unchanged to preserve links and favorites. Estonia keys use
`ee:<family>:<id>`, so IDs may safely repeat between countries. Favorites from
other countries are never identified or deleted as stale.

## Rebuilding the real Estonia catalogue

PowerShell, using the already installed local environment:

```powershell
Set-Location C:\Users\risto\funroads
$env:PYTHONPATH = "$PWD\src"
.\.venv\Scripts\python.exe -m funroads all --country ee
.\.venv\Scripts\python.exe -m pytest -q
Set-Location web
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174/?country=ee`; use `?country=nl` to force Netherlands.
The production build writes both pairs to `site/data/{nl,ee}/`.
For development use `npm run dev -- --host 127.0.0.1 --port 5174`.

For an environment without the installed dependencies, first run
`py -3.14 -m venv .venv`, then
`.\.venv\Scripts\python.exe -m pip install -r requirements.txt` from the repository,
and `npm ci` from `web/`. Do not recreate an existing environment unnecessarily.

Individual Estonia steps are `fetch`, `graph` (includes preparation),
`features`, `score`, and `route` (writes both interchange documents).
`linked` also regenerates both documents. Dutch calibration is not run on
Estonia. `--bbox` is rejected for these fixed, documented national bounds.

Estonia's bounds are `[20.8, 57.4, 28.3, 60.1]`, national coverage following
the Geofabrik extraction polygon (islands included). EPSG:3301 supplies metric
geometry; published lines are WGS84. Tallinn and
Tartu are city-centre straight-line origins, not modeled driving-time origins.
Time labels use Europe/Tallinn. Existing Dutch paths, metadata, IDs and origins
remain unchanged.

### Inputs and provenance

- OSM Geofabrik Estonia extract, snapshot **2026-10-02T20:21:34Z**, downloaded
  3 October 2026. ODbL: https://www.openstreetmap.org/copyright .
- Maa- ja Ruumiamet **dtm-25**, real 25 m EPSG:3301/EH2000 ground terrain,
  fetched as grid-aligned 20 km WCS tiles covering the extraction boundary
  (tiles fully outside the DTM coverage extent, i.e. open-sea margins, return
  HTTP 400 and are recorded as absent). Custom open-data
  licence, **not CC BY/CC0**:
  https://geoportaal.maaruum.ee/opendata-licence .
- Transpordiamet **Teeregister** WFS (`n_kate` surface, `n_kiiruspiirang` base
  speed limits), national pages in native EPSG:3301, downloaded 3 October
  2026 with 2-record-overlapping sorted pages and OID dedupe (plain GeoJSON
  paging loses boundary records). Rights caveat: the official catalogue
  metadata says no conditions while live capabilities say
  `AccessConstraints=private`; used locally at the owner's request, and the
  manifest keeps this note instead of assigning it another source's licence.
- The Geofabrik extraction boundary clips ways nationally; cross-border stubs
  are excluded. It is not a surveyed country border.

Raw files are under `data/ee/raw/`. `data/ee/manifest.json` records exact URLs,
retrieval times, OSM snapshot, source versions/unknown flight vintages, licences,
sizes and SHA-256. Both published JSON documents retain those notices and
code/rubric hashes. Rebuilds reuse downloaded files and reject checksum changes.
Keep these raw files and manifest to reproduce the exact snapshot: `latest`
and WCS URLs are mutable, and a historical Geofabrik filename tested during
setup returned 404. Downloading afresh later is not guaranteed byte-identical.

`reports/ee/quality.md` and `quality.json` are regenerated with measured counts,
missing fields, exclusions, connectivity and representative routes.
`data/ee/cache/route-evidence.json` links every published ID to checked graph
edges and OSM ways. Source/legal research is in
`reports/ee-source-research.md`.

### Conservative limits

Paved surfaces and speed limits come from OSM tags first; where OSM is silent,
geometry-matched Teeregister records fill the gap (12 m buffer, >= 90% line
coverage, >= 95% endpoint alignment, ref-number agreement, no ambiguous
parallel candidates). Explicit register surface codes win over its
contradictory INSPIRE category; macadam/stabilised/milled codes stay unknown,
as do time-window or extra-plate speed records. Remaining unknown values are
excluded rather than replaced by Dutch defaults. Explicit `EE:rural`/`EE:urban`
zones map to 90/50. Surface/traffic completeness is not claimed.
Quiet is a static OSM proxy without population or traffic counts; scenery
includes assembled multipolygons and holes. Terrain profiles model coarse
ground, not surveyed road/bridge decks.

Restricted/private roads, barriers, ferries, conditional tags and unsupported
directional permissions are excluded. Via-node barriers/restrictions cut only
the two adjacent segments; complex via-way turn relations still lose their
member ways because the node-only router cannot model arbitrary turns.
The whole way must lie inside the Geofabrik extraction boundary.
These gates fragment the graph and reduce coverage. All published
paths are connected; circuits/linked loops close exactly, and published
circuits must pass a geometric retrace gate (<= 0.20) so closed out-and-backs
are not labelled circuits. Circuits follow the standard 25 km soft minimum;
the 40–120 km range remains a flagged target, not a claim about every loop.
No endpoint is a verified parking/turnaround location; static OSM evidence is
not live legal permission, and external navigation can reroute.

Teeregister's empty standalone sign layer and conflicting gravel/paved
INSPIRE classifications were verified and are handled as described above.
ETAK vectors, Statistics Estonia population and AKS/KNR are not used or named
as catalogue sources. DATEX registration is not a prerequisite.

Builds fail for an incomplete country pair, wrong country metadata or an
unsupported schema version. An entirely absent optional country is not packaged.
Runtime loading still handles the two documents independently, so a network
failure on one does not hide the other.

The service worker integrity-checks and caches every **published** country pair
with the app version. Country offline readiness is false if that country's pair
is absent. Basemap tiles are not cached. Selective country-pack downloads are
not implemented; add them when multiple published catalogues justify the extra
cache lifecycle.

The published Estonia catalogue is backed by actual downloads, not contract
fixtures. `src/data/estonia.test.ts` checks the real files through
normalization, units, geometry, profiles, origin keys, navigation links and
national coverage wording. Synthetic country-contract fixtures remain test-only.

The local pipeline, configuration, Python tests, reports and `data/ee/` remain
Git-ignored according to the pre-existing ignore rules. They are deliberately
not force-added. Back up/include them separately when transferring this local
setup; a website-only Git checkout does not contain these ignored assets.
