# Day Dial — iOS `systemLarge` widget: handoff

**Status:** design settled, ready to build. iOS only for now.
**Companion files:** `docs/day-dial-widget-spec.html` (reference render, exact geometry),
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
| Block band | 140 | 22 | Past blocks at 42% of category alpha. |
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
| `completed` | tasks, events, routines. Shipped now even though the ring dims by time alone, so rendering unfinished past blocks differently later is not a second snapshot change |
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
places its moon glyph at. Null until the weather feature has geocoded a
location, in which case the ring is not drawn.

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
- **Lora must be bundled in the extension target.** Google Fonts is not
  reachable from a widget process. Lora is OFL, so bundling is permitted;
  it needs the font file in the target and attribution in the app.
- **A placeholder view is required.** WidgetKit renders it in the gallery and
  before data resolves. A dial with no blocks has to look deliberate rather
  than broken — draw the sky ring, ticks and labels, omit the block band and
  hub task rows.
- **`widgetURL`** so a tap deep-links into the app at the right day.

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

---

## 9. Phase plan

Six phases, ~15 engineer-days for iOS. Phase 0 can reshape phases 2 and 4, so
the total is more reliable than any single line below.

| # | Phase | Est. | Done when |
|---|---|---|---|
| 0 | Spike + unblocked plumbing | 2d | Rendering architecture chosen on device evidence; snapshot extended; fixtures exported. **Closed**: cached image chosen on the iPhone 15 run (§6 "Result") |
| 0b | Dial blocks in the snapshot | 0.5d | `dial` field carries every timed block of the day (§5). **Landed** in the follow-up to #1670. Parallel to Phase 1; gates Phase 2 |
| 1 | Geometry port | 3–4d | Swift agrees with `dayDial.js` on every exported vector. No UI. |
| 2 | Static dial | 3d | Sky ring, ticks, labels, block band, separators, glyphs match the spec render side by side |
| 3 | Hub | 2d | All seven rows correct; a long task title truncates gracefully |
| 4 | Timeline + needle | 2–3d | Correct on a real phone across a full day; reloads debounced |
| 4b | Day rollover without the app | per plan | The dial shows the right day after midnight with the app backgrounded. **Ship gate**: an option from `docs/widget-background-refresh-plan.md` chosen and landed before phase 5 closes; until then the dial inherits the shared stale state (WidgetFreshness.swift / .kt) and shows yesterday dimmed with an "as of" line, which is honest but, on a full-face graphic, very visible |
| 5 | States + ship | 2–3d | Placeholder, empty day, no current task, rollover, DST, `widgetURL`, Lora bundled |

**Phases 0 and 0b are done.** The cached-image path won (§6 "Result"), so
phase 2 is a single `ImageRenderer` pass over the static face and phase 4 is
the needle, the past-dimming sector and reload debouncing on top of a cached
PNG; neither inherits render-budget pressure. Phase 1 is next. The spike
stays in the tree behind `DIAL_SPIKE` until phase 2 replaces it with the real
face; nothing else should be built on it.

**Phase 4b is a gate, found late.** Only the WebView writes widget content, so
every shipping widget held yesterday's data after a night in the background;
the fix that landed (stale detection, dimming, "as of" label, present-tense
claims suppressed) makes that honest, not fresh. A stale Up Next line is a
small thing; a stale dial is a picture of the wrong day. The plan document
lays out the options with cost; one of them has to land before the dial
ships. Phases 1–3 do not wait on it.

**Phase 1 is the largest single block and the most mechanical.** It is isolated
deliberately: it has no UI, it is fully testable against the exported fixtures,
and it is the only phase whose output serves a future Android port unchanged.

### Android, if it happens

Roughly phases 2–5 again on the bitmap + FileProvider path described in the
feasibility doc, plus phase 1 repeated in Kotlin: ~10–13 further days. The
phase 1 fixtures serve both ports, which is the main argument for exporting
them properly rather than expediently.

Worth deciding after iOS ships, not before — the needle-drift problem on
Android (`updatePeriodMillis` floors at 30 min; WorkManager's minimum periodic
interval is 15 min with flex, and Doze defers it on an idle device) may change
what is worth building there.
