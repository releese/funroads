# Estonia data quality

Coverage: Estonia, national, clipped to the Geofabrik extraction boundary.
WGS84 bounds: `(20.85, 57.49, 28.22, 60.0)`. Metric processing: EPSG:3301; heights: EH2000.
OSM snapshot: 2026-10-02T20:21:34Z. Terrain: real 25 m DTM, extraction date in the manifest.

## Measured output

- 5 circuits, 701 sprints, 74 linked open rides and 10 linked loops.
- 52604 graph nodes; 87967 directed edges; 14259.1 km of physical eligible network.
- 2934 weak components; largest has 7056 nodes. Missing tags and conservative exclusions fragment the network; no country-wide reach times are modelled.
- Terrain covers 87967/87967 edges. Coarse ground terrain is not road-deck surveying; bridges/tunnels and short grades remain limitations.
- Unknown speed/surface on retained roads: 0/0. Unknown/loose surface and unmapped limits are excluded, not filled with Dutch defaults.
- Teeregister evidence recovered 13834 directed edges' speed limits and 2779 edges' surfaces (geometry-matched, OSM tags stay primary).
- The original full-generation shape gate rejected 110 closed candidates that mostly retraced the same road (retrace share > 0.20). The 2026-10-04 circuit-only cleanup did not rerank or recount that batch.
- Width missing on 86777 edges. Traffic counts, population and live closures are unavailable; quiet is a reweighted OSM proxy, not observed traffic.
- 16159 directed edges carry mapped bicycle-route evidence.

## Exclusions (first failing gate per candidate way)

- candidate_ways: 84075
- blocked_junction_segments: 4966
- blocked_junction_km: 134.29409240297832
- no_supported_span_ways: 40660
- unknown_speed_segments: 156139
- unknown_speed_km: 5502.2202581363335
- retained_ways: 32168
- recovered_surface_ways: 936
- recovered_speed_ways: 4661
- locally_cut_restriction_ways: 2127
- unknown_surface_segments: 99175
- unknown_surface_km: 3709.166826648392
- conditional_not_supported: 766
- known_non_paved_surface_segments: 1489
- known_non_paved_surface_km: 40.92176275465569
- short_segment_segments: 974
- short_segment_km: 0.624257313925716
- register_unpaved_or_surface_conflict_segments: 156562
- register_unpaved_or_surface_conflict_km: 8423.703758906317
- restricted_access: 458
- access_or_other_exclusion: 9573
- complex_turn_restriction: 63
- outside_extraction_boundary: 152
- restricted_vehicle_access: 234
- outside_country_bounds: 1
- prepared_spans: 48389
- road_nodes: 256631
- scenic_ways: 39789
- scenic_relations: 2603

## Continuity and safety checks

All 790 published paths have exact connected graph transitions. Circuits and linked loops close on the same OSM node. One-way direction is retained.
Ferries are not routed. Private/restricted roads, barriers, conditional tags and unsupported directional permissions are excluded. Via-node barriers/restrictions cut only the two adjacent segments; complex via-way turn relations still exclude their member ways because this node-only router cannot model arbitrary turns. Missing OSM restrictions remain possible.
Every published circuit must also pass a geometric retrace gate (<= 0.20 of its length driven back along the same road within 25 m, opposing directions), so closed out-and-backs are not labelled circuits.
Entire ways must lie inside the Geofabrik extraction boundary, so cross-border stubs and ferry links are cut. The extraction boundary is not a surveyed international-border model.
Sprints require a mapped reverse driving direction; endpoints are not verified safe turning places.

## Representative generated routes

| Family | Name | km | Estimated route min | Terrain climb m |
|---|---|---:|---:|---:|
| Circuit | Viljandi — Rõngu Circuit | 71.8 | 60 | 593 |
| Circuit | Paunküla — Vetla Circuit | 50.1 | 42 | 205 |
| Circuit | Võru — Kuigatsi — Tõrva Circuit 2 | 45.6 | 39 | 259 |
| Circuit | Tartu — Jõgeva — Aravete Circuit | 45.9 | 39 | 195 |
| Sprint | Rõuge — Kurgjärve — Haanja Sprint | 20.16 | 16 | 160 |
| Sprint | Pühajärve — Pukamõisa Sprint | 15.61 | 12 | 180 |
| Sprint | Pataste — Välgi — Alatskivi Sprint | 14.92 | 12 | 132 |
| Sprint | Maaritsa — Otepää Sprint | 12.42 | 11 | 179 |
| Linked | Tagavere — Vidruka → Oru — Tagavere Loop | 54.5 | 45 | 150 |
| Linked | Rõuge — Kurgjärve — Haanja → Rõuge — Rebäse — Haanja → Käätso — Rõuge — Luutsniku Ride | 40.6 | 35 | 557 |
| Linked | Paunküla — Vetla → Kose — Ardu Loop | 41.0 | 35 | 178 |
| Linked | Rõuge — Kurgjärve — Haanja → Rõuge — Rebäse — Haanja Loop | 36.9 | 31 | 433 |

## Source conflicts and omissions

Teeregister (Transpordiamet WFS, n_kate + n_kiiruspiirang) IS used, at the user's request, to recover missing surface/speed evidence: records match OSM geometry within 12 m with >= 90% line coverage, >= 95% endpoint alignment, ref-number agreement and no ambiguous parallel candidates. Explicit register surface codes win over the contradictory INSPIRE category (gravel code 32 is marked paved there); macadam/stabilised/milled codes 23/25/26 stay unknown; time-window or extra-plate speed records are rejected. Rights caveat preserved in the manifest: catalogue metadata says no conditions, live WFS says AccessConstraints=private. Acquisition uses 2-record-overlapping sorted pages with OID dedupe because GeoJSON paging loses boundary records.
ETAK vectors and population/AKS data are NOT used. Scenery includes assembled OSM multipolygons and holes (not only closed ways), with three probes per edge and a 40 m adjacency test.
OSM speed-zone tags explicitly map EE:rural to 90 and EE:urban to 50; directions override base limits. No untagged road-class speed default is used. Profiles preserve mapped limits per edge.
Scores are the existing absolute rubric, not Estonian percentiles or ground-truth driver ratings. Circuits follow the standard 25 km soft minimum; 40–120 km remains the flagged target, not a claim about every loop.

## Provenance

`data/ee/manifest.json` records source URLs, retrieval dates, snapshot, licences and SHA-256. Both interchange documents carry those notices, code/rubric hashes and country/version metadata. `data/ee/cache/route-evidence.json` ties published IDs to checked edge paths and OSM way IDs. `reports/ee/quality.json` records catalogue hashes.

## Circuit-only cleanup, 2026-10-04

Two published circuits had retracing side excursions removed by the shared
builder. IDs, names, starts and counts remain unchanged; statistics, geometry,
profiles and Maps links were rebuilt from the retained legal graph edges.
Both affected circuits now have zero measured retracing. Every sprint record
and the linked catalogue remain unchanged. The underlying graph, scores and
source evidence remain unchanged. Current catalogue hashes are in `quality.json`;
baseline catalogues and reports are backed up in
`reports/circuit-cleanup-20261004/before/ee/`.
This was not a full candidate-generation/ranking pass. Details, tests and
remaining limits: `reports/circuit-cleanup-20261004/README.md`.
