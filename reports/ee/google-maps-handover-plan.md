# Dynamic Google Maps handover, Netherlands and Estonia

**Implemented locally, 4 October 2026, with changed scope.** The user rejected
sections/splits after work started. Navigate now opens one whole-route request
for both countries and every family, using at most 3 compact or 9 desktop
intermediate points. The original stages/chooser proposal below is historical,
superseded and not implemented. The intermediate chooser and its mobile
focus failure were removed from the final design.

## Implemented design and measured limits

`web/src/data/gmaps.ts` selects points greedily using 100 m chord-deviation
and 5 km along-line gap targets. Distance samples follow the actual polyline.
Closed lines receive a noncoincident shape point; endpoints/order stay intact.
Only adjacent duplicates are removed, not repeated coordinates globally.
On requests already constrained by the point budget, sharp-bend points can
move up to 500 m earlier along the actual approach. Short routes already
meeting targets stay unchanged. This geometry-only placement reproduced
the reported hook improvement without a Kuigatsi-specific production fix.

Every route has one URL, never a truncated first section. When point limits
prevent the geometry targets, the fixed Navigate footer explicitly says
some route detail may not carry over. Google can treat points as stops,
snap to other roads or reroute; no exact fidelity or driving instructions
are promised. Pipeline circuit links no longer bypass shared point selection.
Catalogue bytes, identities, favorites and history/return behavior are unchanged.

Measured target misses: NL 328/3,853 desktop and 1,091 compact; EE 52/790
desktop and 241 compact. Maximum encoded URL 492 chars; all budgets pass.
Median total points 4, maximum 11 desktop/5 compact. Maximum compact gap
49.31 km (NL), 23.98 km (EE), an important long-route limitation.

Full acceptance, reproduction and actual tests:
`acceptance-20261004-maps-handover.md`.
Measurements: `maps-handover-measurements-20261004.json`.
The final desktop Viljandi link retained nine intermediate points and
computed 71.6 km; the user confirmed the adjusted manual trial removed
the unwanted hook and visually matched the original app line.
Physical Android/iOS Maps-app retention and road-by-road fidelity remain
unvalidated. No catalogue regeneration or pipeline work occurred.

## Original recommendation, superseded

Choose points from the route's shape and length, then split long routes into
ordered Google Maps stages. Do not put an unlimited number of points in one
URL, and do not use curve counts alone to decide the number.

Google's current Maps URLs documentation supports up to **3 intermediate
waypoints on mobile browsers and 9 otherwise**. These exclude origin and
destination. Maps-app behavior still needs device testing:
https://developers.google.com/maps/documentation/urls/get-started

The current helper asks for 8 distance-spaced intermediate points for linked
rides and fallback circuits, but drops repeated vertex selections. Some
circuits instead use an existing pipeline link. Sprints use 3 points.
Increasing 8 to 9 alone would not solve the reported missed-road problem.

## Small implementation

1. Use the existing WGS84 route line for every family in both countries.
   Reuse cumulative distances and the current URL builder. Do not modify raw
   catalogues, route keys, scores, permissions or saved identities.
2. Select ordered shaping points using a small geometric simplification:
   retain the point with the greatest deviation from each candidate chord.
   Also split intervals with too much along-route distance. Initial values
   to trial are **100 m deviation and 5 km maximum route-distance gap**,
   not validated guarantees. Straight roads need few shape points; detours
   and winding sections need more. Avoid repeated six-decimal coordinates
   and zero-length legs, but never merge different visits to an intersection
   merely because their coordinates match.
3. Handle closed lines explicitly: retain the original start/finish and split
   the ring at its farthest point before simplifying each half. Preserve
   driving order. Sample extra distance-gap points on the actual polyline,
   never on a straight chord across a bend.
4. Group consecutive shaping points into links within the applicable waypoint
   budget: 3 on compact/mobile layouts, 9 on desktop. Treat this as a
   conservative layout choice, not reliable detection of which Maps app will
   open. Adjacent stages share an exact endpoint; only the final loop stage
   returns to the original start. Keep each encoded URL within 2,048 characters.
5. Short routes keep the direct Navigate action. If multiple stages are needed,
   Navigate opens one small chooser: "Part 1 of 4", distance interval, and
   "Open in Google Maps". Let the user choose the next part manually when
   safely stopped. No location tracking, automatic app launches, forced
   progress, new navigation-options disclosure or purported safe stops.

Shaping points are requested intermediate destinations, not surveyed junctions
or instructions. Maps may treat them as stops rather than silent shaping
points. Google may still snap to another road or reroute between them.
Keep that caveat visible. Do not promise exact route fidelity from geometry.
Adding a Google routing API, credentials, billing, GPX support or another
navigation app is outside this minimal proposal.

## Validation before shipping

- Synthetic checks: straight line, uneven vertex spacing, hairpin/detour,
  repeated coordinates, self-crossing and closed loop.
- Assert order, exact stage continuity, endpoint preservation, maximum spacing,
  waypoint budgets, finite coordinates and URL lengths. Never silently discard
  excess points or stages.
- Measure point/stage counts across both real catalogues before settling
  tolerances. Inspect Viljandi → Rõngu and long Dutch circuits, plus a short
  sprint and a linked loop. More points are not automatically better.
- Verify chooser focus, Escape, return to details and selection preservation.
  Inspect generated URLs without launching every external link.
- Check actual Maps behavior on Android and iOS, including waypoint retention
  and the reported missed turns. Geometry-only tests cannot prove this.
- Run narrow tests, full Vitest/Node suite, typecheck and build. Verify all four
  source catalogue hashes remain unchanged.

Estimated implementation and automated/browser checks: roughly one focused
working day, with extra time for physical-device testing and tolerance tuning.
