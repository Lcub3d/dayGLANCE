# Jobo

**Plan with intention. Record what happened. Review and adjust.**

[简体中文](README.zh-CN.md) · [Development mainline](https://github.com/Lcub3d/dayGLANCE/tree/jobo-main) · [Maintenance & provenance](docs/jobo-maintenance.md) · [Acknowledgements](ACKNOWLEDGEMENTS.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: development preview](https://img.shields.io/badge/status-development_preview-orange.svg)](docs/jobo-maintenance.md)
[![Jobo CI](https://github.com/Lcub3d/dayGLANCE/actions/workflows/jobo-ci.yml/badge.svg?branch=jobo-main)](https://github.com/Lcub3d/dayGLANCE/actions/workflows/jobo-ci.yml?query=branch%3Ajobo-main)

> **Jobo is an independently maintained fork of [dayGLANCE](https://github.com/krelltunez/dayGLANCE), maintained by [Lcub3d](https://github.com/Lcub3d).** It is not an official dayGLANCE release or a promise of upstream adoption. New Jobo development takes place on **`jobo-main`**. The repository retains its existing address to preserve contribution history and open upstream pull requests.
>
> **Development preview:** the Plan / Do journal is still opt-in and local-only. Export the separate Jobo JSON backup before relying on real records. Native cloud sync and standard backup do not automatically cover the journal.

## A planner that keeps intention and execution separate

Jobo connects a small Plan–Do–Check–Act loop with the existing dayGLANCE planner. The point is not to replace every task with another task, but to make the difference between a plan and what actually happened visible.

| Stage | Available in this branch |
| --- | --- |
| **Plan** | Native tasks and scheduling, with a first-observed timed baseline for comparison. Baseline capture is not yet universal across all scheduling paths. |
| **Do** | Editable actual-time intervals, repeated attempts and unplanned activities. One task can have several intervals. |
| **Check** | Plan / Do comparison, independent timing and attempt-progress information, and native notes for context. |
| **Act** | User-selected Carry Forward creates new inbox tasks without erasing the original plan or execution history. |

**Desktop** uses Plan / Do / Notes in the day view, with a week projection of execution history and future plans. **Mobile** adds a compact Plan / Do journal around a shared time axis, a collapsible task list and native daily notes. The original mobile grid remains available.

Recording a Do interval is **not** native task completion and does **not** send a Todoist completion command. Progress describes an execution attempt, not a calculated completion percentage for the whole task. Missing records are not proof of what happened outside the app.

Existing dayGLANCE capabilities remain the foundation, including task organisation, calendar views, notes, themes and optional integrations. Todoist and Obsidian are not required for the basic Jobo loop. This branch also contains the Simplified Chinese and selective Todoist contributions listed below.

## Included contributions

| Original dayGLANCE PR | Content | How it is included |
| --- | --- | --- |
| [#1555](https://github.com/krelltunez/dayGLANCE/pull/1555) | Simplified Chinese localisation | Inherited through the upstream history |
| [#1566](https://github.com/krelltunez/dayGLANCE/pull/1566) | Remaining GLANCE labels and Chinese Area terminology | Inherited through the upstream history |
| [#1604](https://github.com/krelltunez/dayGLANCE/pull/1604) | Selective Todoist sync | Inherited through the upstream history, including subsequent upstream changes |
| [#1673](https://github.com/krelltunez/dayGLANCE/pull/1673) | Desktop Jobo journal and PDCA prototype | Included as an ancestor of the mobile branch |
| [#1675](https://github.com/krelltunez/dayGLANCE/pull/1675) | Mobile Plan / Do journal | Starting source revision of `jobo-main` |

The two Jobo PRs remain separate upstream proposals. Integrating their code here does not merge or close them upstream. Their source branches are retained and are not the mainline for new Jobo features. Exact revisions are recorded in [Maintenance & provenance](docs/jobo-maintenance.md).

## Run the preview from source

Use Node.js 22 and npm. Run the preview in a **separate browser profile and origin** from any dayGLANCE installation containing important data.

```bash
git clone --branch jobo-main --single-branch https://github.com/Lcub3d/dayGLANCE.git jobo
cd jobo
npm ci
npm run dev -- --host 127.0.0.1 --port 5184 --strictPort
```

Open `http://127.0.0.1:5184`. A different origin has separate browser storage; this is not an automatic migration of an existing installation.

Enable the experimental Jobo option in Settings. On mobile, open Settings / App, enable Jobo, then use Timeline / Grid and the Plan / Do switch. The feature remains **off by default**, with the existing multi-user and tray exclusions.

For development validation:

```bash
npm run lint
npm test
npm run build
npm run build:android
```

The Android command builds WebView assets, **not** an installable or signed APK. The [Jobo CI workflow](https://github.com/Lcub3d/dayGLANCE/actions/workflows/jobo-ci.yml?query=branch%3Ajobo-main) also runs the existing compiled-app browser scenarios and archives the exact tested source, logs and screenshots. Consult the run result for the exact revision; a workflow badge or screenshot alone is not a release-readiness assessment.

## Read before storing important records

- **The ledger is original user data, not a cache.** It still uses `localStorage`; indefinite growth, IndexedDB migration and atomic cross-tab writes need further work.
- **Use the dedicated Jobo JSON export.** Standard native backup, cloud sync and reset/restore paths do not automatically provide complete journal coverage. Restore can replace local collections and is not transactional across every store.
- **Do is not an automatic activity tracker.** Automatic focus-session attribution, application-usage collection, advanced analytics and AI review are not implemented by this branch transition.
- **This is not a finished rebrand or native release.** Application identifiers, storage keys, internal `dayglance` names and inherited version metadata have deliberately not been mass-renamed. Do not treat the inherited `5.2.0` package version or upstream download buttons as a Jobo release. Independent native packaging, update channels and migration require separate verification.

See the [desktop design record](docs/jobo-design.md) and [mobile addendum](docs/jobo-mobile-review.md) for exact implemented rules and limitations. The desktop record describes the original PR scope; its older statements excluding mobile are superseded by the mobile addendum in this integrated branch. Week-view behaviour, recurrence/provider identity, timezone travel, accessibility and physical-device behaviour still need continued validation.

## Development and cooperation

**Jobo's product direction and maintenance are owned by Lcub3d.** Development does not depend on an upstream merge schedule. Suitable, self-contained improvements may still be offered to dayGLANCE separately; upstream decides what belongs in its project.

Start new work from `jobo-main`, not the legacy `main` or an existing upstream PR branch. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Inherited upstream documentation is preserved in [README.upstream.md](README.upstream.md), [CONTRIBUTING.upstream.md](CONTRIBUTING.upstream.md) and [CLAUDE.upstream.md](CLAUDE.upstream.md) as reference material, not as Jobo release or governance claims.

## Acknowledgements and license

Jobo builds on the extensive work of **krelltunez and the dayGLANCE contributors**. Their planner, integrations, localisation infrastructure and tests made this work possible. We also appreciate the design review and feedback around the Jobo prototypes.

The original [MIT LICENSE](LICENSE), including the upstream copyright notice, is retained unchanged. Git history and existing attribution are preserved. See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for the distinction between upstream work, Jobo contributions and AI assistance.
