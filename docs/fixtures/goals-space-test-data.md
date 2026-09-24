# Goals & Projects space: test data

`goals-space-test-data.json` is a dayGLANCE backup file with synthetic Goals &
Projects data for testing `docs/goals-space-spec.md` by hand, without real data
or any sync. `scripts/gen-goals-space-test-data.mjs` generates it; every date
is relative to the day it runs, so regenerate it when the "days left", overdue
and stalled states have drifted:

```
node scripts/gen-goals-space-test-data.mjs
```

## Loading it

Use a throwaway profile (a fresh browser profile, a private window, or a copy
of the Electron user-data folder). Restore **replaces** tasks, inbox, goals,
projects and areas, then reloads the app.

1. Header → the Save icon (Backup menu) → Restore from file.
2. Pick `goals-space-test-data.json` and confirm.
3. After the reload, press `g` or click the target icon at the far left of the
   header.

Nothing else is touched: no sync config, no settings, no habits or routines.

## What is in it

| Area (order) | Goals |
|---|---|
| App Development | Ship iOS Apps (4 projects, 40d left), Ship Electron Apps (1 project, 105d), GLANCEvault Pro launch (5 projects, one stalled), Migrate the blog (overdue) |
| Money / Finance | Build a 6-month emergency fund (3d left, amber), File 2025 taxes (completed), Old 2024 side hustle (archived) |
| Health | Run a half marathon (no target date, `hideStalled`) |
| Home | none: only in the filter and Manage Areas |
| No Defined Area | Learn piano (no projects, linked with lifeGLANCE) |

Standalone projects (Projects tab, Open / Completed): dayGLANCE (9 tasks, one archived, "N more"
fold, Obsidian note badge), lastGLANCE, GitHub config (no tasks), Dead Money
(`detailsHidden`, missing Obsidian note), Employment search (priorities and
deadlines), Garage clear-out (completed), Retired: Etsy shop (archived).

Also: an on-demand hyperGLANCE session today (Code signing), a recurring one
on Mon/Wed/Fri (Strength & mobility), a recurring task series on a project
card (Pro billing), tasks with notes, subtasks, `#tags` and a `[[wikilink]]`,
scheduled tasks yesterday / today / next week, inbox tasks with overdue and
due-today deadlines, and durations chosen so weighted progress is not a plain
task count.

## Checklist (spec acceptance items this data exercises)

- [ ] Fresh launch opens Calendar. The switcher and `g` swap the sidebar and main area; header height unchanged; centre reads "Goals & Projects · 8 goals · 24 projects".
- [ ] Sidebar order: File 2025 taxes (completed, faded) first, Migrate the blog (overdue, amber) next, then by target date; Learn piano (no date) last. Emergency fund is selected by default.
- [ ] Area filter: App Development → 4 rows; Home → none; No Defined Area → Learn piano only. Manage Areas lists four areas in order.
- [ ] Goal rows: GLANCEvault Pro launch shows the caution triangle (Launch marketing is stalled); Run a half marathon does not (`hideStalled`) although Base mileage qualifies.
- [ ] Learn piano: empty state "No projects linked to this goal yet" with + Add Project; the card still shows "0 projects + Add".
- [ ] GLANCEvault Pro: five cards, two completed ones compact underneath; connector lines follow when a card grows (expand tasks).
- [ ] Drag App Store Connect onto the Ship Electron Apps row; drag it back. Drag onto the dashed Standalone target; it appears on the Projects tab. "Move to…" on a card lists goals with the current one disabled.
- [ ] Projects tab: six rows with task counts (dayGLANCE 8, GitHub config 0); the grid shows Dead Money without count/progress (eyeball), Garage clear-out compact, and the missing-note warning on Dead Money.
- [ ] Task notes open from a card (e.g. "Create iOS screenshots") in the space; Escape closes the panel and stays in the space. Escape with nothing open does nothing; Escape closes Settings when Settings is open over the space.
- [ ] `n` opens the task editor in the space; arrows, `t`, `1`–`6` do nothing there and work again after `g`.
- [ ] Code signing card shows today's hyperGLANCE pill; starting and pausing it returns to the Goals space.
- [ ] Roadmap: bars grouped by area, GLANCEvault Pro spans the widest range, taxes ends in the past; clicking a bar opens the detail panel; sidebar click in Roadmap selects that goal's panel without switching to List.
- [ ] Calendar space after a round trip: scroll position kept, the goal rings in the GLANCE sidebar open the space with that goal selected.
- [ ] Archived (2) at the bottom lists Old 2024 side hustle and Retired: Etsy shop; Restore brings each back.
