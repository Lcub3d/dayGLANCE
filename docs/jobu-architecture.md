# Jobu: personal product architecture

Owner: **Lcub3d**. Product branch: `product/jobu`.
Task-entry branch: `feature/jobu-todoist`. These branches are not upstream PR #1840.

## Provenance and retained features

Base: `04f4f94db22e06e94ed156017dae3a7f4901193c` (fork main at integration).
Full JOBO: `reference/jobo-full-20260927` at `5918cefd60e1b2a91f3121cce23396e4a5d077a9`.
Life Planner: `prototype/lifeplanner` at `ba42ef2ad907be0c5c3633cfaf891b70b91389bb`.
Completion-point presentation adopts the validated helper from `3da80f2`.

Full JOBO retains daily analysis, manual creation, native Plan creation/copy/drag/
resize, per-attempt reassessment, snapshots/comparison, Focus/Priority/Frames,
connections and notes. The initial integration displayed completion-only Do as
points. The subsequent personal-product interaction change `30d8676` uses editable
backward-looking interval defaults ending at the source completion clock. That
is a Jobu product choice, not an upstream timing contract or proof of measured
focus time. PR #28's follow-up review preserves this existing behavior and aligns
the inherited convergence test with it; it does not introduce a new completion
bridge or modify the JOBO detector, core, or transport implementation.

Life Planner retains the ruled notebook, opt-in assistant, mottos, visions and
stages, SWOT, native goal/project handoff and Life Map. It does not require the
upstream slice schedule to evolve. Its original horizon/quantity validation is
retained for this first integration, not declared a permanent Jobu limitation.

## Data ownership

| Domain | Durable owner | Write path |
| --- | --- | --- |
| Tasks | Existing native collections | Native handlers/setters |
| Wishes, visions, goals, projects, unclassified ideas | Canonical `lifeNode` revisions | Unified Life Map / notebook / native adapters -> Jobu transaction |
| Execution evidence | Existing JOBO ledger | `recordJobo` |
| Mottos/order | Personal immutable revisions | `createDurablePlannerStore` -> Jobu transaction |
| Day templates and day assignments | Personal immutable revisions | Jobu transaction |
| Saved filters | Personal immutable revisions | Jobu transaction |
| Independent Do note text | Separate personal `doNote` revisions | Jobu transaction (not whole-Do text merge) |

`jobuRecords` is an append-only revision collection, keyed by revision UUID;
`entityId` identifies the logical value. Each row has version, kind, value,
deleted and updatedAt. Materialization selects one deterministic latest version;
**all competing text revisions remain recoverable** in History/export. This is
not character-level collaborative editing. Stale open entity editors reject a
changed head; unrelated entity edits coexist. No revision or tombstone pruning.

`jobu-personal-v1` uses the existing strict IndexedDB store abstraction with an
atomic read/transform/write transaction and Web Locks guarded fallback. Reads
which fail never become a writable empty collection; state publishes only after
commit. Remote failures stay retryable with backoff. Local failures keep the
caller's draft and reject the operation. A stable operation ID supports retry.
The remote retry queue is in memory, not a crash-durable outbox.

Both file sync (`mergeSyncData`) and DB sync (`dbAdapter`) carry `jobuRecords`.
Missing collection is unknown, not deletion. Immutable revisions use union;
there is no task retention horizon and no transport deletion of revision rows.
App payloads, apply, backups/restore and full reset include the new collection.
Tests walk real adapter boundaries and IndexedDB. **No live cloud credentials
or physical cross-device provider sessions were used during integration.**

Personal planning now uses a common flat node format. Native goal/project
collections are compatibility projections; legacy nested notebook views adapt
writes to the same journal. Existing IDs, measured milestone facets and tasks
remain intact when map classification changes. The first loaded personal session
performs an atomic idempotent upgrade with an exact local source-recovery copy.
Malformed/future data fails closed. See [Unified Life Map](jobu-unified-lifemap.md)
for the schema, lane/inbox/focus interactions, mixed-version upgrade requirements,
legacy editor limitations and recovery procedure.

Personal export includes planning revisions; tasks and execution records remain
in the whole-app backup. Import merges history rather than performing a destructive
rewind. Restore of an entity creates a new revision; retired nested wish versions
are inspection-only after normalization. Export both whole-app and personal
backups before changing deployments. Planning hierarchy, classification and node
positions are journal data; transient focus/zoom may remain device-local.

## Task input and filters

Offline syntax: `#Project` / `#"Project with spaces"`, `@label` or `%label`, p1–p4,
English date/time phrases supported by the inherited parser, and Chinese 今天 /
明天 / 后天 / N天后 / 下周一, 上午/下午 N点半, 分钟/小时. Parsing is previewed and
individually reversible. Unknown projects do not silently create or reassign
resources. Unsupported recurrence remains explicit and directs users to the
native task editor; this is **not full Todoist natural-language parity**.

p1 maps to native priority 3, p2=2, p3=1, p4=0. Labels reuse native `#tag` text
storage; the Jobu UI presents `@tag`. No second task database or Todoist API is
required. The existing Todoist provider integration is not rewritten.

Filter grammar: `&`, `|`, `!`, parentheses, today/tomorrow/overdue/no date,
completed/all, p1–p4, #project, @/%label, search:text. Invalid expressions fail
closed. Saved filters have live counts in GLANCE and open the task page.

## Year view

Initial annual heatmap: one civil date per cell, leap-year safe. Intensity buckets
are 0 / 1–2 / 3–5 / 6–9 / 10+ unique completed tasks on the source completion day.
Native completions and completion-created Do are deduplicated. Manual/split Do
segments do not inflate task counts. A source with no timestamp is not invented;
the display is evidence-backed and may be incomplete for older missing history.

Day templates (business trip, holiday, deadline, custom) are annotations. A dot
shows template color, heatmap intensity remains completion count; native Goal
target dates have a diamond. Applying a range snapshots the chosen template.
Optional schedule blocks only create tasks after an explicit button press, using
stable day/template/block IDs to avoid duplication. No task is created merely by
coloring a day. First version supports up to 366 days per batch and one template
per day; refine the interaction after real use.

## Isolation and release boundaries

Run on port 5197 (preview 4197), preferably a separate browser profile and a
separate sync vault. Native task storage keys and native sync identities remain
inherited; **do not point experimental Jobu and stock dayGLANCE at the same
profile/origin/vault without backup and migration planning**. Personal journal
revision kinds are not understood by old stock clients. Shared-household/role
permission design is not complete; this initial product is for one's own devices.

This delivery is a source branch plus a web first pass. Native installer bundle
IDs, signing, provider registrations and release branding are not yet forked.
Do not publish an installer claiming to be the official dayGLANCE application.
MIT copyright/license notices are retained. The logo assets remain inherited
for development; final product artwork/brand should be chosen before release.
