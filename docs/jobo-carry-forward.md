# JOBO slice 7: Continue and Add follow-up

Design note for the rest of slice 7 of #1726: Carry Forward and successor
tasks (#1714). The direction was agreed with Lcub3d on #1726; this note
settles the details that touch how tasks behave. The decisions are pure
helpers in `src/jobo/carryForward.js`; the buttons are not built yet.

## The rule

Each Check entry offers one action, picked by the state of its task now:

| The task now | The entry offers |
|---|---|
| Not completed | **Continue**: another block of the same work |
| Completed | **Add follow-up**: a new task that grew out of this one |

This follows Lcub3d's point on #1714: continuing unfinished work belongs in
the daily Check, while a successor belongs to one finished task. Each journal
entry is both, so the user never has to decide which kind of transition they
mean.

It is the task's state that decides, not the latest Do's progress. A task
whose last session was Partial but which was checked off later is finished,
and offers Add follow-up.

These are the Check's first actions that change anything. They change tasks
only, through the app's existing task actions. The Check stays read-only
towards the ledger: no Do record is written, edited or deleted.

## Continue

**It moves the same task.** Option 1 from #1726, agreed there. Since slice 6,
a past day shows the Do recorded on it, so moving the task to tomorrow no
longer erases what was done today. The work stays one task, with one history
in the ledger, and every session's Do card stays linked to it.

**It is one click, with an undo toast.** People read the Check at the end of
the day, so the click should leave nothing to fill in:

- **When:** tomorrow, meaning the day after today, not the day after the
  entry's date. A Monday reviewed on Wednesday continues on Thursday, not on
  Tuesday. Today's own Check offers it too, for the end-of-day read.
- **What time:** the task's planned start time.
- **How long:** what is left of the plan. That is the planned duration minus
  the time recorded against it, rounded up to 15 minutes. If nothing is
  measured, or the work already ran over, it keeps its planned duration.
  Measured means timed Do only, using the same coverage the stats header
  counts, over the entry's own sessions. An all-day task stays all-day.
- **Afterwards:** a toast reads "Continued to Fri 9:00 · Undo", and the entry
  shows the new slot. Changing the slot, or anything else, is the usual edit
  on the task.

If the slot clashes with an imported calendar event, Continue does what
Postpone does: it says so and moves nothing. The entry then offers "Edit",
which opens the task editor on tomorrow so a time can be picked.

**Plan history.** Continue moves a task that has already come due, so the
existing rules apply to it unchanged:

- `planTrail` records the move. Hovering the task's plan history shows it was
  planned for Monday and continued to Thursday.
- `deferrals` counts it. Proposed: keep that. A continued task did slip from
  its plan, which is what the count measures, and the Do records already show
  how much of the work was done. Exempting continuations would need a marker
  the persist pass can see, which means a new task field through all four
  subsystems in CLAUDE.md. That is not worth it for a label. `originalPlan` is
  never touched.

### The cases Continue does not cover

| Entry | What it offers |
|---|---|
| A recurring occurrence | Nothing. The next occurrence continues the work, and moving one occurrence is a series exception, not a continuation. |
| A task already moved off the entry's day | "Next: Fri 9:00", with no button. It has been continued already, by hand or from another device. Only the day the task sits on offers Continue, so the time left is that day's. |
| An unscheduled task (Inbox or a project's list) that has Do recorded | "Schedule…", which opens the editor on tomorrow, because there is no planned time to carry. |
| An unlinked Do | Nothing for now. "Make a task" may follow later. |
| A task since deleted or archived | Nothing. |

## Add follow-up

**It opens the normal new-task form, pre-filled from the finished task:**

- its project, and with it the goal;
- its tags, put into the title after the cursor so typing goes before them;
- its colour.

Not its time, notes, subtasks or priority. Those belong to the finished work.

**The follow-up starts unscheduled:**

- with a project, in the project's Unscheduled list, where the PLANNER plans
  the rest of that project's work;
- without one, in the Inbox.

The form can still set a day before saving. This changes one point from the
proposal on #1726, which defaulted both actions to a later day. Unscheduled
fits better for follow-ups, which are usually discovered rather than ready to
book.

**The Project is the link.** There is no new task field and no drawn chain.
"How many tasks did this project take?" is answered by the project itself. A
task with no project carries only its tags and colour.

## Undo

- **Continue** goes through the task actions, so it is one step in the app's
  undo history, like Postpone.
- **Add follow-up** creates a task through the new-task form, so it is undone
  like any new task.

Neither touches the ledger, so Do undo is unaffected.

## What stays as it is

- **The ledger, core, detector and `viewModel.js`.** The Check reads the day
  model as it does now. The actions write tasks.
- **No new task field.** Continue changes `date`, `startTime` and `duration`
  through the ordinary task update. Follow-up creates an ordinary task.
- **Multi-user.** The Check already lists only work visible to the current
  user (#1877), so neither action can reach another member's task.
- **Other views.** These actions live in the Check only, as agreed for slice 6.

## Decisions to confirm

1. **Continue is one click to tomorrow at the planned time, with the
   remaining duration**, and an undo toast. The alternative is opening the
   editor every time, which adds a step to every continuation.
2. **A continuation counts as a deferral.** This needs no new mechanism. The
   alternative needs a new task field.
3. **Follow-ups start unscheduled**, in the project's list or the Inbox.
4. **Recurring occurrences offer nothing.**

## Build order

1. **Pure helpers, with tests:**
   - the entry's action (continue, follow-up, already moved, schedule, none);
   - the remaining duration;
   - the follow-up's pre-fill.

   Covering: each row of the cases table; tomorrow measured from today, not
   from the entry's date; remaining time rounded up to 15 minutes; overrun and
   unmeasured sessions keeping the plan; tags and project carried, time and
   notes not.
2. **The buttons in `CheckPanel`**, wired through JOBO's existing context
   actions, with the undo toast, the clash message and strings in all ten
   locales.
3. **A browser check** on a seeded day:
   - a partial task continued;
   - a completed task followed up;
   - a recurring occurrence and an already-moved task left alone;
   - undo of the continuation.
