# jobo-pre: the existing prototype inside main's JOBO view

This local experimental branch starts from dayGLANCE `main` at
`441495a16015295d47d792b7c02f62e0eae7aaea`. It ports the existing Jobo interaction
prototype from `Lcub3d/Jobo:main` (`3c847dd8a332eb19c9c37ecb5273af4eda94ef0b`,
derived from #1673/#1675) into the independent sixth view established by #1725
and tracked by [#1726](https://github.com/krelltunez/dayGLANCE/issues/1726).

It is the owner's working development branch, not the pure-core submission and
not a replacement demo application. The separate `codex/jobo-core` draft remains
independent. Nothing in this experiment constitutes an upstream design agreement.

## What comes from main

- The single `joboEnabled` setting in Experimental, its default-off state and
  per-device storage, hidden-view behavior, JOBO registration and shortcut **6**.
- Native DAY, WEEK, MULTI, MONTH and mobile views keep main's renderers and
  completion behavior. There are no prototype route replacements in those views.
- The JOBO screen consumes main's native task/inbox state and daily notes. It
  does not create a parallel task database. Native task notes remain canonical.
- Main continues to own `originalPlan`, `planTrail`, deferral counts and their
  persistence/sync paths. Opening JOBO must not invent an Original Plan for a
  task whose original schedule is unknown.

`src/components/JoboView.jsx` is the only changed main application component.
It lazily mounts the existing Plan / Do / Notes prototype in that slot and keeps
the prototype unavailable in multi-user/tray mode. App.jsx, SettingsModal,
DesktopLayout, CalendarHeader, view constants and the native card are unchanged.

## What remains experimental

The existing prototype's Do ledger still uses `day-planner-jobo-v520` in
localStorage, with its dedicated JSON export/import and failed-write safeguards.
This is **not** the completed IndexedDB/sync/backup/reset slice described in #1726.
Standard native backup and cloud sync do not automatically include the ledger.
Its stale-write check is not atomic cross-tab locking. Never discard ledger
history to fit a quota.

New Do records retain the current timed plan as their Final Plan snapshot.
Subsequent edits to the native task or to the actual interval do not rewrite it.
Existing records keep their history; missing historical snapshots remain unknown.
The native `originalPlan` is the distinct Original Plan source.

The prototype's record-only completion controls are retained inside JOBO for
continued interaction testing. They are not a decision that Completed Do and
native completion must remain separate forever. Slice 4's coupling, reopening
and provider effects remain unresolved. Do controls do not send Todoist completion
commands. Imported native cards retain main's existing provider actions; Obsidian's
transport is unchanged.

The prototype's original stylesheet, time editing, repeat attempts, progress,
notes, undo and dedicated export are reused. Prototype UI strings are merged into
the normal locale bundles without replacing main's existing keys; the editor's
title field is `jobo.recordTitle` because `jobo.title` already names the view in
main. Existing untranslated prototype fallbacks are not claimed fully translated.
Mobile prototype integration and replacing other views are outside this port.

## Local use

```powershell
cd D:\PycharmProjects\DayGlanceJobo-pre
npm run dev -- --host 127.0.0.1 --port 5185 --strictPort
```

The local launcher `jobo-pre-start.bat` is kept outside the tracked contribution.
Use http://127.0.0.1:5185/ for this branch; 5184 remains the clean upstream baseline.
At the desktop width required by main (at least 1600 CSS pixels), enable JOBO in
Settings → Experimental and use **6** or the view cycler. **2** and **3** open
the unchanged native DAY and WEEK views.

Use a separate browser origin/profile with synthetic data for the experiment.
Native tasks and integrations follow main's ordinary storage/sync rules; an
experimental screen is not a reason to connect a real account for testing.
The retained demo action adds marked sample data only after confirmation.

## Verification

Actual command and browser results are recorded in [jobo-pre-validation.md](jobo-pre-validation.md).
Android-web builds do not produce an APK, and browser
dimensions are not physical-device testing. No remote push or PR is part of this
local adaptation.
