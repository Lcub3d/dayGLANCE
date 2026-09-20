# Local validation: jobo-pre

Checked on 2026-09-20 on Windows, Node 24.15.0 / npm 11.12.1. The complete suite,
lint and builds ran after the final port changes, on upstream
`9f37d48722516cd7ca556ca3cc754fb5216718b4`. Before delivery both main and jobo-pre
were fast-forwarded to `441495a16015295d47d792b7c02f62e0eae7aaea` (#1741), whose
only change is one MCP error-message string in `electron/mcpWriteTools.ts`.
The focused Jobo/locale/view/store and MCP write-gate tests were rerun on that base.
This is a local experimental port,
not an upstream submission or a production ledger/sync implementation.

## Automated checks

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed, zero warnings |
| `npm run build` | Passed; web/PWA output generated |
| `node node_modules/vite/bin/vite.js build --config vite.config.android.js` | Passed; Android web assets generated, no APK/hardware test |
| Focused Jobo, store, locale and view tests (7 files) | 242 passed |
| Final focused rerun including MCP write gate on latest main (8 files) | 249 passed |
| `npm test` (complete suite) | 4900 passed, 45 failed; 312 passing and 5 failing files |
| Same five failing files on unchanged upstream main | 43 passed, 45 failed; all 45 failure headings match the experiment |

The Android-web command invokes the same Vite config directly because the
inherited npm script uses a POSIX-style executable path on Windows. Builds still
report the inherited large-chunk warning. No dependencies or test exclusions
were changed to obtain these results.

The complete suite is **not green**. The reproduced upstream failures are:

- `electron/appProtocol.test.ts`: 7 failures, POSIX path fixtures on Windows.
- `electron/mcpDesktopConfig.test.ts`: 2 failures, macOS path expectations on Windows.
- `src/utils/solar.test.js`: 4 failures, UTC assumptions with the local UTC+08 timezone.
- `dayglance-obsidian-plugin/test/projectNotes.scenarios.test.ts`: 10 timeouts.
- `dayglance-obsidian-plugin/test/scope.scenarios.test.ts`: 21 timeouts and one
  pending-observations assertion failure.

The Jobo tests cover missing Original Plan, older Original Plans without duration,
immutable per-Do Final Plan snapshots, legacy records without Final snapshots,
record progress/order/linkage, durable-write failures, stale storage, undo,
roundtrip validation, and lazy feature/data-hydration guards.

## Browser checks

Used a separate `http://localhost:5185/` origin with synthetic data, a temporary
1700 x 1050 desktop viewport, and no real provider account. The user preview at
`http://127.0.0.1:5185/` was not seeded with test tasks.

Verified through the rendered application:

- Main's Experimental JOBO toggle and shortcut 6 open the original Plan / Do /
  Notes layout. Disabling it removes JOBO and shortcut 6; reenabling retains data.
- A task created through main's native editor appears directly in JOBO Plan.
- Shortcuts 2 and 3 show the same task in unchanged native DAY and WEEK renderers.
- The prototype checkbox creates a Do; editing progress to Partial and checking
  again appends a second execution. Native task completion stays unchanged.
- A task note entered in JOBO is visible in the native DAY note panel. Task and
  daily notes remain after reload.
- Changing the plan duration from 30 to 60 minutes uses main's task editor. Its
  native history popover displays original 30 minutes and current 60 minutes;
  existing Do intervals retain their original times.
- Dragging the ordinary Plan's bottom resize handle changes its duration from
  60 to 90 minutes and updates the shared native task.
- Deleting one Do and undoing restores the second record; both survive reload.
- The Do editor's color buttons use main's color objects correctly; choosing
  Purple stores and renders `bg-purple-500`.
- A standalone unplanned execution can be created and renders the Unplanned badge.
- The final desktop layout was visually inspected. No new console errors occurred
  after correcting the color-object duplicate-key warning.

The built-in demo confirmation blocked one in-app test tab and the browser tool
could not resolve that dialog. The functional checks above were completed in a
fresh test tab using ordinary native task creation. Demo/import/export dialogs,
imported/recurring-task gestures, real provider sync, physical mobile devices and
production restore/reset integration were not browser-validated in this run.
A browser-tool Plan-to-Do drag attempt made no change, so that gesture is not
claimed validated; check-to-record and repeated execution were verified above.
Imported/recurring plans keep main's editor/resize handling and are excluded from
the prototype's drag path, which cannot update recurring-instance exceptions.

## Evidence and boundaries

Local command logs are kept outside source control in
`D:\PycharmProjects\.dayglance-backups\jobo-pre-20260920-112817\`:
`pre-full-tests.log`, `baseline-failures-current.log`, `pre-lint.log`,
`pre-web-build.log`, `pre-android-web-build.log`, and `latest-main-focused-tests.log`.

Main's App, SettingsModal, DesktopLayout, native DAY/WEEK and task card,
CalendarHeader, view constants, Original Plan/plan-trail utilities, sync code and
LICENSE were checked unchanged against the upstream base. The independent
`codex/jobo-core` draft is not part of this branch. No push, PR or public comment
was made.
