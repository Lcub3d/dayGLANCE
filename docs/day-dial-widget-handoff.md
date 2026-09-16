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

Most of what the dial needs already ships. Per the feasibility findings, only
hourly sun/moon strength, sunrise/sunset and moon phase are genuinely absent;
timed blocks, the sleep window and routines are already in the snapshot.

Current snapshot is ~12,834 bytes against a 200,000 cap — 6% of budget, with
`allProjects` accounting for 44% of it. The additions are not a size concern.

---

## 6. Rendering approach

**Spike this first — it decides the architecture.** The open question is whether
a `Path`-heavy dial survives WidgetKit's render budget across a full timeline on
older hardware (A15). Answer it before committing to design work.

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

---

## 7. Known gaps

- **`Canvas` does not render in WidgetKit.** Use `Path` / `Shape`.
- **The glow does not survive.** The web dial uses `feGaussianBlur`
  (`dayDial.js:1226`); there's no cheap `Path` equivalent in a widget. Flat fills.
  The widget will be slightly more austere than the desktop render.
- **The hub is an HTML overlay, not SVG** (`dayDial.js:1363`), so the centre
  stack is new work rather than a port.
- **Complications are out.** They need ≥520px (`DialComplications.jsx:47`);
  `systemLarge` is ~364pt.
- **`dayDial.js` geometry is reusable as logic, not as drawing** — 1101 lines,
  40 pure exports, 144 passing tests. Export those test vectors as JSON and run
  them against the Swift port. It won't reduce the work, but it stops the two
  implementations silently diverging.
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

1. Render budget across the timeline on an A15. **Do this first.**
2. Low-opacity sky-ring segments at dawn and dusk on OLED in daylight — opacity
   carries the signal alone now that width is constant. If the faintest segments
   disappear, raise the floor and compress the range rather than widening.
3. Lora 500 at 28pt — display serifs can go spindly when shrunk. May need 600.
4. Dense-day legibility of the separator cut at 1.6pt.

---

## 9. Phase plan

Six phases, ~15 engineer-days for iOS. Phase 0 can reshape phases 2 and 4, so
the total is more reliable than any single line below.

| # | Phase | Est. | Done when |
|---|---|---|---|
| 0 | Spike + unblocked plumbing | 2d | Rendering architecture chosen on device evidence; snapshot extended; fixtures exported |
| 1 | Geometry port | 3–4d | Swift agrees with `dayDial.js` on every exported vector. No UI. |
| 2 | Static dial | 3d | Sky ring, ticks, labels, block band, separators, glyphs match the spec render side by side |
| 3 | Hub | 2d | All seven rows correct; a long task title truncates gracefully |
| 4 | Timeline + needle | 2–3d | Correct on a real phone across a full day; reloads debounced |
| 5 | States + ship | 2–3d | Placeholder, empty day, no current task, rollover, DST, `widgetURL`, Lora bundled |

**Phase 0 is a gate, not a warm-up.** If the cached-image path wins, phase 2
collapses to a single `ImageRenderer` pass and phase 4 gets simpler. If live
`Path` wins, phase 2 is the substantial rendering work and phase 4 inherits the
budget pressure. Do not start phase 2 before phase 0 has numbers.

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
