# dayGLANCE MCP Tool Reference

The complete tool and resource surface of the dayGLANCE MCP server, as registered by
`electron/mcpServer.ts` (per-request factory), `mcpReadTools.ts`, `mcpWriteTools.ts`, and
`mcpResources.ts`. This is the practical companion to the design spec (`mcp-server-spec.md` §5):
the spec explains *why*; this lists *what* — every tool, every parameter, every typed error.

Transport: Streamable HTTP at `http://127.0.0.1:7893/mcp` (port configurable in Settings →
Local Integrations), bearer-token auth. Claude Desktop connects through
[`@glance-apps/mcp-bridge`](https://github.com/glance-apps/mcp-bridge); Claude Code connects
directly (`claude mcp add --transport http`).

## Conventions

- **Dates and times are local** (§5.3): calendar dates are strict `YYYY-MM-DD`, times are
  wall-clock `HH:MM` in the machine's timezone. No UTC, no offsets, no timestamps. Responses
  echo the resolved date and IANA timezone. Times inside a DST gap (or the repeated hour) are
  rejected with a `validation` error naming the reason.
- **Errors are typed** (§5.2): every failure returns `{ error: { code, message } }` with
  `isError: true`. By-design rejections say so in the message — the model should report the
  design to the user, not retry another way.
- **`idempotency_key`** (all write tools, optional): 1–128 chars of `[A-Za-z0-9_.:-]`.
  Replaying the same key returns the first attempt's stored result (`replayed: true`) without
  repeating the write or journaling anything.
- **`device_calendar_event` items are read-only** everywhere: dayGLANCE holds EventKit read
  access only. Every write tool rejects them with `device_calendar_readonly`.
- **`routine` items are read-only** everywhere, and they **occupy the time they cover**. Treat a
  routine block as busy when looking for a free slot. Every write tool rejects them with
  `routine_readonly`: routines are managed in the dayGLANCE routines dashboard, whose write shape
  is not a task mutation. Routines exist only for the current day, so past and future dates never
  carry them. Writing to time a routine covers is refused with `routine_conflict`, and dayGLANCE
  will NOT shift your task to the next free slot, so read the day first when choosing a time.
- **Consent gating**: the read surface exists only while the MCP server is enabled; device
  calendar events appear in reads only under the calendar tier; write tools return
  `read_only_mode` unless writes are enabled — all in Settings → Local Integrations.
- **Undo**: every successful write lands in the session write journal, reversible per entity
  (task, goal or project) or in bulk from the bolt button in the app (and the macOS tray). Undone
  task creates go to the recycle bin; an undone goal or project create is removed with the same
  sync tombstone the app's own delete writes.
- **No deletes, no archiving** (owner, 2026-10-04): the surface has no delete tool for anything,
  and `status` on goals and projects accepts `active` or `completed` only. Archiving and deleting
  stay the user's own step in dayGLANCE. The one way an assistant's creation leaves the store is
  the user's undo.

## Error codes

| Code | Meaning |
|---|---|
| `validation` | Malformed argument, or a by-design rejection (message says which). |
| `not_found` | No task/block/user/goal/project/area/subtask with that id. |
| `device_calendar_readonly` | Target is a device calendar event (EventKit read-only). |
| `calendar_event_readonly` | Target is an event imported from a calendar feed; the feed owns it. |
| `note_changed` | A description write into a linked Obsidian note was refused because the note changed since `description_base` was read. Nothing was written. |
| `routine_readonly` | Target is a routine block. Routines are read-only over MCP by design. |
| `routine_conflict` | The requested time overlaps a routine block. dayGLANCE will not shift the task for you; pick a non-overlapping time. |
| `read_only_mode` | Writes are not enabled in Settings → Local Integrations. |
| `rate_limited` | Write gate: 30 writes/minute sliding window reached. |
| `writes_disabled` | Repeated rate-limit violations auto-disabled writes; re-enable requires user action. |
| `renderer_unavailable` | The dayGLANCE window is not available to answer (never an empty result). |
| `internal` | Unexpected failure; message carries what is known. |

---

## Block types

Every block returned by `dayglance_get_today`, `dayglance_get_day`, and the schedule resources
carries a `type`. All of them occupy the time they cover.

| `type` | What it is | Writable |
|---|---|---|
| `task` | An ordinary dayGLANCE task placed on the calendar. | yes |
| `recurring_task` | One instance of a recurring series, with a synthetic `recurring-<id>-<date>` id. | move/resize/complete rejected; edit the series in the app |
| `device_calendar_event` | An event from the device calendar (EventKit). Carries `read_only: true`. Only under the calendar consent tier. | no |
| `calendar_event` | An event imported from an ICS or CalDAV calendar feed. Carries `read_only: true`; the feed owns it. Every write tool rejects it with `calendar_event_readonly`. | no |
| `routine` | A routine block placed on today's timeline, id `routine-<id>`. Carries `read_only: true`. | no |

Branch on `read_only` rather than on `type`: more than one type carries it, and more may later.
A `task` with `source: "caldav_tasks"` comes from a CalDAV task calendar: it is a task, but
editing and completing it need a CalDAV write MCP does not perform, so those are rejected.

Blocks and inbox items carry `assignee_id` when the task is assigned (multi-user), and inbox
items carry `duration_minutes`, the duration scheduling will default to.

**`daily_note` rides every day read.** `dayglance_get_today`, `dayglance_get_day` and the
schedule resources return `daily_note`: `{ text, last_modified }` for the user's note on that
date as dayGLANCE shows it, or `null` when the date has no note. `last_modified` is present only
when the app knows it. Where an Obsidian vault is connected, the app's copy is kept in step with the
vault's daily note, so this is the same text. Read-only over MCP.

**Frames are not blocks.** `dayglance_get_today`, `dayglance_get_day`, and the schedule resources
also return a `frames` array beside `blocks`. A block is work ON the day; a frame is a window the
user set aside FOR a kind of work, so it is reported separately and never appears in `blocks`.

| Field | Meaning |
|---|---|
| `id` | `frame-<id>-<date>`: a frame recurs, so the id names the instance |
| `start` / `end` | the window itself |
| `available_slots` | free gaps, **already net** of tasks, routines, elapsed time (today), and the frame's buffer |
| `available_minutes` | the sum of those slots |
| `tag_affinity` | the `#tags` this window is meant for |
| `energy_level` | `low` / `medium` / `high`, as the user set it |
| `buffer_minutes` | breathing room kept around each occupied stretch |
| `read_only` | always true; frames are edited in the app |

Do **not** subtract `blocks` from a frame yourself: `available_slots` has already done it, with the
buffer applied, and re-subtracting double-counts. Do your own matching against `tag_affinity`:
dayGLANCE reports the tags and filters nothing on your behalf.

An unplaced routine (chosen for today but never given a time) reports `all_day: true` with
`start_time` and `duration_minutes` both `null`: it is on the day but occupies no part of it.

## Read tools

### `dayglance_ping`
Connectivity check; touches no user data.
No parameters. Returns `{ ok: true, server: "dayGLANCE MCP" }`.

### `dayglance_get_today`
Today's schedule; resolves the current **local** calendar date on the user's machine — use
this instead of guessing the date.
No parameters. Returns `blocks`, `frames` and `daily_note` with local times, completion state, the
resolved date, and the IANA timezone. Blocks include `routine` blocks (today only), imported
`calendar_event` items, and, under the calendar consent tier, `device_calendar_event` items.

### `dayglance_get_day`
One local calendar date's schedule, in the same shape as `dayglance_get_today`: `blocks`, `frames`
and `daily_note`. For the current date prefer `dayglance_get_today`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `date` | string | yes | Strict `YYYY-MM-DD`, a real local calendar date. Not a timestamp. |

### `dayglance_list_unscheduled_tasks`
The inbox: tasks not yet scheduled onto a day. Paginated, with opt-in filter selection.
**Bucket List (someday/maybe) items are never returned** — the app's unconditional inbox
exclusion applies here, not a filter argument, and `bucketId` never appears on the wire.

| Param | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | no | Page size 1–200. Default 50. |
| `cursor` | string | no | Opaque cursor from a previous response's `next_cursor`. Bound to the filters it was issued under (see below). |
| `scope` | `'all'` \| `'standalone'` \| `'project'` | no | Default `'all'` (every unscheduled task). `'standalone'`: tasks not attached to a project — what the app itself counts as the inbox. `'project'`: only project-attached tasks. |
| `include_completed` | boolean | no | Default `true`. Pass `false` for open tasks only. |

Returns `{ items, truncated, next_cursor, total, timezone }`. Items carry `id`, `title`,
`priority` (0–3), `completed`, `duration_minutes`, and `deadline` / `project_id` / `notes` /
`assignee_id` / `subtasks` when set.

Filtering happens before pagination: `total`, `truncated`, and `next_cursor` always describe
the **filtered** set. A filter matching nothing returns an empty list with `total: 0`, not an
error. Cursors encode the resolved filter they were minted under; presenting a cursor with
different filter arguments is a `validation` error naming both sides — restart with a fresh
call (no cursor) to change filters. Defaults are resolved before comparison, so omitting
`include_completed` on one page and passing `include_completed: true` on the next never
mismatches. `scope: 'standalone'` with `include_completed: false` is the app's own inbox
count (the same predicate the TRMNL integration uses).

### `dayglance_list_bucket_list`
The Bucket List: someday/maybe items kept out of the inbox on purpose, in two lists with the
user's own headings (by default Anytime and Someday). No parameters. Returns
`{ lists: [{ id, heading, items }], timezone }`; items are inbox-shaped plus `bucket_id` and
carry no priority or deadline (demotion strips them). Archived items are left out, as the app
leaves them out. Read-only over MCP: moving an item between the Bucket List and the inbox is
done in dayGLANCE.

### `dayglance_list_users` *(exists only while multi-user mode is on)*
The household members tasks can be assigned to. Returns active users as `{ id, name }`;
the `id` is what `assignee_id` accepts. Resolve names through this list, never guess an id.
No parameters.

### `dayglance_get_goal_progress`
Goals and projects with their fields and duration-weighted progress, matching what the app shows.

| Param | Type | Required | Notes |
|---|---|---|---|
| `goal_id` | string | no | Narrow to one goal's tree. Unknown id → `not_found`. |
| `window` | `'active'` \| `'all'` | no | Default `'active'`; `'all'` includes archived/completed. |

Each goal: `id`, `title`, `status`, `description`, `start_date`, `target_date` (null when unset),
`progress_percent`, `projects`, plus when present `area_id` and `area_name`, `assignee_ids`
(multi-user), and `obsidian_note` (`{ path, name, missing }`). Each project: `id`, `title`,
`status`, `description`, `progress_percent` (null when nothing is measurable), `tasks_done`,
`tasks_total`, plus when present `goal_id`, `assignee_ids`, `obsidian_note`. Standalone projects
are listed under `standalone_projects`.

**A goal or project with `obsidian_note` keeps its description in that note's opening section**
(companion spec §4.3). This tool reads it from the note: such an entity carries
`description_source: "obsidian_note"` and `description_base`, the hash of the section as read, to
pass back on a write. When this computer cannot read the vault (the vault folder was never chosen
here), the pointer alone is returned and `description` is empty. Reads open the linked notes, at
most 40 per call. Tasks carry `project_id`, so `dayglance_get_day` and
`dayglance_list_unscheduled_tasks` give a project's tasks.

### `dayglance_list_areas`
The areas of life a goal can belong to, as `{ id, name }`, in the user's order. Use the id as
`area_id` on `dayglance_create_goal` and `dayglance_update_goal`. Areas are managed in dayGLANCE
and cannot be created over MCP.

---

## Write tools

Placements are checked against routine occupancy. `dayglance_create_task` (with a start),
`dayglance_schedule_task`, `dayglance_move_block`, and `dayglance_resize_block` refuse with
`routine_conflict` when the requested span overlaps a routine block, naming the routine and its
span. **dayGLANCE does not shift your task to the next free time**, which would make the tool
report a placement you did not ask for. Task-on-task overlap remains allowed; only routines are
protected, because they cannot be moved over MCP. A task ending exactly when a routine begins
does not conflict.


All write tools run the same pipeline, in order: writes-enabled check (`read_only_mode`),
idempotency replay, rate gate (`rate_limited` / `writes_disabled`), argument validation,
then the mutation — which goes through the same store layer as the app's own edits, so sync,
Obsidian writeback, and the tray all react exactly as they would to a UI edit.

**Task ids can change; the old id keeps working.** When the Obsidian integration claims a
task (a project task whose project has a linked note), it re-keys the task to
`obsidian-dg-<id>` shortly after creation. Every write tool that takes a task or block id
resolves a retired id to its successor, so an id `dayglance_create_task` returned stays
usable. A response for a resolved id carries the task's current id plus `resolved_from`,
the id you passed.

### `dayglance_create_task`
Two shapes, decided by `start`: **without** it, an unscheduled task, in the inbox or in a
project via `project_id` (either may carry priority and deadline); **with** it, a scheduled task placed directly onto the calendar in one call.

| Param | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Non-empty. Stored literally (no sigil parsing). |
| `notes` | string | no | |
| `project_id` | string | no | Attach to a project (ids from `dayglance_get_goal_progress`). |
| `assignee_id` | string | no | **Multi-user only** (absent from the schema otherwise). Ids from `dayglance_list_users`. |
| `priority` | integer | no | **Unscheduled only** (inbox or project). 0 none (default), 1 low, 2 medium, 3 high. |
| `deadline` | string | no | **Unscheduled only** (inbox or project). Local `YYYY-MM-DD`. |
| `start` | string | no | Local `"YYYY-MM-DD HH:MM"`; with `all_day`, a bare `YYYY-MM-DD`. Presence = scheduled create. |
| `duration_minutes` | integer | no | 1–1440. Default 30. Contradicts `all_day`. |
| `all_day` | boolean | no | With `start` only. |
| `repeat` | — | no | **Rejected**: recurring creation is not supported over MCP. |
| `idempotency_key` | string | no | Also seeds a deterministic task id, so replays converge. |

By-design `validation` rejections: priority/deadline with `start`; `all_day` + `duration_minutes`; `all_day` with a time in `start`; any `repeat`.
Unknown `assignee_id` → `not_found`.

### `dayglance_update_task`
Field editor for existing tasks: inbox, project, or scheduled. **Absent leaves a field alone, present
sets it, a field named in `clear_fields` is removed.** Clearing only ever happens through the
explicit list — `null` or empty values never clear.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Recurring-instance ids are rejected (see below). |
| `title` | string | no | Non-empty; trimmed. Can be set, never cleared. |
| `notes` | string | no | Empty string is a valid *set*; removal goes through `clear_fields`. |
| `priority` | integer | no | 0–3. **Unscheduled tasks only** (inbox or project). |
| `deadline` | string | no | Local `YYYY-MM-DD`. **Unscheduled tasks only** (inbox or project). |
| `assignee_id` | string | no | **Multi-user only.** Ids from `dayglance_list_users`. |
| `project_id` | string | no | Move the task into a project (ids from `dayglance_get_goal_progress`). Unknown id → `not_found`. |
| `clear_fields` | string[] | no | Accepts only `"notes"`, `"deadline"`, `"project"`, `"assignee"` (assignee: multi-user only). Naming `title` or anything else → `validation`. |
| `idempotency_key` | string | no | |

Also `validation`: setting and clearing the same field in one call; a call that neither sets
nor clears anything. By-design rejections: priority/deadline (set **or** clear) on scheduled
tasks; recurring instances (dedicated error naming the synthetic
`recurring-<template>-<date>` id shape); CalDAV task-calendar tasks; `_native` events.
Date/time/duration/completion have their own tools, and subtasks have
`dayglance_add_subtask` and `dayglance_update_subtask`.
A `task_id` returned by `dayglance_create_task` keeps working after the Obsidian re-key to
`obsidian-dg-…`; the response carries the current id plus `resolved_from`.

### `dayglance_schedule_task`
Schedule an unscheduled inbox task onto a day and time.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Must be an inbox task; an already-scheduled id → `validation` pointing to `move_block`. |
| `start` | string | yes | Local `"YYYY-MM-DD HH:MM"`. |
| `duration_minutes` | integer | no | 1–1440. Defaults to the task's own duration, then 30. |
| `idempotency_key` | string | no | |

If the inbox task carried a priority or deadline, scheduling **drops them by design** and the
response lists them in `dropped_fields` with a note — tell the user rather than treating it
as an error.

### `dayglance_move_block`
Move a scheduled block to a new local start (same or different day).

| Param | Type | Required | Notes |
|---|---|---|---|
| `block_id` | string | yes | Recurring instances → `validation` (edit the series in dayGLANCE). |
| `new_start` | string | yes | Local `"YYYY-MM-DD HH:MM"`. |
| `idempotency_key` | string | no | |

### `dayglance_resize_block`
Change a scheduled block's duration without moving its start.

| Param | Type | Required | Notes |
|---|---|---|---|
| `block_id` | string | yes | Recurring instances → `validation`. |
| `duration_minutes` | integer | yes | 1–1440. |
| `idempotency_key` | string | no | |

### `dayglance_set_task_completion`
A **setter, not a toggle** — safe to retry, and `completed: false` is the agent's own undo.
Works for scheduled blocks, inbox tasks, and recurring-task instances
(`recurring-<template>-<date>` ids complete exactly one date of the series).

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | |
| `completed` | boolean | yes | |
| `idempotency_key` | string | no | |

CalDAV task-calendar tasks are rejected (`validation`): completing one requires a CalDAV
write MCP does not perform.

### `dayglance_add_subtask`
Add a subtask to a task (inbox, project, or scheduled). Subtasks are the task's own checklist,
reported as `subtasks` (`{ id, title, completed }`) on tasks and blocks.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Recurring instances → `validation`. |
| `title` | string | yes | Non-empty; trimmed. |
| `idempotency_key` | string | no | A replay returns the same subtask. |

Returns the resulting task or block and the new `subtask`. **There is no subtask delete**; the
user's undo removes subtasks an assistant added.

### `dayglance_update_subtask`
Edit a subtask's title, its completion (a setter, not a toggle), or both.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | |
| `subtask_id` | string | yes | From the task's `subtasks`. Unknown → `not_found`. |
| `title` | string | no | Non-empty; can be set, never cleared. |
| `completed` | boolean | no | |
| `idempotency_key` | string | no | |

### `dayglance_create_goal`
Create a goal. New goals are active; the colour is copied from the area at creation, as the form
does.

| Param | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | |
| `description` | string | no | The goal's notes box. |
| `start_date` | string | no | Local `YYYY-MM-DD`. |
| `target_date` | string | no | Local `YYYY-MM-DD`; must not precede `start_date`. |
| `area_id` | string | no | From `dayglance_list_areas`. Unknown → `not_found`. |
| `assignee_ids` | string[] | no | **Multi-user only.** Ids from `dayglance_list_users`. |
| `idempotency_key` | string | no | A replay returns the same goal. |

### `dayglance_update_goal`
Field editor for goals, with the `update_task` contract: absent leaves alone, present sets, a name
in `clear_fields` removes.

| Param | Type | Required | Notes |
|---|---|---|---|
| `goal_id` | string | yes | |
| `title` | string | no | Can be set, never cleared. |
| `description` | string | no | On a goal with `obsidian_note`, the opening section of that note (see below). |
| `description_base` | string | no | The `description_base` a read returned. With it, a note write is refused with `note_changed` if the note changed since; without it the write is unconditional. Only with `description`. |
| `start_date` / `target_date` | string | no | Local `YYYY-MM-DD`. |
| `area_id` | string | no | |
| `status` | `'active'` \| `'completed'` | no | `'archived'` → `validation` (by design). Completing requires every active child project to be completed, the form's own rule. |
| `assignee_ids` | string[] | no | **Multi-user only.** Replaces the list. |
| `clear_fields` | string[] | no | `"description"`, `"start_date"`, `"target_date"`, `"area"`, `"assignees"` (multi-user). |
| `idempotency_key` | string | no | |

### `dayglance_create_project`
Create a project, standalone or under a goal. A project under a goal takes the goal's colour and
assignees at creation and follows neither afterwards (the form's inheritance).

| Param | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | |
| `goal_id` | string | no | Omit for standalone. Unknown → `not_found`. |
| `description` | string | no | The project's notes box. |
| `assignee_ids` | string[] | no | **Multi-user only.** Overrides the inheritance. |
| `idempotency_key` | string | no | |

### `dayglance_update_project`
Field editor for projects, same contract.

| Param | Type | Required | Notes |
|---|---|---|---|
| `project_id` | string | yes | |
| `title` | string | no | |
| `description` | string | no | On a project with `obsidian_note`, the opening section of that note (see below). |
| `description_base` | string | no | As on `dayglance_update_goal`. |
| `goal_id` | string | no | Move under another goal. `"goal"` in `clear_fields` makes it standalone. |
| `status` | `'active'` \| `'completed'` | no | `'archived'` → `validation`. Completing requires every task in the project to be completed. |
| `assignee_ids` | string[] | no | **Multi-user only.** |
| `clear_fields` | string[] | no | `"description"`, `"goal"`, `"assignees"` (multi-user). |
| `idempotency_key` | string | no | |

**Descriptions in linked notes.** For a goal or project with `obsidian_note`, `description` on
the update tools writes the opening section of that note through the app's own section save: the
note is read again first and, when `description_base` was given and the section moved, nothing is
written and the call fails with `note_changed` (read the entity again and retry with the new base).
The rest of the note is never touched. The response carries `description_source`, the new
`description_base`, and `note_write`: `"written"` when the file was written directly, `"queued"`
when the bridge plugin will apply it the next time Obsidian is open, during which a read can still
return the old text. The write journal reverses it by putting the previous section back under the
same rule, so an undo never overwrites an edit made in Obsidian meanwhile; such an undo reports as
skipped. Other fields in the same call are applied to the record as usual.

---

## Resources (read-only)

| URI | Content |
|---|---|
| `dayglance://schedule/today` | Today's `blocks`, `frames` and `daily_note`, local date + timezone echoed. Includes `routine` blocks. |
| `dayglance://schedule/week/current` | The week containing today, starting on the configured week-start day (`week_start_day`, 0 = Sunday). Each day carries its own `blocks`, `frames` and `daily_note`. Only the day that is today can carry `routine` blocks; the other six showing none is expected. |
| `dayglance://goals/tree` | Goal/project hierarchy with duration-weighted progress — same data as `dayglance_get_goal_progress`, descriptions read from linked Obsidian notes included. |

All three read over the same renderer path as the tools and respect the same consent tiers;
failures throw with the same code + message text a tool error would carry.

---

*Schema gating recap: `dayglance_list_users`, `assignee_id` (task write tools), `assignee_ids`
(goal and project tools), and `"assignee"` / `"assignees"` in `clear_fields` exist only while
multi-user mode is on. The tool list is
rebuilt per request, so toggling multi-user or a consent tier updates what a connected
client sees on its very next request.*
