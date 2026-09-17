# Contributing to Jobo

Jobo is maintained by [Lcub3d](https://github.com/Lcub3d) in the **`jobo-main`** branch of this repository. It is an independently maintained dayGLANCE-based development preview, not an official upstream release.

## Choose the correct base

Create a fresh branch for each bounded change:

```bash
git fetch origin jobo-main
git switch -c feature/your-change origin/jobo-main
```

Target this repository's `jobo-main` when opening a Jobo PR. Do not rely on GitHub's default base selection: the repository may still open on its legacy `main` branch.

- `jobo-main`: ongoing Jobo development and integration.
- `main`: legacy code/reference and repository-entry guidance; not the base for new Jobo features.
- `dayGLANCE-jobo`: retained source of upstream PR #1673.
- `feature/jobo-mobile-plan-do`: retained source of upstream PR #1675.

Do not delete, rename, force-push, or add unrelated features to the two upstream PR branches. Changes requested in their existing reviews should be handled explicitly and separately. Check current PR state and branch head before updating an existing review branch.

## Describe behaviour, not just screenshots

Provide the user scenario, current and expected behaviour, reproduction steps, environment, and a concise explanation of changes. Use synthetic data in screenshots and fixtures. Identify data migrations and integration side effects explicitly.

Where this fork's issue tracker is unavailable, use the agreed discussion channel or a focused PR against `jobo-main`; do not send Jobo-specific support requests to upstream as though they were upstream defects.

## Validate the actual revision

Use Node.js 22 and the committed lockfile:

```bash
npm ci
npm run lint
npm test
npm run build
npm run build:android
```

`Jobo CI` runs the complete test suite, builds, existing browser scenarios and provenance checks. Read the result for the exact submitted SHA. Browser mobile emulation is not physical-device testing; Android-web output is not an APK; a source build is not a signed release. Do not skip tests or weaken assertions to manufacture a green result. Report failures and matched baseline evidence separately.

## Data and compatibility

Read [AGENTS.md](AGENTS.md), [the desktop design record](docs/jobo-design.md) and [the mobile addendum](docs/jobo-mobile-review.md). The original desktop document describes the historical desktop-only PR; mobile support in this branch is described in the addendum.

Preserve the distinction between task completion, time recorded and per-attempt progress. Journal data is original user data, not an expendable cache. Do not mass-rename storage keys, native app IDs, updater channels or provider identities as a branding cleanup. Export/restore, migrations, failed writes, repeated attempts, concurrency and undo require explicit regression coverage when affected.

Translations belong in the existing locale bundles. English fallbacks in other bundles provide key coverage, not proof of reviewed translation. Keep the established labels **Plan / Do** and **计划 / 执行**.

## Upstream contributions

Maintain collaboration without making upstream acceptance a gate for Jobo development. Only open or modify an upstream dayGLANCE PR when the owner explicitly requests it. Prepare focused contributions against an appropriate current upstream base; do not send independent branding, fork governance or unrelated product changes upstream by default.

Preserve original authorship and the MIT license. See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md). The previous upstream contribution guide is preserved as [CONTRIBUTING.upstream.md](CONTRIBUTING.upstream.md) for reference; its branch and submission defaults do not govern this fork.
