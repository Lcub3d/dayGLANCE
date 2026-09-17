# Jobo maintenance and provenance

Transition recorded: **2026-09-17**.

## Ownership and project boundaries

Jobo is independently maintained by Lcub3d. The upstream project remains krelltunez/dayGLANCE. This fork is not an official upstream edition and does not imply an upstream core-maintainer appointment. Design, fixes, integration choices and Jobo release decisions belong to this fork's maintainer; suitable changes may still be contributed upstream separately.

The repository URL remains `Lcub3d/dayGLANCE`. The product name is **Jobo**; the active product branch is **`jobo-main`**. Keeping the repository address and historical PR branches preserves existing upstream links and review context.

## Branch roles

| Branch | Role after this transition |
| --- | --- |
| `jobo-main` | Independent product development, integration and CI |
| `main` | Legacy code/reference plus an entry-page pointer to Jobo; not a feature-development base |
| `dayGLANCE-jobo` | Preserved source branch for upstream #1673; review fixes only when explicitly requested |
| `feature/jobo-mobile-plan-do` | Preserved source branch for upstream #1675; review fixes only when explicitly requested |
| Other historical feature/build branches | Retained history; no bulk deletion or renaming is part of this transition |

Retiring the old development line means no new Jobo product work is based on it. It does **not** mean deleting an upstream PR's head branch or archiving the entire repository. Repository default-branch settings are distinct from this policy and may still point to `main`; always select `jobo-main` explicitly when cloning or opening a Jobo PR.

## Exact integrated history

The initial `jobo-main` ref points to **`8a6a11cb41e43cdeca5d3d8cdb347d37695c5084`**, the submitted mobile Plan / Do source. That commit already descends from desktop PR #1673: GitHub's comparison against `4fdf3b9a0c187de346f9ab388c16239483c22da9` reports **11 commits ahead and 0 behind**, with the desktop head itself as the merge base.

This is an ancestry-preserving integration. Reapplying the desktop patch or manufacturing a duplicate merge would not add its code again. All existing source commits are kept; this transition does not squash, rebase or rewrite them.

| Upstream PR | Integration anchor | Meaning |
| --- | --- | --- |
| [#1555](https://github.com/krelltunez/dayGLANCE/pull/1555) | `dc78bcb938f74552702b67507947e3834bc1269b` | Upstream merge: Simplified Chinese localisation |
| [#1566](https://github.com/krelltunez/dayGLANCE/pull/1566) | `e9e2d951c259a85b18749925715e2ec0ab4823a6` | Upstream merge: GLANCE labels and Chinese terminology |
| [#1604](https://github.com/krelltunez/dayGLANCE/pull/1604) | `bf7fd2fca2301b6ab5a76680b4c587ddfef7da9a` | Upstream merge: selective Todoist integration |
| [#1673](https://github.com/krelltunez/dayGLANCE/pull/1673) | `4fdf3b9a0c187de346f9ab388c16239483c22da9` | Desktop Jobo PR head, included unchanged in ancestry |
| [#1675](https://github.com/krelltunez/dayGLANCE/pull/1675) | `8a6a11cb41e43cdeca5d3d8cdb347d37695c5084` | Mobile Jobo PR head and initial source baseline |

At transition, the first three PRs were already merged upstream; #1673 and #1675 were open and unmerged. No upstream PR metadata, state, source ref or review comment is changed by this operation. Later upstream decisions can of course change those PRs independently.

The original upstream base for the desktop port is `a39d73c9ead3456ad0ea69e00d142b28008a9ff6`. This branch is not a claim to contain every later upstream `main` commit. Future upstream updates should be deliberately reviewed and integrated, with data-affecting and security fixes prioritised.

## What this transition changes

- Adds the independent `jobo-main` integration line.
- Replaces the project README and development instructions, adds a Chinese README, acknowledgements and this provenance record.
- Preserves the original README, contribution guide and Claude instructions as `.upstream.md` reference snapshots.
- Adds `Jobo CI` for this branch, including ancestry and original-license checks, lint, full tests, builds and existing browser scenarios.
- Gives the legacy repository entry page an explicit route to the new mainline without changing application code in that legacy branch.

It does not introduce a new runtime backend, change ledger schema, automatically enable Jobo, alter task-completion semantics, deploy a service, issue a signed installer or modify upstream release channels. Inherited app identifiers and version strings remain unchanged pending dedicated packaging and migration work.

## Validation and data safety

The `Jobo CI` workflow checks all five integration anchors with `git merge-base --is-ancestor` and verifies that LICENSE still has its original blob SHA `9f2ee04eeea6c05347e68dd450dbb81733a17724`. It then runs the full test suite, lint, web and Android-web builds, and the existing mobile/desktop browser regression scenarios with synthetic data.

Use [the workflow runs](https://github.com/Lcub3d/dayGLANCE/actions/workflows/jobo-ci.yml?query=branch%3Ajobo-main) for the actual pass/fail result and tested SHA. This document records the procedure, not an unconditional assertion that any future run is green. The workflow archives `commit.txt`, the source, test logs and browser artifacts; screenshots are compiled-app Chromium captures, not physical-device tests.

The existing journal remains experimental/local-only. Dedicated JSON backup, retention, storage quotas, concurrency, reset/restore and cross-device lifecycle remain the responsibility of this fork. Upstream work may later inform a solution, but is not a delivery commitment for Jobo.

The desktop design file is the original #1673 specification and retains its historical scope. For the integrated branch, read it together with the mobile addendum; statements excluding mobile from the original desktop submission are not a description of this branch's combined feature set.

## Next development priorities, not completed features

First make the existing daily loop dependable in real use, including the reported WEEK projection behaviour. Develop safe persistence, export/restore and migration contracts before treating the journal as a long-term production archive. Independent application identity, installation/data isolation and update channels need their own tests before native distribution. Longer-term workflow ideas can then be implemented on the independent mainline without waiting for upstream acceptance.
