# Whole-route Google Maps browser trial, 4 October 2026

This adds evidence without changing `acceptance-20261004.md`.

## User steering and current state

The user rejected sections/splits and requested a whole-route Maps browser
trial before choosing the final Navigate behavior. Implementation is paused
for that inspection. The unfinished chooser must not be treated as accepted
or complete. No build, deployment or catalogue regeneration was performed.

The pure selector passed 11 synthetic tests. The shared integration passed
68 tests across geometry, units and both real catalogues, plus typecheck.
The subsequent chooser interaction run had 20 passes and one failure:
mobile Escape did not restore Navigate focus as expected. That failure is
unresolved; the user rejected the chooser before the next fix.

## Browser trial

The desktop-owned browser pane was opened, not replaced or closed.
Route: `ee:circuit:area-041-main`, Viljandi → Rõngu Circuit, 72.2 km.

`maps-nine-waypoint-test-20261004.json` records the exact ordered vertices
and submitted URL. This isolated test selects nine strongest shape points
with a fixed budget, preserves the original loop endpoints and requests the
whole loop in one URL. It is not the unfinished dynamic-parts algorithm.
Nine is the official documented desktop maximum, not an arbitrary excess.

After loading, the Maps directions UI showed one origin, nine intermediate
destinations and the final destination equal to the origin. Its transformed
URL retained all eleven ordered coordinates. Maps displayed the maximum
destination-count message and computed **74.4 km, 1 hour**, compared with the
catalogue's 72.2 km. Point retention therefore passed in this desktop trial;
road-by-road fidelity remains for user inspection. No physical Android/iOS
test, mobile-browser retention test, routing API or undocumented URL trick
was used. No external navigation was triggered automatically by the app.

## Baseline

Python: 112 passed, 3 skipped. All four starting catalogue hashes matched
the supplied values. Existing dirty-tree work was preserved, including the
already modified tracked Dutch routes input. This session did not write
source catalogue inputs, pipeline/configuration, raw downloads or manifests.

## Next action

Keep the browser on this trial for user inspection. Resolve the single-link
requirement before further implementation. Finish the chosen implementation,
run all acceptance checks and update final notes; do not describe this
interrupted work as a completed navigation release.

## Reported hook and controlled follow-up

The user supplied `maps-hook-user-20261004.jpeg`, reporting a hook on
Pringi → Kuigatsi teerist. Inspection found a source-line northward spur:
vertices 591 → 592 → 593 travel 192.07 m out and exactly back, 384.15 m
total. This is not sufficient to attribute the larger displayed Maps hook
to the catalogue. Source-only evidence:
`maps-hook-source-20261004.json` and `.svg`.

A controlled second request changed only waypoint vertex 660 to 650, about
588 m earlier along the source line. All other requested points and the
complete-loop endpoints stayed the same; there were still nine intermediate
waypoints. The changed point resolved to Enu, Vaardi instead of Kuigatsi
teerist. Maps then computed **71.6 km, 56 min**, compared with the first
trial's 74.4 km and the catalogue's 72.2 km. This demonstrates sensitivity
to waypoint placement/snapping, not proof of exact road fidelity.
`maps-nine-waypoint-adjusted-20261004.json` records the second request.
The adjusted route is left open for user inspection. No source-data fix,
route-specific production exception or final Navigate design was applied.

The user confirmed that the unwanted hook disappeared in the adjusted trial,
then requested the original route in FunRoads for visual comparison.
The QA-owned production preview was started on `127.0.0.1:5174` (launcher
PID 12736, log `C:\Users\risto\AppData\Local\Temp\droid-bg-1791119524856.out`).
It serves the existing packaged app, not a rebuild of the unfinished chooser.
Local-origin service-worker registrations and caches were reset in page
context; localStorage/favorites were preserved. The pane now shows
`?country=ee#route=ee%3Acircuit%3Aarea-041-main` in selected-route preview.
Keep this server running while the user compares; stop only the owned process
tree after comparison/testing is complete. The desktop-owned pane stays open.
