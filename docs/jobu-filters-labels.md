# Jobu filters and visible labels

Personal-product change based on `product/jobu` (`51513fbb`), not an upstream
slice proposal. No dependency upgrades or native task-storage migration.

## Entry points

- Desktop/tablet: **Filters** beside **Browse / Inbox**, in the existing sidebar.
  Clicking a saved view opens its full task list. Sidebar counts, the editor's
  preview and result sections use the same compiler and task population.
- Phone: an optional Jobu **Filters** button beside Inbox in the bottom bar.
- **Labels** sits immediately above the Goals/Projects buttons, with additional
  links from Filters and its task results. Labels also appear on native timeline
  cards and Inbox cards. Click a chip to open its exact-label filter.
- Create an unused colored/favorite label, rename it, assign/remove it in a task's
  label picker, or delete it. Deleted labels can be restored from the catalog.
- Copy a template, name it and save, or create a filter with the plus button.
  The condition builder adds AND, OR, NOT, or another result section. The query
  remains editable. Saved views can be edited, favorited and deleted.

## Requested templates

The 15 names/queries were read from the owner's authorized Todoist account on
2026-09-28. They are templates, not a live account connection. No account IDs,
project IDs, credentials, task content or personal label inventory are embedded.
Copying creates an independent editable Jobu record; editing does not write to
Todoist. A sixteenth template approximates the Today task selection as separate
`overdue, today` lists, not Todoist's full built-in Today interface.

| Name | Query |
| --- | --- |
| Todoist 今日 | `overdue, today` |
| 首页 | `overdue \| today,@进行, #收件箱` |
| 无标签 | `no label` |
| 今日任务 | `今天&P1` |
| 今日目标 | `今天&!p4` |
| 正在进行 | `@进行` |
| 无日期 | `no date` |
| 马上要做 | `due before: +3 hours` |
| 可能清单 | `no date&p4` |
| 等待清单 | `p3` |
| 执行清单 | `no date&(p1\|p2)` |
| 优先度p1 | `p1` |
| 优先度p2 | `p2` |
| 优先度p4 | `p4` |
| 过期 | `overdue` |
| 今天待排 | `today & no time` |

**今日目标 is a task filter, not a filter of Life Map goal entities.**
**正在进行 means the task has the 进行 label; it is not inferred from JOBO
progress, focus-session history or whether the task has started.**

## Query semantics

Primary reference: [Todoist's filter documentation](https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH)
(read 2026-09-28; page updated 2026-09-04).

Supported here: `&`, `|`, `!`, parentheses, comma-separated result sections;
`today/今天/今日`, tomorrow, yesterday, 后天, overdue, `no date`, `no time`,
`no label/labels`, `no deadline`; p1–p4, `no priority`, recurring, subtask;
`@label` and `%label`, `#project`, `##project` descendants, Inbox/收件箱;
`search: words`; `date/due/deadline:` with before/after, ISO dates, English
weekdays, relative days/hours/minutes, and explicit day-plus-clock expressions.
`7 days` means today through six days after today. Names can be quoted or
escaped; `*` is a wildcard and `\*` a literal star. Generated chip queries quote
and escape names instead of injecting label text as query operators.

A comma produces separate lists, **not OR**. A task can appear in two lists, but
sidebar/editor totals count it once. Completed tasks are excluded by default,
even from `p1`, a label, negation or `all`; explicit `completed` is retained as a
Jobu extension per section. Invalid/unsupported queries fail closed as an error
and no results, including when the unsupported expression is negated.

The filter clock is the device's current civil time, updated each minute; it is
not the selected calendar day, visible hours, zoom or other calendar filters.
`overdue` is before the current civil day. `due before: +3 hours` includes overdue
items and timed items before the moving threshold; a same-day date-only item is
not invented as a midnight appointment. `no time` requires an actual date or
deadline with no time, not an undated task. `no date` tests absence of the task's
scheduled/source date; `no deadline` is separate. `due` prefers the date, falling
back to an existing deadline only if that date is absent, not malformed.

For an imported Todoist task, the already-persisted `todoist.due` is the filter
date, not its independently scheduled local block. Native tasks use existing
`date`/`startTime`/`isAllDay`. Existing `deadline` is reused. Zoned timestamps are
converted to local civil dates; floating source times with an IANA zone are
resolved explicitly. Invalid and ambiguous/nonexistent zoned source clocks are
not guessed. No stored dates or completion stamps are rewritten for filtering.

## Scope and deliberate limits

Results use current-user-visible native and already-imported Todoist tasks,
excluding examples, deleted/archived tasks, archived projects and read-only
calendar events. This does not fetch tasks outside the configured Todoist import.
A missing remote task is not treated as deleted. The full private Todoist label
catalog is not imported: source labels are discovered from tasks already present.

Each native recurring series contributes **one next active occurrence** from the
native recurrence engine. This does not fabricate historic overdue occurrences
from a repeat rule. Checklist children keep their own facts and inherit project
membership, not the parent's label, priority or date. Native handlers still own
completion and title changes; no new task or checklist database is introduced.

This is not full Todoist query-language parity. Assignment/team/workspace/section
operators and arbitrary natural-language date phrases not implemented above
produce a specific unsupported error. Source section/parent/team facts are not
fabricated from names. No backend schema overhaul was warranted for the owner's
15 actual queries. `completed` remains a local extension, not a claim about
Todoist's service. Relative-hour queries have the native clock's minute cadence.

## Labels and data integrity

Previously, label lookup read only hashtags in a title even though imported tasks
already retained `todoist.labels`. The unified projection now reads both, plus a
small local membership overlay. Native hashtags stay native (`#work/deep`),
while the filter UI accepts Todoist-style `%` and legacy `@`. Ordinary email
addresses and `[[note#heading]]` links are not made into labels.

One new immutable `jobuRecords` kind, `label`, is needed for independent/unused
labels, names, colors, favorites and rename aliases. Per-task label additions and
removals reuse the existing `taskMeta` kind. **No new database, native task field,
transport, task timestamp rewrite or second retry queue.** Source/native rows are
unchanged; removing a source label creates an explicit local removal, and source
refresh cannot silently re-add it. Native recurring assignments address the
series, which is stated in the picker.

Renaming retains aliases for membership but filter strings are not automatically
rewritten. Update name-based queries after renaming; this limitation is explained
in the editor. Deletion is a tombstone masking membership, not destructive
rewriting of source task text. Restoration reserves previous names and rejects
collisions. Concurrent imported alias collisions are surfaced, not silently
collapsed. All revision rows remain in history/export.

The existing atomic personal transaction checks expected catalog and membership
heads, including newly claimed aliases. Failed writes do not publish success or
optimistically check a membership box. Editors retain drafts and report errors.
Unrelated edits coexist; edits of one membership entity still use the existing
whole-value revision model (not a per-label OR-set). Competing offline revisions
remain recoverable in History. Navigation/modal guards and focus restoration
protect unsaved forms and keyboard interactions.

Filters still use the existing `filter` kind. Personal export/import, full-app
backup/reset and both sync transports already include `jobuRecords`; regression
coverage walks save → state → file/vault apply → reload → backup/restore,
including membership removals and label tombstones.

Before deploying, export whole-app and personal backups and update **all personal
Jobu sync clients together**. Older builds reject the unknown `label` kind rather
than silently erase it. Do not share an experimental Jobu vault with stock
clients. Catalog rename/assignment never writes back to Todoist.

## Verification

Run:

```sh
TZ=UTC npm test
npm run lint
npm run build
TZ=Asia/Shanghai npx vitest run src/jobu src/components/jobu src/todoist src/locales.test.js
TZ=America/New_York npx vitest run src/jobu src/components/jobu src/todoist src/locales.test.js
```

Compiler tests exercise every requested query plus precedence, unsupported
negation, quoted Unicode/operator/literal-star names, time-window boundaries,
source dates versus local blocks, deadlines, timezone conversion and population
selection. Storage tests include real IndexedDB transactions, stale heads,
quota rejection/retry, duplicate names and both real transport adapters.

Browser acceptance uses isolated synthetic data, no personal credentials or
production vault. It covers entry placement, actual counts, template copies,
condition building, label rename/assignment/delete/restore, concurrent controller
edits, quota failure, reload, dirty dialogs, focus and light/dark/narrow layouts.
Physical multi-device transport sessions and Android/iOS hardware are not tested.
English and Chinese copy is authored; other shipped locales currently use English
fallback strings for this feature with locale-key parity.
