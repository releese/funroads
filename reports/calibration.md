# Roadcurvature calibration

Reference: pinned `data/raw/roadcurvature_nl_c1000.kmz`. The KMZ is a curvature-selected OSM derivative, not an independent rating of driving enjoyment or legal access. Exact OSM way-ID matching avoids false matches to nearby roads; edits to OSM IDs between snapshots reduce recall. Both driving directions share one physical geometry.

## Named-road and access audit

The pinned OSM extract has no ways named `Posbankweg` or `Amerongseweg`. The Posbank approach is mapped as Schietbergseweg (e.g. way 6835645, asphalt, 60 km/h). Beekhuizenseweg (e.g. way 6835762) carries `motor_vehicle:conditional=no @ (Sa,Su, Jul, Aug, PH)`; other sections close at night. The Amerongse Berg approaches are mapped as Bergweg (e.g. way 147250645, 50 km/h) and Veenseweg (e.g. way 6930933, 50 km/h). Nearby Zuylesteinseweg includes gravel tracks, not suitable substitutes for a paved car route. Diagnostics use these mapped names in their respective local areas; the graph retains a conditional road only in sampled weekday/weekend 08:00 and 20:00 departures when it stays open over the next three hours. Unknown conditional access is excluded; nightfall is approximated conservatively rather than computed for a particular roadside sign. Busyness is static, so these windows show access, not hour-by-hour traffic quality. Always check current signage and seasonal restrictions before driving.

- KMZ lines: 835; with at least one eligible matched way: 545.
- Eligible physical roads: 293,523, 65,986 km; KMZ matched: 1,723 km (2.6% base rate).
- Precision@K = fraction of top K road-km whose OSM way occurs in the KMZ. Excluded/inaccessible roads cannot count as positives or candidates.

| Weights (absolute anchors unchanged) | @100 km | @500 km | @1000 km |
|---|---:|---:|---:|
| configured absolute rubric | 6.4% | 7.5% | 7.2% |
| more corners | 7.4% | 7.8% | 7.6% |
| more elevation | 8.1% | 8.3% | 8.7% |
| more quiet | 6.9% | 7.0% | 7.9% |

The alternatives are a small sensitivity check, not fitted replacements. A curvature-derived reference mechanically favors corner weight. Keep the absolute anchors and 60–80 km/h legal-flow score; do not optimize for matching this proxy at the expense of access, surface, quiet, or travel time.

## Current ranked circuits

Route overlap is sampled every 100 m within 30 m of a KMZ polyline. It is spatial corroboration only, not proof of legal access.

| Rank | Circuit | Fun km | Reach min | KMZ overlap | Open windows | Flags |
|---:|---|---:|---:|---:|---:|---|
| 1 | Maas en Waalweg Circuit | 44.0 | 99 | 5.9% | 8/8 | far_from_home |
| 2 | Raalterweg Circuit | 36.7 | 81 | 7.2% | 8/8 | far_from_home |
| 3 | Middendijk Circuit | 36.4 | 97 | 1.9% | 8/8 | far_from_home |
| 4 | IJsseldijk Circuit 2 | 35.5 | 97 | 19.5% | 8/8 | far_from_home |
| 5 | Rijksstraatweg Circuit 2 | 35.4 | 81 | 22.2% | 8/8 | far_from_home |
| 6 | Van Heemstraweg Circuit 2 | 34.8 | 99 | 6.8% | 8/8 | far_from_home |
| 7 | Zwartemeerweg Circuit | 31.5 | 77 | 8.5% | 8/8 | far_from_home |
| 8 | Rijksweg Circuit | 24.9 | 126 | 0.0% | 4/8 | far_from_home |
| 9 | Cellemuiden Circuit | 23.3 | 98 | 23.2% | 8/8 | far_from_home |
| 10 | Rijksweg Circuit | 22.6 | 139 | 0.0% | 8/8 | far_from_home |
| 11 | Polder Circuit | 21.7 | 100 | 15.9% | 8/8 | far_from_home |
| 12 | Maasbandijk Circuit | 20.5 | 104 | 18.4% | 8/8 | far_from_home |

## Interpretation

12 of 12 selected circuits are flagged far from home; median KMZ spatial overlap is 7.9%.

The source itself ranks many dikes highly (its first entries include Meije, Dijk, Waalbandijk and Waaldijk), but low route-level overlap does not validate the present dike-heavy top twelve. Likewise, the small lift of the elevation-heavy alternative is not enough to retune a multidimensional driving rubric against a curvature-only reference. The KMZ contains neither a home-reach preference nor verified access for a specific day/hour; all-far results are a limitation of fun-km-first selection, not evidence that distance should change road fun. Keep the home-reach flags rather than silently replacing fun-km with a geographic percentile. A representative human-rated set with negative examples and an explicit near-home route preference are needed before changing weights or route selection.
