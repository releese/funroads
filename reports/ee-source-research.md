# Southern Estonia source verification

Verified against live official services on 2026-10-03. Pilot WGS84 extent: **[26.25, 57.62, 27.25, 58.15]** (west, south, east, north). All remote operations were reads. No implementation or `data/ee` changes.

## Immediate recommendation

1. Use Geofabrik Estonia OSM as the routable network fallback: https://download.geofabrik.de/europe/estonia-latest.osm.pbf . Observe ODbL attribution/share-alike rules; do not relabel official-source data as OSM.
2. ETAK forest/water/buildings and DTM are usable with the **Maa- ja Ruumiamet custom open-data licence**, attribution, extract date, and a licence link distributed with the data.
3. A **real 25 m terrain raster for the entire pilot envelope** is available through the verified WCS URL below: 24,290,380 bytes, not a national 343 MB download.
4. Teeregister is publicly readable and its authoritative catalogue says no conditions/no public-access restrictions, but live capabilities say `AccessConstraints=private`. Preserve this discrepancy: obtain owner clarification before treating redistribution as unconditionally cleared under a strict licence gate. Do not apply the ETAK licence to all Teeregister attributes automatically.
5. Optional population is a practical 1.34 MB official download, but **CC BY-SA 4.0**, unlike ETAK. Keep its licensed component and provenance separate, or omit it initially.

## Teeregister: live service, schemas, counts

Service: https://teeregister-api.mnt.ee/teenus/wfs

Capabilities:
https://teeregister-api.mnt.ee/teenus/wfs?service=WFS&version=2.0.0&request=GetCapabilities

Observed:
- WFS 2.0.0, **58 feature types**.
- Default CRS EPSG:3301; advertised alternatives EPSG:4326 and EPSG:3857.
- GeoJSON format is **`application/json; subtype=geojson`**, not necessarily a bare `application/json`.
- Read-only basic WFS; result paging supported; transaction-safe paging is false.
- Advertised WGS84 layer envelope, including `teeosa`, `n_kate`, `n_liiklusmark`, `n_kandur`: `[21.555787155427, 56.8480533690268, 28.5034325303622, 60.3631744537725]`. This is a broad shared service envelope, not evidence each layer has complete coverage.
- `Fees=NONE`; **`AccessConstraints=private`**.

Use latitude/longitude axis order for an EPSG:4326 URN BBOX:
`bbox=57.62,26.25,58.15,27.25,urn:ogc:def:crs:EPSG::4326`.

| Layer | Pilot `hits`, default/3301 output | National `hits` checked |
|---|---:|---:|
| `ms:teeosa` | 4,432 | not requested |
| `ms:n_kate` | 8,057 | 101,805 |
| `ms:n_kiiruspiirang` | 1,148 | not requested |
| `ms:n_liiklussagedus` | 567 | not requested |
| `ms:n_omand` | 21,376 | not requested |
| `ms:n_liiklusmark` | **0** | **0** |
| `ms:n_kandur` | 8,636 | 90,033 |

**Output-CRS caveat:** keeping the same BBOX but requesting `srsName=EPSG:4326` changed live `n_kate` matches to **7,584** and `n_kandur` to **8,204**. Both `hits` and actual GeoJSON downloads agreed with those smaller numbers. The precise server-side cause was not established; it is consistent with reprojection/filter-envelope behavior, not a reason to silently compare unlike requests. Use one fixed output CRS (prefer native 3301), deduplicate, and clip locally to the exact pilot geometry.

Exact usable native-CRS page:
https://teeregister-api.mnt.ee/teenus/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:n_kate&bbox=57.62,26.25,58.15,27.25,urn:ogc:def:crs:EPSG::4326&srsName=EPSG:3301&outputFormat=application/json%3B%20subtype%3Dgeojson&count=5000&startIndex=0&sortBy=oid

`count=2&sortBy=oid` returned OIDs `[10050526, 10083658]`; `startIndex=2` returned `[10083660, 10094000]`. Page with a stable sort, advance `startIndex`, and deduplicate by `oid`; the source can change between pages.

Live schema URLs:
- https://teeregister-api.mnt.ee/teenus/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=ms:n_kate
- https://teeregister-api.mnt.ee/teenus/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=ms:n_liiklusmark
- https://teeregister-api.mnt.ee/teenus/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=ms:n_kandur

### Surface conflict: do not trust INSPIRE `paved` alone

Relevant `n_kate` fields:
`kate_kate_xv`, `kate_kate_val`, `kate_yldine`, `inspire_surfacecategory`, `segut_segu_xv`, `segut_segu_val`, `katekp`, `kataasta`, `markus`; join/address fields include `tee_number`, `soidutee_nr`, `alguskm`, `loppkm`, `tee_oid`, `teeosa_oid`, `lopp_teeosa_oid`, `oid`, `muudetud_kpv`; geometry is `msGeometry`.

In the actual 7,584-record geographic-output extraction:

| Surface code / label | General category | INSPIRE category | Records |
|---|---|---|---:|
| `32`, `kruusatee` (gravel road) | `pinnas- ja kruusatee` | **`paved`** | 4,423 |
| `41`, `pinnastee` (earth road) | `pinnas- ja kruusatee` | `unpaved` | 739 |
| `99`, `määratlemata kate` (undetermined) | `pinnas- ja kruusatee` | **`paved`** | 86 |
| `23`, `makadamkate` | `kattega tee` | **`unpaved`** | 31 |
| `27`, `pinnatud kruusatee` (surface-treated gravel road) | `kattega tee` | `paved` | 334 |

Example OID **8508251**, road **23140**, km **19.997–23.723**: code `23`, label `makadamkate`, general `kattega tee`, INSPIRE `unpaved`, mixture `bituumenmakadam MUK 16/32`.

Recommended rule: retain raw values, classify known gravel/earth as unpaved and code `99` as unknown; never let contradictory `inspire_surfacecategory=paved` promote them. Code `27` is explicitly surface-treated and needs its own documented policy, not blind conversion to ordinary gravel. Ambiguous macadam/stabilised/milled-asphalt cases need conservative handling or corroboration.

### Signs: use `n_kandur`, not the empty advertised sign layer

`n_liiklusmark` is advertised and has a valid schema, but live national and pilot counts are zero. Its schema includes `lmnum_lmnum_xv`, `lmnum_lmnum_val`, `tekst`, `alusnahtus_oid`.

`n_kandur` contains eight embedded sign slots:
- `lm1` … `lm8`: sign codes, strings;
- `lm1_tekst` … `lm8_tekst`: associated text;
- for each slot, `lmN_lmsuhe_lmsuhe_xv` and `_val`;
- contextual fields: `tee_number`, `tee_nimi`, `soidutee_nr`, `km`, `teeosa`, `teeosa_meeter`, `postide_arv`, `asuk_kirj`, `markus`, `viitepunkt`, `viitepunkti_suund_nvps_xv`, `oid`, `tee_oid`, `teeosa_oid`, `muudetud_kpv`.

**Important:** `_lmsuhe_` means sign size/reflective-film information here, not travel direction. A real value is `2.suurusgrupp, RA1 kilega`. `viitepunkti_suund_nvps_xv=PAREMAL/VASAKUL` is right/left relative to the reference point, not automatically a legal travel-direction restriction.

Example OID **908118**, road 87, km 0.043: `lm1=173a`, `lm2=821`, **`lm3=351`**; `markus` says children / influence area 200 m / maximum speed 50. Slot 3 would be missed by reading only `lm1`. OID **908147** has `lm1=351`, empty `lm1_tekst`, and `markus=suurim kiirus 70`: the sign code alone does not supply a numeric limit. Prefer interval layer `n_kiiruspiirang`; do not infer permission or a numeric speed solely from sign presence.

### Teeregister rights evidence and remaining gap

- Owner overview: https://www.transpordiamet.ee/teeregister — all persons may use the register to obtain road information; this is not itself an explicit redistribution licence.
- Official dataset entry: https://andmed.eesti.ee/datasets/eesti-teeregister — owner Transpordiamet, daily updates, ODD listed as applicable law.
- Authoritative ISO metadata XML:
  https://metadata.geoportaal.ee/geonetwork/srv/api/records/41c8e99a-354e-4201-a014-b107ea555f94/formatters/xml
  — `tingimusi ei rakendata` (“no conditions apply”) and `avaliku juurdepääsu piirangud puuduvad` (“no public-access restrictions”).
- Official WFS field guide is downloadable and was inspected:
  https://teeregister.mnt.ee/reet/docs/Teeregistri_avalik_WFS_teenus.docx
  — useful field meanings; do not treat historical layer lists as current capabilities.
- Capabilities `MetadataURL` points to `request=GetMetadata&layer=...`, but the live service rejects this operation (with version supplied, HTTP 400 `InvalidParameterValue`).

**Conclusion:** substantial official evidence for open/public reuse, but no separately named redistribution licence was established and live `private` contradicts it. This is a provenance/strict-gate gap, not a finding that reuse is definitely forbidden. Clarify with **teeregister@transpordiamet.ee** whether commercial derived-route/catalogue redistribution is permitted and which attribution applies. Pending clarification, OSM network + ETAK corroboration is the clean alternative; omit Teeregister-derived published attributes if the release requires fully unambiguous source grants.

## ETAK WFS and downloadable files

Official description:
https://geoportaal.maaamet.ee/est/ruumiandmed/eesti-topograafia-andmekogu-p79.html
— vector mapping approximately 1:5000, downloadable files updated weekly, explicitly open data; publication attribution example: `Eesti topograafia andmekogu 2026, Maa- ja Ruumiamet`.

WFS capabilities:
https://gsavalik.envir.ee/geoserver/etak/ows?service=WFS&version=2.0.0&request=GetCapabilities

**39 live feature types**, documented **5,000 features per query**. Result paging supported; transaction-safe paging false. Although capabilities advertise `CountDefault=1000000`, obey the explicit service/per-layer 5,000 limit.

Pilot matches from actual JSON requests (`count=1`, BBOX above, native output 3301):

| Layer | Matched | Useful evidence |
|---|---:|---|
| `etak:e_501_tee_j` | 63,365 | `teekate`, `teekate_tekst`, `tee`, `teeosa`, `soidutee`, `nimetus`, `sys_id`, `etak_id` |
| `etak:e_305_puittaimestik_a` | 21,969 | woodland polygons; `tyyp_tekst=Mets` in inspected example |
| `etak:e_202_seisuveekogu_a` | 15,820 | lakes/ponds; `nimetus`, `kkr_kood`, `no_oid` |
| `etak:e_203_vooluveekogu_j` | 80,073 | watercourse/ditch centre lines; preserve type distinction |
| `etak:e_401_hoone_ka` | 82,077 | building polygons; type and address/reference fields |

**Count trap:** `resultType=hits` returned exactly `numberMatched=5000` for each of these larger selections, while actual result requests returned the larger totals above. Do not stop paging at the capped hits response.

Verified page:
https://gsavalik.envir.ee/geoserver/etak/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=etak:e_501_tee_j&bbox=57.62,26.25,58.15,27.25,urn:ogc:def:crs:EPSG::4326&srsName=EPSG:3301&outputFormat=application/json&count=5000&startIndex=0&sortBy=sys_id

Small pages 0/2 returned distinct sorted `sys_id`s, and `startIndex=5000&count=1` successfully returned a road after the first page. On layers without `sys_id`, inspect the schema and sort using a suitable stable identifier such as `etak_id`; do not invent a field. Deduplicate and check completeness against actual result totals. Schema example:
https://gsavalik.envir.ee/geoserver/etak/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=etak:e_501_tee_j

Bulk files, links read directly from the official download page (not fully downloaded):
- Page: https://geoportaal.maaamet.ee/est/ruumiandmed/eesti-topograafia-andmekogu/laadi-etak-andmed-alla-p609.html
- Whole GPKG: https://geoportaal.maaamet.ee/index.php?lang_id=1&plugin_act=otsing&andmetyyp=ETAK&dl=1&f=ETAK_EESTI_GPKG.zip&page_id=609
- Transport SHP: https://geoportaal.maaamet.ee/index.php?lang_id=1&plugin_act=otsing&andmetyyp=ETAK&dl=1&f=ETAK_Eesti_SHP_transport.zip&page_id=609
- Land cover SHP: https://geoportaal.maaamet.ee/index.php?lang_id=1&plugin_act=otsing&andmetyyp=ETAK&dl=1&f=ETAK_Eesti_SHP_kolvikud.zip&page_id=609
- Water SHP: https://geoportaal.maaamet.ee/index.php?lang_id=1&plugin_act=otsing&andmetyyp=ETAK&dl=1&f=ETAK_Eesti_SHP_veekogud.zip&page_id=609

### ETAK/terrain reuse licence

Current licence PDF, dated **01.01.2025**, inspected in full:
https://geoportaal.maaamet.ee/opendata-licence
(redirects to https://geoportaal.maaamet.ee/docs/Avaandmed/ETAK_open_data_licence.pdf).

Prescribed current link for redistribution: https://geoportaal.maaruum.ee/opendata-licence

The licence expressly permits free, indefinite commercial/noncommercial use, derivatives, adaptation, combination and **redistribution**. Obligations:
- Credit licensor, dataset title, and data age/extraction date.
- Attach the licence or a link when distributing to third parties.
- Original data remain subject to these terms when combined with value-added data.
- Remove source reference on licensor's written request.
- Data are “as is”; breach terminates rights automatically.

**Not CC BY / CC0.** Do not invent a standard SPDX licence or replace these terms. Local inspected evidence: `C:\Users\risto\funroads\reports\ee-open-data-license.pdf`.

## Terrain: verified small full-pilot raster

Official model description:
https://geoportaal.maaamet.ee/est/ruumiandmed/korgusandmed/korgusmudelid-p508.html
— terrain versus surface/canopy products; **all models are EH2000 heights**.

Live WCS:
https://teenus.maaamet.ee/ows/wcs-dtm?service=WCS&version=2.0.1&request=GetCapabilities

Coverage IDs **`dtm-25`, `dtm-10`, `dtm-1`**, native EPSG:3301, TIFF output. Describe:
https://teenus.maaamet.ee/ows/wcs-dtm?service=WCS&version=2.0.1&request=DescribeCoverage&coverageId=dtm-25

**Exact tested download covering the entire pilot projected envelope:**
https://teenus.maaamet.ee/ows/wcs-dtm?service=WCS&version=2.0.1&request=GetCoverage&coverageId=dtm-25&subset=x%28632450%2C694175%29&subset=y%286388650%2C6450100%29&format=image%2Ftiff

Live validation: HTTP 200 `image/tiff`; **24,290,380 bytes**, **2,458 rows × 2,469 columns**, float32, EPSG:3301; 25 m pixel spacing; top-left `(632450,6450100)`; decoded pixel range **33.049732–315.90573**. This is real official terrain, not synthetic. Read into memory for verification; not persisted.

WGS84 corner envelope projected to 3301 is approximately `[632463.70,6388665.79,694156.49,6450076.73]`; the tested request rounds outward. Reproject/clip locally to WGS84 pilot boundaries if needed. WCS axes are named **x=easting, y=northing** even though the coverage's EPSG envelope lists `axisLabels="y x"`; the tested named subsets and GeoTIFF tags establish the working order.

Use 25 m for coarse route profiles initially. `dtm-10` offers finer data, but do not download an entire 1 m extent casually or assume this exact large 10 m request is within service limits.

Also verified a real 10 m Rõuge tile:
https://geoportaal.maaamet.ee/index.php?lang_id=1&plugin_act=otsing&kaardiruut=5407&andmetyyp=dem_10m_geotiff&dl=1&f=5407_dtm_10m.tif&page_id=614
— HTTP 200, **4,166,018 bytes**, 1000×1000 float32, bounds `[670000,6400000,680000,6410000]`, nodata `-9999`, actual range 80.86344–268.88312. This tile covers only part of the pilot.

Terrain download portal: https://geoportaal.maaamet.ee/est/ruumiandmed/korgusandmed/laadi-korgusandmed-alla-p614.html
— explicitly free reuse under the open-data terms, attribution and extract time requested.

## AKS / KNR: names, not population

Official current service description:
https://geoportaal.maaamet.ee/est/teenused/kohanimeregistri-teenus-aks-p133.html
— AKS replaces the older interface from **23 April 2025**; includes official, unofficial and former names.

Public search: https://aks.geoportaal.ee/aks/search/placename
Public map: https://aks.geoportaal.ee/aks-api/kaart/page/app/aksavalik
Official direct-name example: https://aks.geoportaal.ee/aks/name/detail/NO003313428

No documented current public bulk API/download and redistribution grant was established during this bounded investigation. Do not reverse-engineer the app or assume legacy KNR endpoints still work. Practical pilot alternative: ETAK `nimetus`/`no_oid` and OSM settlement names, retaining their respective source terms. AKS is not a substitute for a population grid.

## Population: practical official download, different licence

Official page:
https://stat.ee/en/find-statistics/spatial-data

**2025 1 km population grid, EPSG:3301**, live downloaded to memory and inspected:
https://stat.ee/sites/default/files/2025-10/2025_3301_0.zip
— HTTP 200, **1,343,424 bytes**; SHP/DBF/PRJ/SHX/CPG plus `rahvastik_1km_01012025.csv`.

CSV is semicolon-separated; fields:
`GRD_INSPIR`, `RAHVAARV`, `MEHED`, `NAISED`, `<18-aastased`, `18–64-aastased`, `>64-aastased`.
Use `RAHVAARV` for the published total, not a sum of independently perturbed sex/age fields. Published grid values are confidentiality-adjusted; cells below three people are shifted to nearby inhabited cells, and cell-key noise applies to descriptive fields starting in 2025. The inspected CSV also contains zero-valued cells; do not assume only inhabited cells are present.

Explicit official reuse terms:
https://stat.ee/en/statistics-estonia/about-us/strategy/principles-dissemination-official-statistics
— section “Reference to the data source”: **Statistics Estonia open data may be shared under CC BY-SA 4.0**.
https://creativecommons.org/licenses/by-sa/4.0/deed.en

Attribute Statistics Estonia and the 1 January 2025 grid, provide the CC BY-SA licence link, indicate modifications, and retain share-alike terms on adaptations. Keep this optional licensed layer separate from ETAK/custom-licence and OSM/ODbL data rather than declaring one licence for all source data. Omitting population and using ETAK building density as a clearly labelled settlement proxy is a lawful simpler pilot alternative; it must not be called population density.
