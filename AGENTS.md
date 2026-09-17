# Jobo: instructions for coding agents

## Scope and ownership

- This is Lcub3d's independent Jobo fork of dayGLANCE. Read README.md, CONTRIBUTING.md and docs/jobo-maintenance.md first.
- The product integration branch is `jobo-main`, even if GitHub's repository default still points to `main`. Fetch and branch from `origin/jobo-main` for new Jobo work.
- Use a fresh branch per bounded change unless the owner explicitly requests a direct integration. Never assume work should be proposed upstream.
- Do not automatically create, close, merge, retarget or comment on upstream PRs/issues. External communication and upstream submissions require an explicit owner request.
- Preserve `dayGLANCE-jobo` and `feature/jobo-mobile-plan-do`, the sources of upstream PRs #1673 and #1675. Do not delete, rename or force-push them. Check the current PR state and head before any authorised review fix.
- Do not change repository visibility, archive the repository, or delete its history to represent the retirement of an old development line.
- `README.upstream.md`, `CONTRIBUTING.upstream.md` and `CLAUDE.upstream.md` are inherited reference snapshots. Their upstream submission/default-branch instructions are not active Jobo policy.

## Journal semantics

- Keep **Plan / Do** and **计划 / 执行** terminology. Do not relabel the interface Plan / Actual.
- A Do record is an execution interval, not native/Todoist task completion. Desktop checkboxes and mobile record controls have their documented meanings; do not conflate them with native completion.
- Baseline means the first observed valid timed plan, not a universally captured original schedule. Do not invent earlier plans or missing actuals.
- Progress belongs to an execution attempt; Plan displays the latest appended attempt's progress, not a computed aggregate.
- Timing and progress are independent. Interrupted is a segmentation heuristic, not proof of a real-world interruption. Missing records are not objective evidence of unrecorded behaviour.
- Preserve source history, repeated attempts, unplanned records, native canonical notes and Carry Forward provenance/deduplication.
- Read docs/jobo-design.md together with docs/jobo-mobile-review.md. The former retains the original desktop PR's scope; the latter supplies the integrated mobile behaviour.

## Data safety

- The Jobo ledger is original user data, **not a disposable cache**. Never prune user history to fit a quota.
- The inherited backend remains localStorage. Detected stale writes are not atomic cross-tab locking. Do not claim IndexedDB migration, complete reset/restore integration or cross-device sync is finished.
- Retain the dedicated Jobo JSON export. Native cloud/standard backup does not automatically cover the ledger. Keep failure handling and explicit warnings about non-transactional restore.
- A successful UI save must follow a successful durable write. Preserve drafts on failure, safe retry, deleted/stale-record checks and undo tests.
- Keep the existing default-off gate and its multi-user/tray exclusions unless a separately reviewed change explicitly alters them.
- Do not mass-rename application IDs, storage keys, provider IDs, version metadata or updater URLs as a branding operation. Independent installations and upgrades require tested migration and rollback plans.
- Do not claim a build is independently installable or safely isolated from upstream until identifiers, data paths, update channels and deployment have actually been checked.

## Todoist and Obsidian

- A missing Todoist source record means no information, never deletion. Empty advanced filters import nothing.
- Preserve the one-way guarded completion path, durable command UUIDs written before requests, Web Locks and read-only degradation when exclusive writes cannot be guaranteed.
- Keep the source integration structurally unable to delete native tasks. Do not add remote deletion, undelete or mirror semantics as a side effect.
- Todoist cache data and completion receipts have different durability contracts. Use the existing readAccountState/writeAccountState APIs; do not collapse their storage homes casually.
- Obsidian transport/scope changes need the existing real-hook scenario harness, not only mocked happy-path tests.

## Changes and validation

- Keep diffs focused. Use the existing hook/pure-utility structure; do not restructure unrelated App.jsx code during branding or documentation work.
- Use existing locale JSON files and test key/placeholder parity. An English fallback is not a completed translation.
- Run lint, the complete test suite, web/Android-web builds and affected browser scenarios. Do not weaken tests, exclude failures or confuse a prior commit's green run with the current one.
- Use synthetic test data. Never commit tokens, user exports, personal screenshots, signing credentials or generated installers as source changes.
- State precisely what was and was not tested. Mobile emulation is not hardware testing; Android-web is not an APK; inherited version numbers are not Jobo release numbers.
- Preserve LICENSE unchanged and retain source attribution. A fork does not imply upstream endorsement or an upstream core-maintainer role.
