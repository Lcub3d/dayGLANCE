# Widget background refresh — options

*Status: plan only. Nothing here is built. This is a ship gate for the Day
Dial widget (handoff §9, phase 4b) and the follow-up to the stale-state fix
that landed with it.*

## The problem, precisely

Widget content on both platforms is written by exactly one thing: the
snapshot effect in `src/App.jsx` (around line 7414), which runs inside the
WebView. It re-runs on a 15-second clock tick and on every foreground, and its
dedupe fingerprint includes `date`, so an app that is open at midnight, or
opened at any time after, pushes the right day within seconds. The gap is an
app **backgrounded across midnight**: iOS suspends the WebView, Android's is
paused, and nothing else knows how to build a snapshot.

Everything native only *re-reads* the stored bytes:

- iOS: the three timeline providers reload every 15 minutes (`.after`) and
  the `BGAppRefreshTask` in `AppDelegate.swift` calls `reloadAllTimelines`.
  Same snapshot every time.
- Android: `WidgetUpdateWorker` runs every 15 minutes and, until the fix,
  restamped `date`/`dateLabel`/`updatedAt` onto the unchanged JS content.

The stale-state fix (`WidgetFreshness.swift`, `WidgetFreshness.kt`) makes this
**honest**: the widget compares the snapshot's day to the entry's day, dims,
shows "Outdated · as of Thu, Sep 17, 8:42 PM", suppresses in-progress
badges, countdowns, "Up Next" framing and push-time due badges, and offers no
action on stale ids. It does not make it **fresh**. For an Up Next line that
is acceptable. For the dial, whose whole face is a picture of the day, a
dimmed yesterday at 8 am is the first thing the user sees, and it has to be
solved before the dial ships.

### What "fresh" can and cannot mean without the app

Two different things go out of date overnight:

1. **The day.** Today's schedule is knowable in advance: timed tasks,
   expanded recurrences, routines, the day window, sunrise and moon. A
   correct projection of it can be made *before* midnight.
2. **The state.** Completions, edits, and anything arriving from another
   device (vault sync, Todoist, calendar feeds) between the last push and the
   morning. This is not knowable in advance and no background path short of
   running the app recovers it.

Every option below fixes (1). None fixes (2), and the honest label has to
survive in some form: a snapshot projected yesterday evening for today is
right about the shape of the day and silent about anything that changed since.

---

## iOS

### iOS-A · Day-keyed snapshots, picked by the timeline entry's date

The JS effect already builds today's snapshot. Have it also build the next
*N* days (tomorrow at minimum; 3–7 is cheap) from the same functions
(`getTasksForDate` for each day, `projectDialSnapshot`, `computeSkySnapshot`
with that day's date, routines for that weekday) and push them as one
payload keyed by date. Each provider's timeline then carries entries across
midnight; the view looks up the entry's local day in the payload and renders
that day. No background execution at all — this is what WidgetKit timelines
are for, and it is exactly how the stale flag already flips at 00:00
(`WidgetTimelineDates.withMidnightRollover`).

- **Fixes:** the day, on every widget, with no reliance on the system
  running anything.
- **Does not fix:** state. Overnight completions from other devices,
  overdue carry-forward that depends on what was *not* finished, and the
  next-task pointer once today's blocks pass are projections "if nothing
  changes". The label should soften rather than vanish: "planned as of Thu
  8:42 PM" on a projected day, no label on the pushed day.
- **Size:** the snapshot is ~13 KB today plus dial blocks; the iOS cap in
  `WidgetBridge.swift` is 200 KB. Seven days of everything fits; the
  `allGoals`/`allProjects` blocks do not vary by day and go in once.
- **Risks:** the dedupe fingerprint now changes whenever any of the *N* days
  changes, so pushes get a little more frequent; recurring-task expansion
  for future days has to match what the app shows when it gets there
  (`tasksByDate` already does this for the calendar views).
- **Effort:** JS 1 d (multi-day build, size guard, fixture), iOS 0.5 d (day
  lookup in three providers plus the dial), tests 0.5 d. **~2 d.**

### iOS-B · Native projection from a JS-written source

Have JS persist a compact *source* to the App Group when it pushes — tasks
for the coming week, routines, day windows, coordinates, settings — and port
the projection (agenda ordering, next task, `projectDialSnapshot`,
`computeSkySnapshot`) to Swift so the extension can build any day's snapshot
at render time. Phase 1 already ports the dial geometry, so the dial half is
partly paid for; the agenda half (`todayAgenda`'s ordering rules, overdue
classification, frames) is not.

- **Fixes:** the day, and lets the widget re-derive "next task" and
  past-dimming at each entry rather than from a projection.
- **Does not fix:** state; same caveat and label as A.
- **Risks:** two implementations of the agenda rules that must agree (the
  feasibility doc's vector-fixture approach would have to extend to agenda
  cases); a second copy of every data-safety rule about what counts as a
  task. The handoff's "adding a field to a task" section becomes five
  subsystems, not four.
- **Effort:** 5–8 d for iOS, 60% of it agenda rules and their fixtures.
  Reusable for Android only as a spec.

### iOS-C · `BGAppRefreshTask`, as it exists

Already wired: scheduled on background, earliest 15 minutes out, calls
`reloadAllTimelines` and refreshes the Live Activity. What it can and cannot do:

- **Budget:** opportunistic. iOS runs it based on usage patterns and battery,
  typically a handful of times a day for an app the user opens daily, and not
  at all in Low Power Mode, after a force-quit, or on a device asleep on a
  nightstand. There is no way to request "at midnight". Apple documents no
  guaranteed cadence and none should be assumed.
- **When declined:** nothing happens; the widgets keep their timelines. With
  option A that is fine, because the timeline already carries the rollover.
- **Content without the WebView:** no. The task cannot run JS; a WKWebView
  is not available to a background task. It can only reload what is stored.
- **Verdict:** keep it for what it does (Live Activity staleness), do not
  build on it for content. With A in place it has no widget role at all.

### iOS-D · `BGProcessingTask`, silent push, or a live process

Listed to close them off. `BGProcessingTask` needs idle-and-charging and is
for minutes-long work, not a daily rollover. Silent push needs a server;
dayGLANCE has none and that is a product decision, not an oversight. Keeping
the app process alive (audio, location) to run the effect at midnight is a
review rejection and a battery complaint. None is on the table.

### iOS · a midnight hook?

There is no background execution at a wall-clock time. `NSCalendarDayChanged`
fires only in a running process. The midnight *timeline entry* is the hook:
it is already in every provider for the stale flag, and under option A it
becomes the day switch. Nothing further is worth building.

---

## Android

### Android-A · Day-keyed snapshots (the same payload as iOS-A)

Identical JS change; the worker and the four providers pick the entry for
`LocalDate.now()` when they render. The 15-minute `WidgetUpdateWorker` and
the 30-minute `updatePeriodMillis` already re-render; either flips the day
within its period.

- **Fixes / does not fix:** as iOS-A.
- **Risks:** Doze batches periodic work into maintenance windows, so the
  first re-render after midnight on an untouched phone can be an hour or
  more late. The alarm in C closes that.
- **Effort:** Android 0.5 d on top of the shared JS work. **~1 d.**

### Android-B1 · The worker computes content from a JS-written source

The Kotlin twin of iOS-B: JS persists the source, the worker projects the
day. Same two-implementations risk, same agenda-rules cost, and no share of
the dial geometry port (that is Swift). **5–8 d**, and the projection
diverges from the web the first time someone changes an agenda rule without
touching both.

### Android-B2 · The worker runs the app headlessly

Android, unlike iOS, *can* instantiate a `WebView` from a Worker (on the
main looper, in the app process) and run the JS bundle to produce a snapshot.

- **Fixes:** the day AND the state, because it is the real app: sync engines
  run, Todoist and calendar feeds refresh, the effect runs unchanged.
- **Costs:** a cold WebView plus the app's boot is several seconds and
  100–300 MB; a 15-minute periodic run of that is a battery complaint and
  will be killed by OEM optimisers (Samsung, Xiaomi) that already interfere
  with the reminder alarms. As a once-a-day run at midnight it is more
  plausible but still the heaviest thing the app does in the background, and
  it must be expedited or foreground work to survive Doze, which means a
  visible notification on API 31+.
- **Risks:** the app's data layer running concurrently with a suspended
  foreground instance (IndexedDB locks, sync-engine cursors); the `Update
  skipped` dedupe seeing a different `lastWidgetSnapshotRef` per process.
- **Effort:** 3–5 d to a first version; the tail is device-specific.

### Android-C · A midnight alarm

`AlarmManager.setExactAndAllowWhileIdle` at the next local midnight, rearmed
by itself and by the existing `TimeChangeReceiver` on timezone or clock
change, whose receiver broadcasts a widget update (and, under A, the day
switch). The app already holds `SCHEDULE_EXACT_ALARM` for reminders
(`MainActivity.kt` requests it; `UpNextNotificationUpdater` uses the same
call), so no new permission posture. Inexact `setAndAllowWhileIdle` would do
without it at the cost of up to ~9 minutes of slop in Doze.

- **Fixes:** the *timing* of the flip, not the content. Alone it makes the
  stale state appear at 00:00 instead of some time in the next hour; with A
  it makes the day switch punctual.
- **Effort:** 0.5 d.

---

## How the options combine

| Combination | Day correct at 00:00 | State correct | New native logic | Effort |
|---|---|---|---|---|
| Stale state only (landed) | no — labelled | no — labelled | none | done |
| iOS-A + Android-A | yes, both | no — soft label | date lookup only | ~3 d total |
| A + Android-C | yes, punctual on Android | no | alarm receiver | ~3.5 d |
| iOS-B + Android-B1 | yes | no | full projection ×2 | 10–16 d |
| A + Android-B2 (midnight only) | yes | Android yes, iOS no | headless WebView | ~7 d, OEM tail |

Whatever is chosen, two things hold. The label logic that landed stays and
gets a second, softer tier for "projected, not observed". And the dial's
Phase 4 timeline (96 entries) should be built from a day-keyed payload from
the start, so that the entries after midnight draw tomorrow's face rather
than needing a separate mechanism — the same decision this document exists
to gate.

## Verifying any of it

The device recipe from the stale-state PR applies unchanged: write a
snapshot dated yesterday into the shared store, add the widgets, and look.
Under A the expected result changes from "dimmed yesterday" to "today's
projection with the softer label"; under C, watch the flip land at 00:00
rather than at the next worker run.
