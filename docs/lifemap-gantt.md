# LifeMap Gantt (Jobu)

This is a second view inside the existing LifeMap on `product/jobu`, not a new
planning collection or an upstream JOBO slice. Canvas remains the initial view.
The two views share the selected node, search, focused branch, task visibility,
inbox, existing node editor and dirty/stale-write guards.

## Use

Select **Gantt** beside **Canvas**. Ranges are 1, 3 or 6 months and 1, 2 or 5
years. Page the visible period, return to Today, or locate the dated plans.
The latter fits up to five years; longer histories remain available by paging.
Rows form a collapsible outline. A node with multiple parents appears once,
with the other parents named in its tooltip. Focus uses the existing branch
navigation. On narrow phones the inbox can be opened with its toolbar button;
only the chart scrolls horizontally, with the names and date scale kept visible.

Click a bar, milestone or row name to open the **existing node editor**. Its date
buttons use the app's `DatePicker`; selecting a date changes only the draft.
Save performs the same expected-head `patchLifeNode` transaction as other node
edits. Clear buttons explicitly remove a date. Reversed or invalid dates are
rejected, never swapped or silently repaired. Storage failure retains the draft;
a newer revision disables stale editing. Unsaved drafts are guarded when
switching views or nodes.

## Dates are not guessed

- A start and target date form a bar, including the target day.
- A target alone (or a same-day range) is a milestone. No creation-time fallback.
- A start alone is open-ended. A wholly undated node remains available in its
  existing canvas/inbox location and does not become an overdue or failed task.
- An undated parent's dashed range is a read-only summary of its displayed
  descendants. An open-ended child keeps the summary open-ended. Collapsing an
  outline does not change these bounds; filtering the graph can change them.
- Task rows read native dates only; a recurring template is not expanded into
  invented occurrences. Open a task through its existing native action.
- Progress reuses `calculateGoalProgress`/`calculateProjectProgress`, with the
  same task sources. No separate Gantt percentage is persisted.
- Dependencies/support links are not scheduling constraints. Editing one node
  never shifts its children, reschedules a task or changes recorded execution.

## One date owner per node

`readLifeSchedule` reads the existing goal/project facet when a native binding
exists. Notebook-only visions and stages derive their dates using `addDuration`
and cumulative `milestoneDate`, retaining the notebook's saved step order.
Those dates are read-only here; edit them in the notebook, not through a second
set of fields. A stage already linked to a native goal uses that goal's dates.

Free-form nodes may acquire `details.schedule.{startDate,targetDate}` through an
explicit save. These optional fields live on the same immutable `lifeNode`
revision. No existing records are rewritten on load, and no schema version or
new collection is introduced. When classification creates the first native
binding, its dates are **moved** into that facet. If another native binding is
later added, `details.schedule.owner` pins the original owner; it contains no
second copy of dates. The editor names that source. Binding IDs, history,
positions, hierarchy, support edges and opaque source fields remain intact.

The journal's existing whole-revision transport, export/restore and validation
carry these fields. Tests walk the file-tier merge and vault adapter into a
receiver, as well as explicit restore and reload. Existing native editor writes
remain visible without any Gantt cache or reconciliation pass.

## Native UI reuse and boundaries

`RoadmapBar` and `RoadmapGrid` in `components/goals/RoadmapChart.jsx` are extracted
from `GoalTimeline`, which still uses them with its original date/progress/group
logic. LifeMap supplies another data projection to the same presentation: native
colours, progress fills, labels, clipping and open-ended bars. Its layout CSS is
scoped to LifeMap; range labels, date formatting, icons, themes and date picker
are reused. All new copy lives in the ten existing locale bundles.

No new dependency, persistence writer, task action, automatic scheduler,
drag-to-reschedule, critical-path calculation or network service is included.
The common node editor is the intentional date-editing path, as clicking is
also the native roadmap's existing interaction.
