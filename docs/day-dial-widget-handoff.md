# Day Dial — iOS `systemLarge` widget: handoff

**Status:** phases 0–3 landed; timeline (4) next. iOS only for now.
**Companion files:** `docs/day-dial-widget-spec.html` (reference render, exact geometry),
`docs/day-dial-palette-study.html` (block band treatment; variant C is what ships),
`docs/day-dial-widget-feasibility.md` (prior investigation, PR #1665).

The HTML spec is the source of truth for geometry. Its constants are named at the
top of the script — read the values, don't measure the picture.

---

## 1. What this is

A reduced Day Dial for the iOS home screen. Not the kiosk dial shrunk — a
deliberately smaller information set chosen so nothing depends on legible type
at 364×382pt.

**In:** block arcs, now needle, 24-hour tick ring, six hour labels, sky ring
(sun/moon strength) with sunrise/sunset/moon glyphs, hub with weekday, date,
current task, countdown, and runway.

**Out:** temperature numerals, complications, the 12-hour rolling variant,
per-block labels.

---

## 2. Geometry

Canvas 364×382pt. Centre `(182, 189)`. 24-hour, midnight at top, clockwise.
`angle = (minutes / 1440) × 360`.

| Element | Radius | Width | Notes |
|---|---|---|---|
| Sky ring | 119 | 6 | Constant width. 24 hour-aligned segments, butt caps. |
| Block band | 140 | 22 | Variant C: sector fill + outer rim per block, toned by state (below). The spec render's solid band and its 42 % past dimming are superseded. |
| Block track | 140 | 22 | White @ 4.5% beneath the blocks. |
| Tick ring | 155–166 | 1.5 | 24 major ticks. |
| Minor ticks | 161–166 | 1.0 | 3 per hour (every 15 min), white @ 13%. |
| Hour labels `00` `12` | 172 | — | 10.5pt, white @ 44%, tracking 1.4. |
| Hour labels `03 09 15 21` | 181 | — | Pushed out 9pt to clear the ticks. |
| Glyphs (sunrise/sunset/moon) | 104 | — | Upright, never rotated. |
| Needle | 126–159 | 2.6 | 3.4pt dot at the outer end. |

Three constraints worth not breaking:

- **No `06` / `18` labels.** At r=172 a label at the horizontal positions
  overflows the 364pt width by ~14pt. That space carries the sun glyphs instead.
- **Diagonal labels sit at 181, cardinals at 172.** The collision is with the
  *corner* of the label box, not its centre. At 172 the diagonals overlap the
  tick ring by ~4.6pt; at 181 they clear it by 4.4pt.
- **Needle inner end at 126** leaves a 4pt gap above the sky ring's outer edge
  (122). Anything lower touches it.

### Block band: variant C

Decided in Phase 2 from `docs/day-dial-palette-study.html`. The spec render's
one-stroke-per-category band at a fixed alpha, past at 42 %, is replaced by
the app's own treatment reweighted for widget scale: the study's variant C.
Pure logic in `DayDialGeometry` (`DialPalette.swift`, `DialBand.swift`, vector
tested in `PaletteTests.swift`); drawn by `DayGlanceWidget/Dial/DialFaceView.swift`.

- **Colour.** `muteDialColor` exactly as `dayDial.js`: hue kept, saturation
  capped at 0.5, lightness pinned at 0.73. The ten Tailwind hexes the task
  palette stores are in the vectors with the study's swatch values. Routine
  `#5eead4` and sleep `#c4b5fd` are fixed, not muted; an unparseable colour
  falls back to `#93c5fd` raw, as the JS does.
- **Each block** is an annular sector fill across the 22pt band (its lane's
  share when blocks overlap, `dialLaneBand`) plus a rim stroke on the OUTER
  edge, drawn inside the band, butt caps:

  ```
  t            = min(1, durationMin / 180)
  fill opacity = min(1, (0.05 + 0.11t) × 3.5 × stateFill)
  rim width    = 1.5 + 1.0t  pt
  rim opacity  = min(1, (0.45 + 0.55t) × stateEdge)
  ```

- **State multipliers** (fill / edge), as `DayDial.jsx`'s `blockTone`.
  `completed` is read before `past`: a block ticked off early is done now.

  | state | fill | edge |
  |---|---|---|
  | future / current | 1.0 | 1.0 |
  | completed | 0.6 | 0.25 |
  | past, undone (task) | 0.35 | 1.0 |
  | past event, or last night's overrun | 0.6 | 0.6 |
  | sleep | 0.6 | 0.6 |
  | sleep, past | 0.36 | 0.36 |

- **Routines** are rim only: opacity 0.5, completed 0.18, ABSOLUTE (no
  duration curve), rim width from `t` as above. No fill.
- **Separators:** a 1.6pt cut in the background colour where two consecutive
  blocks touch (§3), drawn last.
- **Not surviving:** the web dial's blurred glow (§7). Flat fills only.

**Projected days: required rule.** A projected day's completion flags are
always false, because the state cannot be known. Under the multipliers above
every past block on such a day would render as "past undone" with a full
rim, and each morning the widget would mark finished work as unfinished. So
on a day the resolution tier marks as projected (`WidgetDayTier.projected`),
every past task and routine takes the past-event tone (0.6 / 0.6; routines
0.18) regardless of its flag, and completion is not read at all, even on the
future half. Only the pushed day uses completion. Stale and unknown tiers
draw as pushed: their flags are the user's own, merely old. Both paths are
tested (`testProjectedDayNeverMarksPastWorkAsUndone`,
`testProjectedRuleReachesTheStyledBlocks`).

**Cache key.** Past/future now depends on the time, not only on the
snapshot: a block changes state when it ends. The cached static face
(`DialFaceCache`) is keyed on

```
face-v1 | digest(face input) | <w>x<h>@<scale>  -b<n>
```

where the face input is exactly what the ring and sky draw (blocks with
their flags and colours, the 24 sky strengths, sunrise/sunset/moon, the
tier) and `n` is `DialBand.pastBucket`: the number of blocks whose end is at
or before the entry's minute. The ended set is a prefix of the blocks in end
order, so its size names it; the key changes precisely at each distinct end
minute, 8–12 cold renders on a full day against Phase 0's 28 ms. Digesting
the face input rather than the raw snapshot means a push that only moved
goals or the Up Next list leaves the image valid. Old files are pruned on
each cold render.

### Hub

Rule sits at `y=189`, collinear with the 06/18 tick row. Rows:

| y | Content | Type |
|---|---|---|
| 138 | `TUESDAY` | 9.5pt, 600, tracking 3.2, white @ 46% |
| 172 | `July 7` | **Lora 500, 28pt**, white @ 96% |
| 189 | rule | 68pt wide, white @ 16% |
| 211 | task title | 15pt, 600, white @ 95% |
| 229 | `#work` | 11pt italic, white @ 44% |
| 249 | `until 12:30 · 1h 10m left` | 11.5pt, white @ 58% |
| 266 | `then 1h open` | 11pt, teal `#4ec9b0` @ 72%, only when gap ≥ 30 min |

Everything else is SF. Title needs single-line tail truncation — the hub is
circular, so usable width shrinks as rows move away from centre. At `y=211`
there's ~113pt.

**Landed in Phase 3** (`DayGlanceWidget/Dial/DialHubView.swift`, constants
in `DialSpec.Hub`). Three things the table above leaves implicit:

- **Every `y` is a text baseline**, not a box centre: the spec draws the
  rows as SVG `<text>` with `text-anchor: middle` and no `dominant-baseline`.
  The view converts baseline → frame centre with the font's own ascender and
  descender (`DialHubTypography.centerY`), which is the one piece of
  arithmetic that cannot live in the geometry package.
- **Row width is a rule, not a number:** half the chord of the sky ring's
  inner edge (r = 116) at the row's baseline, less a 6pt inset —
  `DialSpec.Hub.halfWidth(atY:inset:)`. That is ~114pt a side at the title
  row and ~87pt at the runway row. The title shrinks to 0.8× first, then
  tail-truncates; every other row truncates directly.
- **The hub is an overlay, never in the cached PNG.** The current block and
  the countdown change per entry; baking them in would invalidate the face
  cache every entry instead of at block boundaries, and Phase 4 needs the
  countdown to be a live `Text`. The Phase 2 cache key is unchanged: titles,
  tags and true ends ride on `DialFaceBlock` but are not in the digest.
- **Type sizes are fixed**, not Dynamic Type. The list widgets use text
  styles and scale; the dial is the deliberate exception because its
  geometry is fixed and an accessibility size would overflow the circle.
- **Facts come from `DialHub.resolve`** per entry: the running task, event
  or routine (latest-starting when nested; sleep is never narrated), its
  TRUE end (across midnight when it runs over), and the gap to the next
  narrated block, shown as the runway only when ≥ 30 minutes and never when
  the current block ends tomorrow. No current block → the four lower rows
  stay empty (Phase 5 writes that copy).
- **Strings:** "until %@ · %@ left" and "then %@ open" in the string catalog
  for every locale; the clock follows the snapshot's `use24Hour` exactly as
  the other widgets do, and the durations are the system's narrow units
  (`Duration.formatted(.units(...))`), so no hand-written plural forms exist
  to get wrong.

---

## 3. Block boundaries

Blocks draw at **exact spans**. Where two blocks touch (`a.end == b.start`),
draw a 1.6pt radial line in the background colour across the band.

Rejected alternative: trimming each arc end to leave a hairline gap. It
under-draws short blocks disproportionately — a 20-minute block loses ~21% of
its visible arc, a 2.5-hour block only 2.8%. Wrong failure mode for a time
instrument.

---

## 4. Sky ring

One band, sun by day and moon by night, colour and opacity driven by strength,
width constant. Sunrise and sunset are its zero-crossings; the moon glyph
explains the night half's brightness.

| | Colour | Opacity |
|---|---|---|
| Sun segment | `#d9b33c` | `0.10 + strength × 0.66` |
| Moon segment | `#c3c3e8` | `0.09 + strength × 0.52` |

Per hour, take the strength at the midpoint; whichever of sun/moon is greater
picks the colour.

**Do not port `solar.js`.** Per the feasibility findings, ship the derived bands
in the snapshot instead — the 8,088-byte option. Two independent solar
implementations that must agree to the minute is a bug source, and 8KB against
the 200,000-byte cap at `WidgetBridge.swift:27` costs nothing.

**The curves in the HTML spec are placeholders.** Sun is a sine between sunrise
and sunset; moon is phase × sine across the moon's window with phase hardcoded
at 0.5. Both are shape-only reference. Real values come from the snapshot. The
visible difference: the real sun curve leans later than the daylight midpoint
and falls off faster in the afternoon.

### Glyphs

Upright at r=104. Sunrise and sunset are a half-disc on a horizon line with
three rays, plus a chevron — up and above the disc for sunrise, down and below
the horizon for sunset. Two independent cues, so it still reads if one is lost
at small size. Moon is an outlined circle with the lit fraction filled.

---

## 5. Data

Everything the widget draws arrives in one JSON snapshot, built in
`src/App.jsx`'s widget effect and handed to `WidgetBridge.updateSnapshot`
(200,000-byte cap at `WidgetBridge.swift:27`). Decoded on the Swift side by
`WidgetModels.swift`. As of Phase 0 it carries, for the dial:

**`dial` — the ring.** Every timed block of the local day, *whether or not it
is done or already over*, plus the sleep window and today's routines, in one
start-sorted list. Produced by `projectDialSnapshot` (`src/utils/dayDial.js`)
over `computeDialModel` — the same model the in-app dial renders, so the
widget and the dial cannot disagree about the day's shape. Per block:

| field | notes |
|---|---|
| `type` | `task` · `event` (read-only imported calendar) · `routine` · `sleep` |
| `startMin`, `durationMin` | local minutes from midnight; `durationMin` is the **drawn** span, already clipped at midnight — `endsNextDay: true` + `endMinTrue` carry the real end when it was |
| `completed` | tasks, events, routines. Read by the block band's state multipliers on the pushed day only (§2 "Block band"); on a projected day it is always false and is not read |
| `kind` | `effort` · `restore` — the energy axis, tasks/events only |
| `colorHex` | tasks/events only; routine and sleep take the widget's fixed colours (spec: `#4ec9b0`, `#6f6f9e`) |
| `title`, `tag` | display title (no wikilinks, no `#tags`) and the first tag *without* its `#`, on every task/event/routine. On every block, not only the running one: the widget renders a 24-hour timeline from one snapshot, and which block is "current" changes with the entry, not with when the snapshot was pushed |
| `lane`, `laneCount` | concentric lane for overlapping blocks; a lone block is 0 of 1 |
| `startedPrevDay: true` | last night's overrun, drawn from midnight |

Nothing else: no notes, subtasks, project links, or anything the ring and hub
do not draw. Not tag-filtered (`getTasksForDate(today, false)`): the home
screen shows the day, not a filtered view of it.

**Why this is its own field.** The snapshot's agenda-shaped fields —
`sections[].tasks`, `overdueToday[]`, `nextTask`, `upcomingTasks` — are all
built from `todayAgenda` (`App.jsx`, the `useMemo` near line 6706), which
**hides a completed task once it has ended** (*"Past: hide completed tasks"*).
That is right for an agenda and wrong for a dial: a completed 9 AM block still
has to be on the ring at 3 PM, dimmed. `todayAgenda` is deliberately untouched
— it also feeds the now-marker, three context values, the mobile and desktop
layouts, the Glance sidebar, the Electron bridge and the Stream Deck payload.

**`sky` — the sky ring.** From `computeSkySnapshot`, the same solar and lunar
math as the in-app bands, never re-solved in Swift (§4):

```json
{"sunriseMin":391,"sunsetMin":1138,"polar":null,
 "hours":[{"sun":0,"moon":0}, …24 entries sampled at hh:30…],
 "moon":{"fraction":0.306,"waxing":true,"glyphMin":1148}}
```

`sunriseMin`/`sunsetMin` are the exact local minutes for the glyph angles
(null, with `polar` set, on a polar day or night); `hours[h]` is the strength
at the hour's **midpoint**, the value §4's per-segment rule wants; `moon` has
the lit `fraction` for the glyph and `glyphMin`, the minute the in-app dial
places its moon glyph at. Null until a location has been geocoded
(`useWeather` stores the coords after each successful geocode, whether or not
header weather is on; the field is Settings → Weather on desktop and tablet and
Settings → App Settings → Location on phones (`MobileSettingsPanel`, the
phone's own settings surface; phones never open `SettingsModal`), which had no
way to set one until the dial shipped there), in which case the face draws the
ring **unlit** (a neutral track at the sky radius, `DialSpec.skyUnlitOpacity`)
and no glyphs. Decided after the first device run of the real widget: the
empty band read as a rendering fault, not as "no location". The widget's
`daydial` Console line prints `sky=none` in that state, and
`DayGlanceWidgetTests` pushes a live-shaped payload
(`TestFixtures/widgetSnapshot.live.json`, from the real JS producers) through
the decoder, day resolution and face mapping and samples the rendered ring,
so the fixture-fed `DIAL_PREVIEW` widget can no longer hide a skyless live
path.

**Hub.** Title, tag, and end time come from whichever `dial` block contains
the entry's time (`startMin ≤ t < startMin + durationMin`); "until hh:mm ·
Xm left" from its end against the entry's time; "then Xh open" from the gap to
the following block. Derive these from `dial` per entry — `daySummary.upNext`
also carries a preformatted `timeLabel` and countdown, but that is the Live
Activity's single-moment fact and is only right for the entry at push time.
`dateLabel` and `use24Hour` for the date rows are already present.

**Size**, on the spec's dense day (20 dial blocks) against the 200,000 cap:

| | bytes | of cap |
|---|---|---|
| `sky` | 633 | 0.3% |
| `dial` | 3,285 (~164 per block) | 1.6% |
| whole snapshot, typical | **16,752** | **8.4%** |
| whole snapshot, goals/projects off | 9,309 | 4.7% |

---

## 6. Rendering approach

**Decided: cached image.** The spike in PR #1670 ran on device (iPhone 15, A16)
and the cached-image path cleared every bar in the table below by a wide
margin; the numbers are under "Result" at the end of this section. Live paths
were not measured — the decision rule does not need them once the cache path
is clean.

The findings give the likely answer: 18 of ~985 elements move with the needle
(1.8%), and `NowLine` is rotationally invariant. So:

1. Render the static dial once with `ImageRenderer`, cached to the App Group,
   keyed on a hash of the snapshot.
2. Each timeline entry = that image + a `.rotationEffect` needle + the past/future
   dimming, which changes only at block boundaries (8–12×/day).

That's ~985 rasterisations once rather than per entry.

**Timeline cadence:** 96 entries at 15-minute steps. On a 24-hour dial that's
3.75° per step and under two minutes of positional error — imperceptible.

**Reload budget:** the ~40–70/day budget governs provider calls, not entries, so
96 entries is one reload. But dayGLANCE is a planning app where blocks get
dragged constantly, and every edit that should be reflected costs a
`reloadTimelines`. Debounce, or fire on commit rather than on every drag.

`Text(style: .timer)` stays live between entries — use it for the countdown.

### Deciding between the two paths

Measured with the spike from PR #1670 (its file header says how to read the
numbers). The criteria are not conjunctive: a defect in the cache path is
enough on its own to reopen the question, whatever live paths measure.

| cached image | live paths | decision |
|---|---|---|
| clean — `baseImage` under ~500 ms, correct at device scale, PNG survives across provider calls, per-entry gap small | anything | **cached image.** The default; live clearing its bar too is noted, not acted on |
| **defect** | fast and light — median inter-entry gap < ~15 ms **and** footprint < ~15 MB across all 96 | **live paths** |
| **defect** | slow or heavy | **neither is ready — stop and talk.** The options on the table are batching same-style shapes (cuts live's view count ~80%), fewer entries, or a different architecture; none is a default |
| clean per entry, but total archival > ~5 s | — | cached, with fewer entries (48 at 30 min) as a last resort — it makes the needle worse |

"Clean" and "defect" are about the cache path's own behaviour, not about how
it compares to live.

### Result

Cached-image mode, iPhone 15 (A16), read off the widget's corner readout
(PRs #1709 and #1710) rather than Console; the earlier Console run matched.

| measured | value | bar | result |
|---|---|---|---|
| `baseImage` cold `ImageRenderer` pass (key forced to miss) | 28 ms | < ~500 ms | clean |
| footprint on the entry that rendered it | 13 MB | < ~20 MB | clean |
| footprint / headroom on the first entry of the earlier run | 18.1 MB / 11.9 MB avail | < ~20 MB | clean; the two sum to the 30 MB cap, so headroom is real |
| entries shown | corner `1/96 · 08:01` → `18/96 · 12:16`, exactly on the 15-minute schedule over 4 h 15 min | all 96, on time | clean |
| image at device scale | crisp, no blur; needle at the correct angle | correct at device scale | clean |
| PNG across provider calls | later reloads in the first build hit the on-disk PNG (which is why the cold cost had to be forced with a new cache key) | survives | clean |
| crashes | none in Settings ▸ Analytics Data | none | clean |

Derating for the fleet: A16 is ~1.1–1.15× an A15 and ~1.8× the A12 floor
(iPhone XS/XR, the extension's iOS 17 minimum). Memory numbers transfer as
measured; the cold render becomes ~32 ms on an A15 and ~50 ms on an A12, still
an order of magnitude inside the bar. No reason to re-run on older hardware
before Phase 2.

Two things seen on the glass that are not defects: the hub is empty (Phase 3
draws it) and some detail is too small to read at widget size (the spike draws
web geometry unchanged; sizing is Phase 2 design work, see §7).

---

## 7. Known gaps

- **`Canvas` does not render in WidgetKit.** Use `Path` / `Shape`.
- **The glow does not survive.** The web dial uses `feGaussianBlur`
  (`DayDial.jsx:1225-1227`); there's no cheap `Path` equivalent in a widget. Flat
  fills. The widget will be slightly more austere than the desktop render.
  Confirmed in Phase 2: the 2.4× halo stroke under the blur is not drawn.
- **The hub is an HTML overlay, not SVG** (`DayDial.jsx:1363`), so the centre
  stack is new work rather than a port.
- **Complications are out.** They need ≥520px (`DialComplications.jsx:47`);
  `systemLarge` is ~364pt.
- **`dayDial.js` geometry is reusable as logic, not as drawing** — 42 pure
  exports; 140 tests in `dayDial.test.js` (the "144" quoted earlier was 131
  there plus 13 in `solar.test.js`). The vectors are exported:
  `dayglance-ios/TestFixtures/dayDial.vectors.json` — 171 geometry, 16 sky and
  2 snapshot cases, regenerated by `npm run ios:vectors` and held to the code
  by `dayDialVectors.test.js`. Run the Swift port against them; it won't
  reduce the work, but it stops the two implementations silently diverging.
- **Lora is bundled in the extension target** (done in Phase 3, not Phase 5:
  the date row cannot be drawn without it). `DayGlanceWidget/Fonts/
  Lora-Medium.ttf` (PostScript name `Lora-Medium`, weight 500) is registered
  through `UIAppFonts` in the widget's Info.plist (project.yml), the OFL text
  sits alongside it and the README's licence section credits it. Google
  Fonts is not reachable from a widget process. `DialHubTypography.
  loraIsInstalled` checks the registration at runtime and the preview prints
  it in its corner, because the system serif fallback is close enough to
  fool a glance.
- **A placeholder view is required.** Done in Phase 5: `DialFaceInput.
  placeholder` (a fixed mid-latitude sky, ticks, labels, no block band) with
  a hub of weekday and date only; a never-opened install shows the same face
  plus "Open dayGLANCE to set up".
- **`widgetURL`.** Done in Phase 5: `dayglance://day?date=YYYY-MM-DD&view=dial`,
  handled by App.jsx's deep-link drain (`openDayFromLink`): the day the
  widget showed is selected and the Day Dial opens over it.

---

## 8. Still to verify on device

1. ~~Render budget across the timeline.~~ **Verified** (§6 "Result"): 96
   entries on schedule, 28 ms cold render, 13–18 MB footprint on an A16.
2. Low-opacity sky-ring segments at dawn and dusk on OLED in daylight — opacity
   carries the signal alone now that width is constant. If the faintest segments
   disappear, raise the floor and compress the range rather than widening.
3. Lora 500 at 28pt — display serifs can go spindly when shrunk. May need 600.
4. Dense-day legibility of the separator cut at 1.6pt.
5. **Sunrise/sunset glyph angles match real solar times** for the device's
   location — the spec fixture's 05:37 / 20:31 are placeholders. Compare the
   drawn glyphs against `sky.sunriseMin` / `sunsetMin` in the snapshot and
   against a reference almanac for the day; a mismatch is a `computeSkySnapshot`
   or angle-mapping bug, not a design question.
6. **Tinted.** Long-press the Home Screen → Edit → Customize → Tinted, pick a
   colour. The Day Dial: white ring, band and glyphs on the tinted ground,
   hub text and needle visible, separators showing as gaps between touching
   blocks. The Dial Preview's corner reads `accented`. Up Next, Goal and
   Project: text, bars and progress in white, nothing missing. Screenshot each.
7. **Clear** (iOS 26): the same menu → Clear. Same expectations on the glass
   background; the face's transparent ground is what lets the wallpaper show
   through the dial. Screenshot.
8. **Small iPhone.** On an SE or 8 (321×324) or a mini (329×345), or in the
   simulator: the dial fills the widget's height with a few points of side
   margin, the hour labels and the projected note stay legible, nothing is
   clipped. The sweep's numbers are in "Phase 5 decisions" → Sizes.

---

## 9. Phase plan

Six phases, ~15 engineer-days for iOS. Phase 0 can reshape phases 2 and 4, so
the total is more reliable than any single line below.

| # | Phase | Est. | Done when |
|---|---|---|---|
| 0 | Spike + unblocked plumbing | 2d | Rendering architecture chosen on device evidence; snapshot extended; fixtures exported. **Closed**: cached image chosen on the iPhone 15 run (§6 "Result") |
| 0b | Dial blocks in the snapshot | 0.5d | `dial` field carries every timed block of the day (§5). **Landed** in the follow-up to #1670. Parallel to Phase 1; gates Phase 2 |
| 1 | Geometry port | landed | **Landed**: `dayglance-ios/Packages/DayDialGeometry`, pure Foundation, no UI. Its XCTest target loads `TestFixtures/dayDial.vectors.json` and asserts every geometry case; `ios.yml` runs it with `swift test`. Spec radii and rules win where the two dials differ (list below). Palette treatments are seams only (`DialPalette.swift`) — the Phase 2 gate |
| 2 | Static dial | landed | **Landed**: `DayGlanceWidget/Dial/` — `DialFaceView` (sky ring, glyphs, track, ticks, labels, variant C block band, separators, needle), `DialFaceCache` (ImageRenderer → PNG in the App Group, keyed as §2 "Cache key"), `DialFaceInput` (snapshot → what the face draws). Palette and band logic in `DayDialGeometry`, vector tested |
| 3 | Hub | landed | **Landed**: `DialHubView` overlay (all seven rows, baseline-placed, chord-bounded; §2 "Hub"), `DialHub.resolve` in the package (tested), Lora bundled and registered, the two hub strings in the catalog. To see it: `DG_WIDGET_FLAGS="DIAL_PREVIEW" npm run ios`, run on the phone, add the "Dial Preview" widget once per scenario and long-press → Edit Widget → Scenario (short title, long title, sparse with runway, dense without, projected) |
| 4 | Timeline + needle | landed | **Landed**: `DayDialWidget` registered in the bundle (name and description only; Phase 5 does the metadata, placeholder and `widgetURL`), a `TimelineProvider` over `ResolvedWidgetDay`, the entry set from `DialTimeline` in the package (tested), the live countdown, the face cache's eviction policy, and the resize gate on the app's push. Details below |
| 4b | Day rollover without the app | landed | **Landed** (day-keyed snapshot, `docs/widget-background-refresh-plan.md` "What landed"): the snapshot carries today+1…today+3 with per-block tags kept, iOS timelines get a midnight entry per day, Android an exact-or-inexact midnight alarm. The dial's Phase 4 timeline must be built from `ResolvedWidgetDay` so the entries after midnight draw tomorrow's `dial` from `days[]`; the projected tier's soft label matters less on the dial than on Up Next (past blocks dim by time, not completion — only the hub is really projecting), so do not over-treat it |
| 5 | States + ship | landed | **Landed**: the hub's open-time, sleep and runway-to-sleep copy (`DialHub.resolve` + `DialHubView`, tested), placeholder and no-data faces, the projected note and the Outdated and time-zone-changed states in the hub, the hemisphere flag and mirrored moon, `widgetURL`, a single VoiceOver summary, the screenshot day and every state as a `DIAL_PREVIEW` scenario. Rendering modes (a mono face for the accented mode, keyed apart) and the size sweep (`SizeSweepTests`, every systemLarge size) landed in the second Phase 5 PR — see "Phase 5 decisions" |

**All phases are done for iOS.** The cached-image path won (§6 "Result");
phase 2 is the `ImageRenderer` pass over the static face, and phase 4 is the
needle per entry, the timeline built from `ResolvedWidgetDay`, and the reload
gate on top of the cached PNG. There is no past-dimming sector any more:
variant C tones each block by state, so the cache key carries the ended-block
bucket instead (§2 "Cache key"). The spike (`DIAL_SPIKE`,
`DayGlanceWidget/Spike/`) was retired in Phase 4; its numbers live on in §6.
The preview widget (`DIAL_PREVIEW`, `DialPreviewWidget.swift`) stays: it is
how a scenario is eyeballed and how App Store screenshots are captured from a
curated fixture day, so it is not to be removed when the real widget changes.

**Phase 4, what landed and the decisions in it** (`DayDialWidget.swift`,
`DialTimeline.swift`, `DialFaceCache.swift`, `DialHubView.swift`):

- **Entry set.** The union of the 15-minute grid for 24 hours (the needle),
  an exact entry at every block start and end in range on each renderable
  day (the hub's current block, the band's past tone and the cache bucket all
  change there; a block ending at 06:25 no longer waits for 06:30), each
  local midnight the payload can render (the day switch through
  `ResolvedWidgetDay`, as the other widgets do), and the midnight after the
  last renderable day, which is the entry that renders Outdated. Deduplicated
  and sorted; policy `.atEnd`. Counts, pinned by `TimelineTests`: the palette
  study's dense day today and projected tomorrow gives **98** entries; 24
  blocks a day at odd minutes gives **144**; the bound is 96 + 2 × blocks in
  range + midnights. An entry carries the date and the decoded snapshot, never
  an image.
- **Needle.** Each entry composes the cached face PNG (fetched through
  `DialFaceCache` at render time, one decoded face kept in memory), the hub
  overlay and the needle. The face is re-rendered only when the cache key
  changes, i.e. at a block end (the bucket), a tier change or a new size.
- **Countdown: static, after trying live.** Phase 4 shipped the live form —
  `Text(end, style: .relative)` spliced into the catalog phrase "until %@ ·
  %@ left" in the duration's slot, so the words stayed translated and the
  number was system-updated — and on the phone it was rejected: under an
  hour the relative style counts **seconds** ("17 min, 37 sec left"), which
  read as noise, and it spells the units so the row shrank. The widget now
  draws the static rounded form ("17m left", "35m open"), exact at each
  entry; with the 15-minute grid plus an entry at every block boundary the
  number is at most a quarter of an hour old and never counts past zero.
  Tightening that to 5 minutes would triple the entry count (~300, each an
  archived view). The live splice stays in `DialHubView` behind
  `countdownEnd` / `openEnd`, unused by the widget.
- **Cache lifetime.** `DialFaceCache` bounds the App Group directory three
  ways, enforced on every write, oldest first: **12 MB, 40 files, 48 h**. The
  file just written is never evicted. A timeline build ends by retaining only
  the faces of the days it can render at the current size. A file that does
  not decode, or decodes to the wrong pixel size, is deleted and re-rendered;
  an entry never fails on a bad file. Writes are atomic, so a truncated file
  cannot come from this code. The extension's state ceiling is the 12 MB plus
  one decoded face in memory (~5 MB at 3×).
- **Reloads.** Only the gate from #1721: the app pushes with
  `reloadWidgets:true` only when today, tomorrow or the invariants changed,
  and `WidgetBridge` reloads only then. Phase 4 added one gate on the app
  side: the snapshot effect does nothing while a block is being **resized**
  (a resize writes state at every 15-minute step of the drag; a move commits
  on drop already) and pushes once when the drag ends. The provider adds no
  gate of its own.
- **Console.** `subsystem:com.dayglance.app category:daydial` prints one line
  per timeline build (`entries= days= boundaries= faces= cold= coldMs= cache=N
  files/M bytes builtMs= sky= first= last=`); `category:dialface` prints each
  cold render, each eviction and each discarded file.
- **Glyphs on the live path.** The second device run drew the ring and no
  sunrise, sunset or moon glyph. The glyph views had a zero-sized frame,
  offset to the glyph point: fine on screen, but `ImageRenderer`, which the
  face cache renders through, rasterises nothing for a zero-sized view. They
  now lay out in a real `DialSpec.glyphFrame` square centred on the point,
  and `LiveSnapshotSkyTests` samples the three glyph points on the rendered
  live face. (The `DIAL_PREVIEW` faces had the same gap; nobody had looked
  for the glyphs there since the cache landed.)
**Phase 5 decisions** (`DialHub.swift`, `DialHubView.swift`,
`DayDialWidget.swift`, `DialPreviewWidget.swift`):

- **Empty state.** Nothing narrated running → the title row is open time in
  the runway's teal, live through the same marker splice as the countdown
  ("35m open"), and the row below names what ends it: "until <title> at
  14:00" (the title measured and cut so the time always survives), "until
  sleep at 23:00", or "Nothing else today". Inside a sleep block: "Sleep",
  muted, and "until 06:25" to its true end. The runway after a current block
  may now end at sleep and says so: "then 2h 30m until sleep".
- **Placeholder and no data.** `DialFaceInput.placeholder`: the study's sky
  (a lit ring and glyphs), ticks and labels, no block band, hub with weekday
  and date only. The gallery gets it; a never-opened install gets it plus
  "Open dayGLANCE to set up". The unlit ring stays for a REAL day without a
  location; a gallery card is not a real day.
- **Freshness in the hub.** Projected day: "Planned as of Mon 8:42 PM" as the
  lowest, smallest row (`DialSpec.Hub.noteY` = 281, 9pt, 40 %), under the
  runway and inside the ring, shrinking to 0.8 before truncating; the task
  rows read first. Outdated: the face alone is dimmed, the task rows become
  "Outdated" and the "as of …" detail, and the needle stays because the time
  is right. The old bottom capsule is gone.
- **Time zone: labelled, not re-projected.** The snapshot now carries the IANA
  zone its minutes were computed in (`timezone`). When the device's offset
  differs at the entry's instant (`WidgetFreshness.zoneChanged`, compared by
  offset so aliases and same-offset zones never flag), the dial dims the face
  and shows "Time zone changed · Open dayGLANCE to refresh". Re-projection
  was rejected: the payload is day-keyed and minute-based, so shifting by the
  offset delta moves blocks across the midnight boundary into a day the
  payload may not carry, splits the sleep block, and disagrees with the sky
  (sampled in the old zone) — correct across day boundaries only with a
  rebuild, which is what the next foreground push is.
- **Southern moon.** `sky.southern` (the sign of the latitude, never the
  coordinates) mirrors the moon glyph's lit limb via `MoonPhase.geometry(…,
  mirror:)`, as DayDial.jsx does.
- **`widgetURL`.** `dayglance://day?date=<shown day>&view=dial`: App.jsx
  selects the day and opens the Day Dial over it (the app's dial is a modal
  over the day, which is the route). Without a payload the link still opens
  the app.
- **VoiceOver.** One element, one label: "Monday, September 21. Now: Write API
  documentation, 1 hour, 10 minutes left. Then 4 hours, 30 minutes open." —
  the same catalog strings as the rows with wide durations
  (`DialHubView.summary`, tested).
- **Screenshot day.** A `DIAL_PREVIEW` scenario built as a real payload for
  TODAY and rendered through `DayDialWidgetView` with the live countdown, so
  the store shot is the shipping path. Shoot between 10:00 and 12:30: "Write
  API documentation", a live countdown, "then 1h 30m open".
- **Preview scenarios** now exist for every state above (`DialPreviewWidget`
  header lists them); the four face scenarios stay for palette comparison.
  The corner prints the rendering mode (`fullColor` / `accented`), so a
  tinted or clear Home Screen is confirmed as the accented mode at a glance.
- **Rendering modes (the second Phase 5 PR).** Why tinted was blank: on a
  tinted or clear Home Screen (iOS 18+) WidgetKit renders the widget in the
  *accented* mode — every view is painted white at its own opacity, images
  included (an image with no `widgetAccentedRenderingMode` takes the primary
  colour at its alpha), and the container background is replaced. The face
  was an OPAQUE PNG (the background baked in so the band composites once), so
  it became one solid white rectangle, and the hub text and the needle,
  also white, disappeared into it: blank, hub included. The treatment is a
  second face for that mode, not a re-colouring of the first: `DialFaceView
  .mono` draws the same geometry in white at the spec's opacities on a
  TRANSPARENT ground (the system's alpha-preserving tint then does the
  rest), and the separators — background-colour lines in full colour, which
  would have become white cuts — are erased out of the band with
  `destinationOut` instead. It is rendered and cached under its own key
  (`face-v4-mono-…`; the mode is part of the key, `RenderingModeTests`), and
  the provider warms it whenever `context.environmentVariants
  .widgetRenderingMode` says the widget may be shown accented, so a tinted
  first render is as warm as a colour one. The needle is `widgetAccentable`
  (white on iOS, where both groups are white; the theme's accent on
  platforms that give one). Clear (iOS 26) is the same rendering mode with a
  glass background, so it needs nothing more. Block colours are lost in that
  mode by design — state (past/future tone), duration (fill weight) and the
  rims still read. Nothing in the three list widgets needed changing: they
  are text, dividers, capsules and progress bars in system colours, which the
  mode paints correctly; the only image is an SF Symbol.
- **Sizes.** `DialCanvas` scales the 364×382 canvas by
  `min(w/364, h/382)` about its centre and the cache renders at the same
  factor (`pixelScale`); `SizeSweepTests` renders the canvas at every
  systemLarge size in Apple's tables and checks the band lands at the same
  scaled radius on both axes: iPhone 321×324 (SE/8, factor 0.848), 329×345,
  338×354, 348×351, 360×379, 364×382 (1.0); iPad 306×306 (mini and 9.7",
  0.801, the floor), 321×321, 328×328, 342×342, 379×379 (0.992). The
  smallest type on the floor: the 9pt projected note at 7.2pt (5.8pt after
  its 0.8 minimum scale), the 10.5pt hour labels at 8.4pt, the 11.5pt
  countdown at 9.2pt. Legible on a 2× iPad mini in a test render; if it is
  not on glass, raise `noteFontSize` before dropping the note's minimum scale.
- **Deferred.** The Android port and Wear OS (§"Android, if it happens").
  The projected-day limitation stands: a day the app has not opened carries
  its shape, not its state (no routines, no completions; §"Phase 4b").
- **Release notes.** *Day Dial widget (iOS): your whole day as a dial on the
  home screen — sky, blocks, the current task and what comes next, updated
  through the day without opening the app.* And, from Phase 4: *Widgets no
  longer reload on every step of a block resize; they update once when you
  let go.*
- **Sky on the live path.** The first device run drew no sky ring: the
  payload's `sky` was null (no geocoded location in the app) and the face
  drew nothing there. The face now draws the ring unlit in that state (§5
  "sky"), the `daydial` line says `sky=none`, and `DayGlanceWidgetTests`
  (a simulator test target, run by `ios.yml`) pushes the live-shaped
  fixture through the real decode → resolve → map → render path and samples
  the ring, lit and unlit.

**Phase 4b was a gate, found late, and is closed.** Only the WebView writes
widget content, so every shipping widget held yesterday's data after a night
in the background. Two fixes landed: the stale state (honest, not fresh) and
then the day-keyed payload (fresh for the day). What a projected day cannot
carry, and what the dial should therefore expect on a day the app has not
opened yet:

- **No routines.** Routine chips are placed by the user each day and a new
  day genuinely starts empty, so a projected dial has no routine bars until
  the app opens that day. That is honest, not a bug; the soft "Planned as of"
  label covers it and nothing should try to synthesise them.
- **No completions, no habit counts, no overdue carry.** The block band
  reads completion on the pushed day only; on a projected day every past
  block takes the past-event tone (§2 "Block band", the projected-day rule),
  so the ring never claims a finished block was left undone. Only the hub's
  done/remaining phrasing is a projection.
- **Per-block tags and project references are kept** at full richness, so
  the hub names each block and its tag as it becomes current.

**Phase 1 is the largest single block and the most mechanical.** It is isolated
deliberately: it has no UI, it is fully testable against the exported fixtures,
and it is the only phase whose output serves a future Android port unchanged.

### Where dayDial.js and the spec disagree (the spec wins for the widget)

Found while porting; each is named in the Swift where it applies.

| Topic | Web dial (`dayDial.js`, what the vectors pin) | Widget spec (what `DialSpec` implements) |
|---|---|---|
| Tick schedule | 288 ticks every 5 min: hour / quarter / minor (`dialTicks`) | 96: major on the hour, minor at 15 min, nothing finer. `DialTicks.schedule(stepMinutes:)` yields both; `DialSpec.ticks` is the spec's |
| Hour labels | 8, every 3 h; one hides within 30 min of a sun glyph (`dialLabelYieldsToSun`) | 6, no `06`/`18`; cardinals at 172, diagonals at 181; glyphs sit at 104 so nothing yields |
| Block edges | each arc padded by up to 3 min per side, yielding on slivers (`padDialSegment`) | exact spans, 1.6pt separator cut where two blocks touch (§3). `DialSegments.pad` is ported for the vectors; `DialSpec.separatorMinutes` is the spec's rule |
| Block fill | per-task colour muted into one pastel family, intensity by duration, state multipliers, a blurred glow | **Decided for the app's treatment**, variant C (§2 "Block band"): the same mute, curve and multipliers, fills ×3.5 and the rim given a 1.5pt floor for widget scale, no glow, plus the projected-day rule the app never needed. The spec render's solid band is superseded |
| Canvas | 1000-unit viewBox, ring 300–385 | 364×382pt, block band 129–151 at 140 |

Nothing in the vectors contradicts the spec: the geometry functions are
radius-agnostic and the fixture evaluates them at both canvases, so no
"stop and ask" case arose.

### What the port does not re-derive, and why

- **The sky** (`computeSkySnapshot`, `computeDaylightBand`, `computeMoonBand`,
  `getSunTimes`): consumed from the snapshot per §4. The Swift test decodes
  the fixture's sky cases and checks the 24-segment shape the ring draws from
  and the spec's opacity mapping; it does not solve solar or lunar positions.
- **Block data** (`kind`, `colorHex`, `completable`, titles, the day's
  totals): `computeDialModel` derives these from task fields via
  `deriveBlockEnergy` and `taskColorToHex`, which drag in the energy keyword
  list, tag extraction and the Tailwind colour map. They travel in
  `dial.blocks`; the port compares only the geometric fields of those cases.
- **Routines on a projected day**: none (see phase 4b). `DialModel.routineBars`
  is ported and vector-checked for the pushed day.
- **`dialSelection`** (keyboard walk): web accessibility UI, no widget analogue.

### Android, if it happens

Roughly phases 2–5 again on the bitmap + FileProvider path described in the
feasibility doc, plus phase 1 repeated in Kotlin: ~10–13 further days. The
phase 1 fixtures serve both ports, which is the main argument for exporting
them properly rather than expediently.

Worth deciding after iOS ships, not before — the needle-drift problem on
Android (`updatePeriodMillis` floors at 30 min; WorkManager's minimum periodic
interval is 15 min with flex, and Doze defers it on an idle device) may change
what is worth building there.
