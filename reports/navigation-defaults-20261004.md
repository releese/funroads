# Country defaults and balanced Maps checkpoints, 4 October 2026

## Release and scope

The previous complete release was pushed in five individually scanned commits.
GitHub main was verified at `9539d4f`; Pages workflow completion was not checked.
The user authorized publishing this subsequent increment to main for phone testing.
No catalogue, route identity, favorite key, scoring or pipeline output changed.
All four catalogue SHA-256 hashes match the release baseline.
The user also requested the score gauge/value first in selected-route preview
metadata. Desktop/phone previews and overlap choosers show it before length and time.
Result cards keep their existing score and do not repeat it in their metadata.

## Country defaults

Explicit `?country=` wins, followed by a remembered manual picker choice,
then the browser timezone (`Europe/Tallinn` suggests EE; otherwise NL).
No geolocation request or IP/network lookup. Invalid saved values are ignored;
blocked storage does not prevent country links from working.
Timezone suggestions do not themselves write a preference.
The user explicitly dropped legacy-link requirements. New route selections
include their country query parameter and preserve paths and other queries.

## Checkpoints

Keep the existing short-route shape selector. When its fixed budget cannot
satisfy the 100 m chord-deviation / 5 km gap targets, reserve equal-distance
regions for the whole route, then refine candidates from both ends inward.
Compare each distance anchor, existing shape anchors within its region, and
the strongest local deviation against both neighboring chords.
Keep ordered points on the actual line and the sharp-bend approach offset.
Desktop still allows start + 9 intermediates + finish; compact allows 3
intermediates. One URL only, no stages or endpoint truncation.
The compact budget remains a browser-compatibility choice, not a measured
native-app limit. An actual 11-point app test needs the desktop-budget URL;
ordinary phone-layout Navigate still sends only 3 intermediate points.

Measured against the published selector at `9539d4f`, all 12 NL / 5 EE circuits:

| Country / budget | Mean maximum gap, before → after | Mean maximum chord deviation, before → after |
|---|---:|---:|
| NL / 9 | 16.04 → 12.33 km | 1.55 → 1.80 km |
| EE / 9 | 8.59 → 7.38 km | 0.87 → 1.00 km |
| NL / 3 | 30.80 → 27.89 km | 4.90 → 4.34 km |
| EE / 3 | 17.45 → 15.75 km | 2.84 → 2.62 km |

These are geometry proxies, not Google Maps routing measurements. Balanced
coverage can trade away some chord fidelity, particularly on desktop.
All circuits remain underconstrained and retain the visible fidelity caveat.
Published detail contains no junction locations; bend candidates are not
claimed to be intersections. Actual Android/iOS route retention remains untested.

## Full-budget phone test

Ordinary phone-layout Navigate still uses 3 intermediates. To test the native
app's larger limit independently of screen width, open this generated
[11-point Viljandi → Rõngu circuit request](https://www.google.com/maps/dir/?api=1&origin=58.088046%2C26.087747&destination=58.088046%2C26.087747&travelmode=driving&waypoints=58.144662%2C26.221898%7C58.18675217758428%2C26.204528889661045%7C58.181096%2C26.298264%7C58.11994912826916%2C26.337893947395283%7C58.070579%2C26.288769%7C58.04383281401042%2C26.334397257910833%7C58.00541911780328%2C26.29078842853836%7C58.01249540473217%2C26.171260362491303%7C58.05538603386523%2C26.1850160000602)
on the phone. It requests start, 9 intermediates and the same start as finish.
Check retained points, endpoint, route shortcuts and unwanted U-turns.
No native-app support claim is made until this is tested.

## Validation

- `npm test`: 138 Vitest and 6 Node checks passed, including both full catalogues.
- `npm run build`: typecheck, build and packaged/offline integrity passed.
- Score-first previews and chooser passed shared UI regressions. Browser
  verified the supplied Pukamõisa → Purtsi sprint shows gauge + 64/100 first,
  then length, time and direct distance, fitting at 1789×1288 and 320×740.
- Synthetic long concentrated-bend loops, actual-approach bend placement,
  even-budget out-and-back, and ordered/budget/URL regressions passed.
- Additional read-only probe: 180 repeated-loop cases across budgets 1–9 passed.
- Browser: saved EE reopened at the root without a country query. Explicit NL
  and EE long-circuit details each retained closure and had 9 desktop / 3 compact
  intermediates, with Navigate visible at 1789×1288 and 390×844.
- Manual picker storage and new country-explicit links passed automated UI/unit
  checks. The visible pane's pointer activation and an animation-frame-based
  sequence were unreliable; the latter timed out. Do not count those as passed
  live end-to-end shared-link checks. Native DOM Browse activation worked.
- Python was not rerun for this frontend-only increment. The preceding release
  passed 119 tests with 3 skipped.
- Earlier unresolved underline-hover, saved-set fingerprint, contrast and
  physical-device limitations remain in `ee/ui-parity-20261004.md`.
