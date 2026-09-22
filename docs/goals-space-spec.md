# Goals & Projects as a first-class space (desktop + tablet)

**Status:** Ready to implement
**Mockup:** `docs/goals-space-mockup.html` (see "Reading the mockup" below)
**Code references:** line numbers are as of commit `3065394` on `main`; they may drift.

## Summary

Today, Goals & Projects is a modal (`GoalDashboard`, opened via `showGoalsDashboard`) that floats over the calendar. This change makes it a **space**: a top-level mode, like Mail/Calendar in Outlook. A small switcher in the header swaps the **left sidebar and the main area** between the Calendar space (unchanged) and a new Goals & Projects space. The header row, its height and its right-hand icon cluster stay the same in both.

The phone layout already works this way (`mobileActiveTab === 'goals'`) and **does not change**.

## Scope

- **In:** `DesktopLayout` (desktop and `isTablet` variants), `DesktopHeader`, the tablet header inside `DesktopLayout`, `GoalDashboard` (a new desktop-inline rendering), keyboard shortcuts, and the callers that open the dashboard today.
- **Out:** `MobileLayout` / `MobileTabBar`, the data model, `GoalTimeline` internals, `ProjectCard` visuals (reuse as-is), `ProjectPlanner`, sync.
- **Remove:** the desktop modal presentation of `GoalDashboard` (backdrop, `max-w-6xl` panel, X button). Nothing on desktop should open it as a modal any more.

## Decisions

| # | Decision |
|---|---|
| D1 | The switcher is a two-button segmented control (calendar icon / target icon), side by side, at the **far left of the header row**, before the widget card. Buttons are about 36×32px with 16px icons. |
| D2 | The **`g` key toggles** between the two spaces. It must work *while in* the Goals space. Today `g` is suppressed while `showGoalsDashboard` is true (`useKeyboardShortcuts.js:119`). No Cmd/Ctrl+1/2: browsers take those in the web build. Switcher tooltips read "Calendar · G toggles" and "Goals & Projects · G toggles". |
| D3 | The app **always launches in the Calendar space**. Do not persist the active space. (The area filter and List/Roadmap already persist in localStorage; keep that.) |
| D4 | Anything that opens Goals today (GlanceSidebar goal ring click, GlanceFabs pill, future-session click, `g`) **switches to the Goals space**. If a goal id is supplied (`goalsDashboardFocusId`), that goal is selected. |
| D5 | Starting **hyperGLANCE** from the Goals space does **not** change space. hyperGLANCE is already a full-screen overlay (`showHyperGlanceMode`). When the session is paused or finished, the user is back where they started. |
| D6 | **The sidebar replaces the carousel.** Goals are listed in the sidebar; the selected one shows in the main area. Remove the carousel arrows, dots and prev/next mini cards from the desktop inline view. |
| D7 | Sidebar has two tabs: **Goals** and **Projects**. Projects lists **standalone projects only**. Goal-linked projects are reached through their goal. |
| D8 | The **area filter and Manage Areas appear only on the Goals tab**, because only goals have areas (`useGoalsProjects.js:17–18`). |
| D9 | **List / Roadmap appears only on the Goals tab**, because only goals have target dates. |
| D10 | **Add Area and Add Goal appear only on the Goals tab.** Add Project appears on both tabs. |
| D11 | Escape **never leaves the space**. It only closes whatever is open inside it (notes panel, task editor, PLANNER, forms), keeping the existing priority chain. |

## Layout

### Header (both spaces)

- **Left:** the switcher (D1), then the existing widget card.
- **Centre:**
  - Calendar space: the existing date navigation, unchanged.
  - Goals space: the text "Goals & Projects" plus a muted count, for example "3 goals · 12 projects". No date navigation.
- **Right:** the icon cluster, unchanged.
- Add the switcher to **both** `DesktopHeader.jsx` and the tablet header written inline in `DesktopLayout.jsx:514–709`.
- In Electron the header may sit inside a drag region. The switcher needs `-webkit-app-region: no-drag`.

### Calendar space

Unchanged. That includes the in-grid `SummaryStrip`.

### Goals space: sidebar

The sidebar is the same width and position as the calendar sidebar (340px today).

- **Tab row:** "Goals N" and "Projects N", styled like the GLANCE/inbox tabs.
- **Goals tab:**
  - A top row with the area `<select>` ("All areas" plus the areas) and an icon button for Manage Areas (it opens the existing `ManageAreas` UI).
  - A list of goals, in the same set and order the carousel uses today (`sortGoalsForCarousel`). Each row shows:
    - a 3px bar in the goal colour
    - the goal title, truncated
    - the area dot, area name and days left
    - a thin progress bar with the percentage
  - The selected row is highlighted. The initial selection is `findDefaultActiveIdx`, or `goalsDashboardFocusId` when that is set.
  - The area filter filters this list.
  - **Goal rows are drop targets for reassigning projects.** This replaces dropping on the carousel's mini cards. The existing "Move to…" button on project cards (`onMoveToClick`) keeps working.
- **Projects tab:** a list of standalone projects, each with a colour dot, title and task count. No area filter.
- **Footer:** "Add Goal" on the Goals tab, "Add Project" on the Projects tab.

### Goals space: main area

- **Toolbar row:**
  - List | Roadmap segmented control on the left (Goals tab only, D9).
  - Add Area / Add Goal / Add Project on the right (D10).
- **Goals tab, List view:**
  - The selected goal's card, centred: the existing `GoalCard` look, with a white title, white/70 icons, area, days left, progress, and "N projects + Add" with the percentage.
  - The dashed connector lines, then that goal's project cards in a row, using the existing `ProjectCard`.
  - If the goal has no projects, show an empty state: "No projects linked to this goal yet" with "+ Add Project".
- **Goals tab, Roadmap view:** the existing `GoalTimeline`, filtered by area as today. Sidebar selection does not switch the view.
- **Projects tab:** a grid of standalone `ProjectCard`s, the same as the "Standalone projects" section of today's modal.
- The main area scrolls on its own; the sidebar and header stay fixed.

## Implementation notes

What exists today, and what needs to change.

### 1. State

- Add an independent desktop space state, for example `desktopSpace: 'calendar' | 'goals'` (session only, D3). Do **not** reuse `viewMode`: it is width-gated and tied to the default view and `?view=`.
- Decide whether `showGoalsDashboard` becomes a derived alias (`desktopSpace === 'goals'`) or is replaced. An alias keeps the existing callers (`GlanceFabs.jsx:75`, `GlanceSidebar.jsx:443`, `GlanceSidebar.jsx:1278`, `useKeyboardShortcuts.js:279`) working with little churn. Either way, every call that "opens the dashboard" must mean "switch to the Goals space".

### 2. Layout

- `DesktopLayout.jsx` renders the sidebar (desktop at 770–819, tablet at 717–767) and the calendar area (822–878) as sibling blocks in one flex row. Wrap both in the space condition.
- For the calendar area, prefer **keeping it mounted and hidden** over unmounting, so scroll position and `calendarRef` survive a switch. This matches how `MobileLayout.jsx:1132` keeps `GoalDashboard` mounted.

### 3. `GoalDashboard` desktop-inline mode

- `embedded` mode (the branch starting at 2456) currently renders **`MobileDashboard`** and mobile forms. The desktop space needs a desktop inline rendering: either a third mode or `embedded` + `!isMobile`.
- That rendering uses `ProjectCard`, the connector lines and `GoalTimeline`, but none of the carousel UI (D6).
- Its forms should use the desktop form presentation, not the mobile one.
- The Add buttons move out of the component, as in embedded mode today (trigger props at 2302–2305). The desktop toolbar owns them.

### 4. Keyboard

- **Escape handler (`GoalDashboard.jsx:2447`, capture phase, `stopImmediatePropagation`):**
  - In the inline mode it must never close the space (D11).
  - It must be **inert when the Goals space isn't active**; today it ignores `isActive`.
- **Arrow-key handler (`GoalDashboard.jsx:967`):** belongs to the carousel. Remove it with the carousel. If kept for any reason, gate it on the space being active: otherwise it fights the global date navigation (`useKeyboardShortcuts.js:333–353`).
- **Global shortcuts (`useKeyboardShortcuts.js:119`):** `showGoalsDashboard` is in the "modal open, block everything" list. In the Goals space:
  - `g` must work (D2), as must `?`, Cmd/Ctrl+K, and `n` (new task).
  - Calendar-only shortcuts (arrows, `1`–`6` views, today, and similar) should do nothing. Enumerate them rather than blocking everything.
- **`g` handler (`useKeyboardShortcuts.js:273–281`):** change it from "open" to "toggle". Keep the auto-enable-on-first-use behaviour.

### 5. Other `showGoalsDashboard` checks

- `ProjectCard.jsx:751`: the notes/subtasks portal renders only when `isMobile ? mobileActiveTab === 'goals' : showGoalsDashboard`. **Task notes will break** unless this condition matches the new space.
- Search for any other reads of `showGoalsDashboard` and give each one the new meaning.

### 6. Unchanged, but check

- `ProjectPlanner` (`App.jsx`, `fixed inset-0 z-[70]`) and the task editor mount at App level, so they work with the calendar hidden.
- The connector lines are measured from card refs with a ResizeObserver. They should work inline, but check them when the sidebar selection changes.
- The macOS titlebar strip (`TitlebarSummaryStrip`, `DesktopLayout.jsx:506`) is window chrome. Leave it visible in both spaces.

## Acceptance checklist

- [ ] Switcher shows in the desktop header and the tablet header; clicking it swaps the sidebar and main area; header height is unchanged.
- [ ] `g` toggles the spaces from either one, including while in Goals.
- [ ] Fresh launch always opens the Calendar space.
- [ ] Clicking a goal ring in the calendar sidebar opens the Goals space with that goal selected.
- [ ] Area filter and Manage Areas show only on the Goals tab. List/Roadmap, Add Area and Add Goal show only on the Goals tab.
- [ ] Projects tab shows standalone projects only.
- [ ] Dragging a project onto a sidebar goal row reassigns it. "Move to…" still works.
- [ ] Task notes open from project cards in the Goals space (`ProjectCard.jsx:751`).
- [ ] Escape closes inner panels but never leaves the space. In the Calendar space, Escape behaves exactly as before, with nothing swallowed.
- [ ] Arrow keys in the Calendar space change dates after visiting Goals.
- [ ] Starting hyperGLANCE from a project card leaves you in the Goals space when the session is paused or finished.
- [ ] Calendar scroll position is kept across a round trip.
- [ ] Phone layout is unchanged.
- [ ] No desktop code path opens the old modal.

## Reading the mockup

`goals-space-mockup.html` is exported from a design canvas. It is **not production code** and won't render on its own; it needs the canvas runtime (`support.js`).

- **The markup** inside `<x-dc>` is the layout, with exact inline styles: sizes, colours, spacing.
- **The script at the bottom** holds the sample data and the interaction model: space, tab and selected goal.
- **Visual source of truth:** where the mockup and existing components differ, reuse the existing components (`GoalCard`, `ProjectCard`, the GLANCE/inbox tab styles). The mockup's cards were built to match them.
- **Placeholders:** the goal named "[Third goal]" and the "[Area]" option are placeholders. The Ship Electron Apps goal shows the empty state only because its projects weren't known when the mockup was made.
