# Life Planner — purpose, vision and principles prototype

Branch: `Lcub3d/dayGLANCE:lifeplanner`. Baseline: **main `5565d32bd69550999a7bb18400e24ed38a1f64b7` (5.2.1)**. This is a new source branch, not the earlier Jobo prototype branch.

## Scope and design

One nearly full-screen workspace. The left side holds **100 life wishes** and the right side holds editable **life principles**. The entry sits immediately below Goals & Projects in the existing desktop/tablet GLANCE pill stack and reuses exactly the same pill classes. On phones it is below the existing Goals & Projects header. The small `life planner` guide toggle uses `bg-brand`, the same `#fe8b00` token as the GLANCE wordmark.

Default rows are intentionally quiet: ordinal/favorite, independently checkable purpose and vision, a small category label, and the detail toggle. Favoriting replaces the number with a star without moving the row. The list starts empty, not with 100 fake tasks. A reference example is inserted only after an explicit action. The five editable starting principles come from the supplied workbook.

The guide reveals category explanations, inspiration topics and current/target metadata. It does not reveal the workbook's theory crosswalk, theory rankings or an invented importance score. These belong to product-design reference data, not everyday task UI. Category order and inspiration content follow the workbook; `catalog.js` preserves its crosswalk as reference-only metadata. This is the requested product mapping of wish → purpose and measurable vision → outcome, not a claim that all bucket-list items are literally GTD purposes.

## Workbook coverage

| Workbook sheet | Implementation |
| --- | --- |
| 总表 | Purpose/wish, principle and vision in one workspace; existing native goals/projects remain the execution layer. No speculative year/month/day redesign. |
| 人生清单-100个人生愿望 | 100-item bound; 11 life categories; separate completion, star instead of ordinal; optional explanatory/reference material; reorder, edit and delete. Multiple visions per wish are supported. |
| 愿景清单点击弹出自界面 | Bold outcome row with one Arabic number or percentage; first horizon defaults to five years and accepts a 3–5-year equivalent; year/month/day units; current-value row defaults to zero; inherited measurement wording; successive stages and native project hand-off; add/reorder/remove stages and total time. |
| 人生清单-motto | Five editable starting principles, add/edit/delete/reorder. |

### Resolved ambiguities

* A phrase such as `出版2本书，3年内` is split into the result and its time window before counting numerals. Multiple independent quantities are not silently reduced to the first number. An unrecognized measure is displayed as such; the editing model's provisional target is 100, but no fake numeric outcome is saved.
* “Five-year vision” is the screen label, with the workbook's **3–5-year** validation underneath. Shorter illustrative workbook ideas are phrased within that outer horizon; shorter work can be represented as stages. This is why the health example has a three-year outer horizon rather than weakening the first-row rule to two years.
* Stage durations are **successive**, not repeated offsets from today. Their total may be shorter than, but must not exceed, the outer horizon. Stage values are individual/cumulative result checkpoints, not quantities summed into a budget. Decreasing numeric goals are valid.
* Planning conversion uses 12 months / 365 days per year. Calendar dates use calendar arithmetic with month-end/leap-day clamping. It is not a prediction or measured effort estimate.
* No wish/vision checkbox changes another checkbox or completes a native goal, project, task or Todoist item. A purpose may be ongoing rather than a finishable task.
* A deleted wish, vision or stage never deletes its native projects. Wish/vision/principle deletion has a local one-step undo; form edits can be cancelled without overwriting persisted data.

## Native reuse and data ownership

The feature uses the existing theme/context, `lucide-react` icons, locale bundles, `ProjectForm`, `FormOverlay`, native goal picker/colors, `addProject` and native Project Planner. No runtime dependency is added. It does not install a second project or task database.

Creating a stage project is explicit. Opening the native form first saves the vision. Its proposed title inherits the stage's wording and value. The project carries contextual description and a reference target date, not auto-scheduled tasks. A reserved stable id is written to the life-planning document before native project creation. The optional id argument to `addProject` deduplicates retries while preserving ordinary native random-id creation. An existing linked project opens the native Project Planner. A missing native project is shown as missing and can be re-created intentionally. Later vision edits never silently rewrite a project already handed off.

`ProjectForm` has only a new optional `prefill.title`; that does not mark a new project as an existing edit, so its original create/edit behavior, goal selection and optional note creation remain intact. External-provider and Obsidian round trips are not simulated as successful integrations by this prototype.

## Persistence and safety boundary

Life-planning-only content is a bounded, versioned device-local document at `day-planner-lifeplanner-v1`. It is **not yet a synchronized Life Planner collection**. Real native projects continue through the existing project persistence/sync/backup paths. It does not send the life-planning document to Todoist, Obsidian, an AI service, or another application.

* Writes serialize per store; Web Locks serialize participating tabs when supported. Missing/invalid/future-version data fails closed instead of becoming an empty writable document.
* A failed durable write does not publish success or discard the open draft. Original/native data are not overwritten by an invalid import. Forms compare the opened entity to its latest version to reject stale edits, while keeping unrelated edits.
* Dedicated JSON export/import includes wishes, visions, principles and links, **not native project copies**. Import requires explicit confirmation and revision checking. Linked projects absent in the destination are not silently invented.
* The existing `collectDeviceSettings` / `applyDeviceSettings` local-folder-backup helpers carry this prefixed key; that compatibility is unit tested. This is not a claim that every existing whole-app reset/restore route has been end-to-end audited.
* Multi-user editing is disabled in this personal prototype. Full profile ownership, encrypted vault/file-tier sync, cross-device conflict reconciliation and transactional persistence spanning native and planner collections remain integration work.
* Without Web Locks, optimistic revision/entity checks protect typical stale forms, but are not a promise of atomic cross-process writes. Storage is capped to avoid unbounded growth.

## Review order and validation

1. `src/lifeplanner/model.js` and `store.js`: schema, measurement, horizon/stage and storage invariants.
2. `src/components/lifeplanner/`: single workspace, vision dialog, native project hand-off, focus handling.
3. Small integration changes in App, GlanceFabs, mobile header, ProjectForm, useGoalsProjects and keyboard guards.
4. `src/lifeplanner/*.test.*` and `scripts/lifeplanner-review.py`.

Run `npm run lint`, `npm test`, `npm run build`, `npm run build:android`; then start the built application with `npm run preview -- --host 127.0.0.1 --port 5173` and run `python scripts/lifeplanner-review.py`. Install Python Playwright/Chromium and a CJK font to capture Chinese screenshots. The browser suite exercises the built real application with synthetic fixtures, not a replacement demo page. Review artifacts identify exact source commit, test output and screenshots.

English and Simplified Chinese copy are provided. The other six existing locale bundles contain explicit English fallback for the new namespace and retain key/placeholder parity; they are not claimed as professional translations. Screenshots from browser viewport emulation are not physical phone or Windows/macOS application-launch verification.

Prepared with ChatGPT assistance. This is for prototype and interaction review, not an assertion of production sync/migration readiness.

## Optional usage choices (Life Planner follow-up)

The brand-colored question-mark button after desktop weather opens **How do I
want to use dayGLANCE?** / **我想怎样使用 dayGLANCE？**. The first person is the
person choosing a workflow, not an assistant. This deliberately keeps the
existing dayGLANCE name; it does not rename the app or replace lifeGLANCE.

* **My day, at a glance.** is always on, with a disabled, checked switch and an
  explicit Always on label. It is the daily planner underneath both additions.
* **Reflect on my day.** uses the existing `joboEnabled` state and
  `day-planner-jobo-enabled` key, shared with native Settings. This branch keeps
  upstream's staged Jobo preview; it does NOT import the old Jobo ledger or
  claim that the review system is complete. The chooser says so when enabled.
  Current narrow/mobile builds cannot display that desktop preview; the chooser
  explains this and does not pretend to navigate to a nonexistent mobile view.
* **Plan my life.** reveals the Life Planner entry and offers a direct Open
  action, even when the separate Goals & Projects feature is off. The two
  optional switches are independent. Neither completes nor deletes records.

New devices start with both additions off. An existing native Jobo choice is
preserved. A pre-existing Life Planner document keeps its entry available on
upgrade unless the new `day-planner-lifeplanner-enabled` key explicitly says
false. Preference changes persist before React publishes success; errors keep
the switch unchanged and allow retry. Participating tabs refresh on storage
changes. Preferences remain local and follow existing device-settings backup
behavior; no task/project/sync schema fields are introduced. An already-open
Life Planner editor is not forcibly unmounted by an OFF change in another tab,
so its unsaved draft is not lost; subsequent entries are hidden.

The chooser reuses the native theme tokens, icon set, locale bundles and the
Life Planner focus hook, provides switch semantics, respects reduced motion,
traps focus, makes the background inert and restores trigger focus. The existing
Help & Feedback button is unchanged. Desktop, phone and tablet entries open the
same component, not separate preference stores. Other than the English and
Simplified Chinese copy, the six other bundles use explicit English fallback.

Review with `npm test -- src/lifeplanner/preferences.test.js
src/lifeplanner/planningChoices.test.jsx` and `python
scripts/planning-choices-review.py` against the production build. Existing
Life Planner browser fixtures now explicitly enable the opt-in feature. The
prototype discussion remains #1686; this change does not close it or decide the
final dayGLANCE/lifeGLANCE data-ownership boundary.


## Compact guide follow-up (fork PR #4)

The chooser is now a 420px warm-yellow guide: one first-person title, three
native icons/names/switches, and **Don't show again today**. The eyebrow,
introductory/descriptive paragraphs, visible lock label, link subrows, Done
button, row dividers and close X are removed. The baseline remains checked and
disabled with a screen-reader-only always-on explanation. The Life Planner icon
is Compass, matching GlanceFabs. Clicking the backdrop or Escape dismisses just
this opening. Enabled row names still open the existing feature, so removing the
secondary links does not strand mobile users with Goals disabled.

Automatic guidance is device-local. "Day" means a distinct local date on which
the app is opened, not elapsed days since installation. On visits 1/2/4/7/15,
on the 1st/2nd/4th/7th/15th **opened Monday** and separately **opened Sunday**,
and on each calendar month's first day, the guide opens after the native startup decision and a quiet interval,
provided the current launch did not show native welcome/onboarding. Active
editors take priority. Overlapping rules yield only one opening. Dismissing
by backdrop/Escape does not snooze future reloads that day. The explicit daily
snooze survives reload; the yellow button remains available for manual access.
The controller runs once per app mount, not once per responsive header or every
minute. It does not run a background task while the application is closed.

Counters saturate at 16 and retain only the latest visit date, not an unbounded
usage history. Clock rollback does not recount earlier dates. Invalid/future
cadence data and blocked writes fail closed (no auto-prompt loop). Failed snooze
writes leave the dialog open with a retryable error. No native task/project,
Life Planner document or Jobo record is changed by this cadence. It is not
cross-device synchronization or an atomic multi-process transaction guarantee.

Reproduce with `python scripts/planning-guide-review.py` against the production
preview. It runs the existing choices tests plus new cadence/compactness checks.
`python scripts/lifeplanner-review.py` still checks the original workspace.


## Integration fixes after fork PR #4

The native startup decision is now a reactive barrier, rather than reading an
initially-false `showWelcome` from a child effect. A launch that shows native
welcome or inline onboarding counts as an opened date but skips automatic
guidance for that entire launch: dismissing the native tour must not reveal a
second tour. Manual access remains available after the native welcome closes.
Other qualifying launches wait for 1.2 seconds of eligible idle time. The guide
yields to native settings, task/event/note editing, focus mode, dialogs, menus,
dragging and backup/restore surfaces; it never auto-opens in a hidden tab or
while a text field has focus. Manual opening consumes any pending automatic
opening for that mount. A pending automatic prompt rechecks today's snooze and
local date at display time; it never replays tomorrow's stale queue. The
requested visit/Monday/Sunday/monthly cadence and explicit daily snooze remain
unchanged. This is not a global modal-manager refactor or cross-device sync.

The desktop header now reserves actual layout columns instead of absolutely
positioning dates over the weather controls. Current weather and the yellow
question mark form one non-shrinking group; the question mark is immediately to
the weather card's right. Forecasts yield first as space runs out. Date text can
shrink in narrow desktop windows while its previous/next buttons remain
clickable. Actual touch-tablet headers also receive the entry; the phone timeline
entry shares the existing date row rather than adding an otherwise empty row.

Keyboard navigation wraps correctly from the initially focused heading, in both
directions, and returns focus to the trigger after dismissal. The compact copy,
warm colors, switches, outside/Escape dismissal and no-close-X design are kept.

Run `python scripts/planning-guide-integration-review.py` on the production build
for fresh-profile welcome precedence, true touch-tablet detection, header hit
testing at narrow widths, manual/pending prompt interaction and focus checks.
These are Chromium viewport/touch emulations with synthetic fixtures, not signed
native installers or physical-device launch tests.
