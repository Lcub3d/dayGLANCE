# Jobo development instructions

Read and follow [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for this independently maintained fork.

The active product branch is **`jobo-main`**, not the legacy `main` branch. New Jobo work should be based on `origin/jobo-main`. Upstream PR creation, comments, merging, closing and changes to existing PR source branches require an explicit owner request; they are not automatic workflow steps.

The previous upstream file is preserved unchanged as [CLAUDE.upstream.md](CLAUDE.upstream.md). It remains useful background for existing architecture and tests, but its upstream-first branch and PR instructions are historical and do not override this fork's instructions.

In particular, the Jobo ledger is original user data, not a disposable cache. Preserve its history, dedicated export and documented limitations. Do not claim native cloud backup covers it. Preserve **Plan / Do** terminology and the separation between execution records and native/Todoist task completion.
