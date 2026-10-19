# GLANCElauncher integration

How dayGLANCE hands its data to the GLANCElauncher and takes writes back. The
launcher's side of the design is `SPEC.md` ("Real data") in the launcher repo;
this is the app's half. lastGLANCE follows the same pattern.

dayGLANCE's data lives in the WebView's IndexedDB, which native code cannot
read. The native side has only what the web layer pushes, so the launcher
reads a **snapshot** the app builds, and its writes reach the app the way the
automation intents do: queued natively, drained by the web layer when it runs.

## Reads: the launcher snapshot and the provider

`src/utils/launcherSnapshot.js` builds the snapshot from plain inputs; the
effect in `App.jsx` beside the widget-snapshot effect gathers them, runs on the
same trigger (every data change while the app runs), and pushes through
`DayGlanceNative.updateLauncherSnapshot` only when the content changed. Shape:

```
{ version: 1, updatedAt, timezone, today,
  tasks:    [{ id, title, date, startTime, duration, isAllDay, completed, completedAt,
               colorHex, priority, notes, projectId, deadline, source: "dayglance"|"calendar",
               energy, clientId, recurringId }],   // scheduled, Inbox (date null), recurring occurrences
  goals:    [{ id, title, description, colorHex, targetDate, status }],
  projects: [{ id, title, goalId, colorHex, description, status }],
  routines: [{ id, name, startTime, duration, isAllDay, completed }],   // today's
  frames:   [{ id, frameId, date, start, end, name, colorHex }],       // per day, today-7 to today+34
  dayShape: { dayStartMin, dayStopMin, sunriseMin, sunsetMin, use24HourClock },
  handledWrites: [{ clientId, taskId, action, at }] }
```

`LauncherProvider` (`dayglance-android/.../launcher/`) serves it read-only at
`content://com.dayglance.app.launcher/<collection>` for `tasks`, `goals`,
`projects`, `routines`, `frames`, `dayShape` (one row) and `meta` (one row:
version, updatedAt, timezone, today, handledWrites). Each cursor has `_id`,
`id` and `json` columns, the row as JSON. Every push calls `notifyChange` on
the authority, so a `ContentObserver` registered on any collection URI sees
every change. `insert`, `update` and `delete` throw.

The snapshot is as fresh as the app's last JavaScript run. `meta.updatedAt` is
the stamp the launcher shows staleness from.

## Writes: the launcher receiver

`LauncherIntentReceiver` takes `com.dayglance.app.launcher.<ACTION>` broadcasts
with two String extras: `payload`, a JSON object, and `clientId`, an id the
launcher generates per write. The actions and their payloads:

| Action | Payload | Does |
| --- | --- | --- |
| `CREATE` | the automation CREATE shape: `title`, `due`, `duration`, `all_day`, `deadline`, `tags`, `priority`, `notes`, `project` | makes a task and stamps `clientId` on it |
| `COMPLETE` | `task_id` and optional `completed_at`, or `title` | completes the task; a recurring occurrence id (`recurring-<template>-<date>`) marks that date on the series |
| `UNCOMPLETE` | `task_id` | reopens it, Inbox and recurring occurrences included |
| `MOVE` | `task_id`, `date` (`YYYY-MM-DD`), optional `start` (`HH:MM`) | an Inbox task is scheduled (it needs `start`; priority and deadline are dropped, as the app's own schedule path does); a block moves to the date and, when given, the time; without `start` an all-day task stays all-day and a timed one keeps its time |
| `RESIZE` | `task_id`, `duration` (minutes, 5 or more) | changes the block's length |
| `TOGGLE_ROUTINE` | `routine_id`, optional `date` | flips today's completion of the routine; another date is refused, since completions are kept for today only |

MOVE, RESIZE, COMPLETE and UNCOMPLETE run through the MCP write model's pure
mutations (`utils/taskMutations.js`), so a calendar event, a device-calendar
event, a routine block, a CalDAV task and a MOVE or RESIZE of a recurring
occurrence are refused with the same words the MCP tools use, and a placement
over a routine is refused rather than slid. Each stamps `lastModified` at the
write. The receiver queues the
write in its own slot (several deep, unlike the automation transport's single
slot) and sends the same package-scoped wake broadcast, so a running app
drains at once and a dead app on next launch.

The web layer (`src/intents/launcherWrites.js`) dedupes on `clientId` with a
ledger kept in localStorage: a re-sent write is acknowledged, never applied
twice. A write that fails for good (an unknown id, a read-only block, a routine
in the way) is recorded too, with its error, so the launcher sees the id in
the next snapshot and lets its optimistic change go at once rather than when
its outbox entry expires; a failed CREATE is the exception, since the launcher
may correct the payload and re-send. `CREATE`
stamps `clientId` on the task it made (the field is declared to the sync seams
like `originalPlan`: stripped from the re-stamp comparison, carried across
both merge tiers and the apply); `COMPLETE` with `task_id` completes that task
by id and is idempotent. The ledger rides the snapshot as `handledWrites`, so
the launcher retires an outbox entry when the snapshot shows its id, on the
created task or in the ledger.

The client id travels beside the payload rather than inside it because the
intents package's payload schemas are strict and shared with Tasker. The
receiver does not consult the "Automation intents" toggle, which keeps gating
the public transport exactly as before. No RESULT broadcast is sent for
launcher writes; the launcher reads the outcome from the next snapshot.

## Permission

Both the provider and the receiver sit behind `com.dayglance.permission.LAUNCHER`,
`protectionLevel="signature|knownSigner"`, with `knownCerts` naming the
**launcher's** signing certificates (`res/values/launcher_certs.xml`): its
release certificate, its debug certificate (removed before any public release)
and its Play app signing certificate once it ships there. dayGLANCE's own
signature satisfies the `signature` half, so the app can always reach its own
provider. `knownSigner` exists from Android 12; on older devices the permission
is signature-only and the launcher stays in demo mode. The launcher declares
`<uses-permission android:name="com.dayglance.permission.LAUNCHER" />`.

The digests in `launcher_certs.xml` are placeholders until read from the
launcher's keystores (`keytool -list -v`, SHA-256, lowercase, no colons).

## Verifying on a device

With the launcher's real digests in `launcher_certs.xml` and both apps installed:

1. Open dayGLANCE once so the web layer pushes. Then from a shell:
   `adb shell content query --uri content://com.dayglance.app.launcher/meta`
   prints the meta row (adb's shell holds every permission). `.../tasks`
   lists today's rows; change a task in the app and query again.
2. A write: `adb shell am broadcast -a com.dayglance.app.launcher.COMPLETE
   -n com.dayglance.app/.launcher.LauncherIntentReceiver --es clientId test-1
   --es payload '{"task_id":"<an id from step 1>"}'`. With the app in the
   foreground the task completes at once; with it dead, on next launch. Send
   it again with the same `clientId`: nothing changes, and `meta` lists the
   id under `handledWrites`.
3. A create: the same with `.CREATE` and `--es payload '{"title":"From the
   launcher"}'`; the new task's row carries `"clientId":"test-2"`.
   Then the gestures: `.MOVE` with `'{"task_id":"<id>","date":"<tomorrow>","start":"09:00"}'`
   moves the block (query `tasks` again); `.RESIZE` with
   `'{"task_id":"<id>","duration":60}'`; `.UNCOMPLETE` with `'{"task_id":"<id>"}'`
   reopens the task completed in step 2; `.TOGGLE_ROUTINE` with
   `'{"routine_id":"<an id from routines>"}'` flips today's pill. A MOVE of a
   `recurring-…` id is refused, and `meta.handledWrites` lists that id with its
   `error`.
4. Permission: from any app without the permission the query is refused
   with a `SecurityException` and the broadcast is not delivered.

Unit tests: `vitest run src/utils/launcherSnapshot.test.js
src/intents/launcherWrites.test.js` and, on the Android side,
`./gradlew :app:testDebugUnitTest --tests '*LauncherSnapshotRowsTest*'`.
