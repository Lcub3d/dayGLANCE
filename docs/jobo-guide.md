# dayGLANCE JOBO Guide

JOBO puts what you planned beside what you actually did. The **Plan** is your
day as you scheduled it. The **Do** is the work as it happened: when you
started, when you stopped, how far you got. JOBO keeps a record of each piece
of work, compares it with the plan, and at the end of the day helps you decide
what comes next for anything left unfinished.

This guide covers turning it on, recording work, reading the comparison, the
end-of-day Check, the statistics, and how it behaves on phones, tablets and
across devices.

---

## Turning it on

JOBO is **experimental and off by default**. With it off, nothing in the app
changes.

- **Desktop:** Settings → **Experimental** → **JOBO view**.
- **Phone:** Settings → **App Settings** → **JOBO view**.

The switch is per device, so turn it on wherever you want to use it. See
[Devices and sync](#devices-and-sync) for what that means for your records.

Once it is on, JOBO is a view like the others:

- **Desktop and landscape tablets:** the sixth view, on key **`6`** and in the
  view cycler.
- **Phones and tablets held upright:** a view in the timeline's view switcher.

---

## The basics

### Plan and Do

| | What it is | Where it comes from |
|---|---|---|
| **Plan** | A task's scheduled block | Your timeline, as you planned it |
| **Do** | One piece of work actually done | Recorded as you work: see below |

A **Do record** is either an interval (from 9:10 to 9:50) or, when only the
moment of completion is known, a point in time. Each has a **progress**:
Started, Partial, Mostly or Completed.

Two rules hold throughout:

- **A Do never changes your plan.** Recording work does not move, resize or
  complete the task.
- **A Do keeps what it recorded.** Its title and the plan it was measured
  against are captured when it is created, so renaming, moving or deleting the
  task later does not rewrite history.

### Where Do comes from

| Source | What is recorded |
|---|---|
| **Completing a task** | The moment you checked it off. Every way of completing counts: the checkbox in any view, a widget, voice, the MCP server, an Obsidian checkbox. A completion seen by two devices is recorded once. |
| **Adding it yourself** | Any interval, linked to a task or left as unplanned work. |
| **Focus sessions** | The time you actually worked, without pauses or breaks. See [Focus sessions](#focus-sessions). |

Unchecking a completed task keeps its Do and drops its progress to Partial.

---

## The JOBO view

On desktop the view has two columns on one hour axis:

- **Plan** on the left is your ordinary day timeline. Everything works as in
  DAY: drag, resize, click to add, the context menu, Frames and the task cards.
- **Do** on the right shows the recorded work, with the same NOW line.

Do cards are drawn with **stripes in the task's colour**, so a record never
passes for a plan block. Work with no task is drawn in purple. Each card shows
its interval and progress, and how it compared with the plan: for example
"Started 10 min late · Finished 20 min late · On estimate". Hovering a card
highlights its counterpart on the other side.

Above the columns:

- **The date row** shows the day's figures: Scheduled tasks, Recorded time,
  Late starts, Late finishes and Ran long. Hover a figure for exactly what it
  counts. The chart button at the end opens the full
  [statistics](#statistics).
- **The Plan / Do row** has **Check** (the [end-of-day review](#the-check)),
  **Add Do**, and **Notes** for a notes sidebar with the Daily Note and the
  selected task's notes.

### Recording and editing work

- **Add:** click an empty spot in the Do column to add a 30-minute Do there,
  or use **Add Do**. In the editor, type to find a task to link it to, or
  leave it unlinked as unplanned work.
- **Move and resize:** drag a Do card, or drag its bottom edge. Times snap to
  15 minutes, as everywhere in the app.
- **Edit:** the pencil on a card opens the editor: title, date, start, end and
  progress, with Delete.
- **Another session:** the **+** on an unfinished Do logs another session of
  the same task.
- **Undo and redo:** `Ctrl/Cmd + Z` and `Ctrl/Cmd + Shift + Z`, as for any
  other change.

### Completion moments

Checking a task off records *when*, not *how long*. It appears on the Do side
as a marker at that time. To record the actual work, drag the marker into an
interval, or press `Enter` on it and type the start and end.

When the task had a planned duration, JOBO may draw an **estimate** ending at
the completion, with a dashed outline. An estimate is a guess, not a
measurement: it is left out of recorded time and exact comparisons until you
choose **Keep as shown** or set the times yourself.

### Completed, and completing the task

A Do linked to a task cannot be marked **Completed** on its own: whether the
task is finished is the task's own checkbox. The editor offers **Complete
task**, which checks the task off exactly as its checkbox does, and the
completion is recorded as a Do of its own. Unlinked work can be marked
Completed directly.

### Make a task

Unplanned work sometimes turns out to need a task of its own. An unlinked Do
that is not marked Completed offers **Make a task**, in the editor and in the
Check. It opens the new-task form for the Inbox with the Do's title and tags.
Saving creates the task and links the Do to it, so the Do takes the task's
colour and its Check entry offers the task's next step. The Do still counts as
unplanned work, since it had no plan when it happened.

---

## Focus sessions

With JOBO on, [Focus Mode](../README.md#focus-mode) records the time you
actually work as Do:

- **Only work counts.** Pausing closes a session and resuming opens a new one.
  Breaks never count.
- **One task in the block:** each work phase is recorded automatically as
  Partial when it ends or is skipped, and the break starts as usual.
- **Several tasks, or leaving Focus early:** a short review asks which task
  you worked on and offers **Task completed**, **Still in progress** or
  **Don't record**.
- **Times are rounded to the minute**, so the recorded total can differ
  slightly from the timer.

**Task completed** saves the work first, then checks the task off. If a save
fails, the review stays open and says so, and nothing is completed until the
work is saved.

---

## The Check

**Check** is the end-of-day review: a journal of the day, one entry per piece
of work, each with its plan against what actually happened, its sessions,
progress and timing, and a link to the task's notes.

At the top, a line says how many tasks from the day still need a next step, or
that every one has one.

### The next step for each entry

Each entry offers one action, chosen by the task's state now:

| The task now | Offers | What it does |
|---|---|---|
| Unfinished, still on that day | **Continue** | Moves the task to tomorrow at its planned time, with what is left of the plan (rounded up to 15 minutes). |
| Finished | **Add follow-up** | Opens the new-task form with the task's project, tags and colour. The follow-up starts unscheduled. |
| In the Inbox or a project's list, with work recorded | **Schedule…** | Opens the task editor on tomorrow, since there is no planned time to carry. |
| Unlinked work | **Make a task** | See [Make a task](#make-a-task). |
| Already moved to another day | **Next: Fri 9:00** | Nothing to do: it has been continued already. |
| A recurring occurrence, or a deleted task | Nothing | The next occurrence carries the work on. |

"Tomorrow" means the day after today, not after the day you are reviewing: a
Monday reviewed on Wednesday continues on Thursday. If the slot clashes with
a calendar event, Continue says so and moves nothing.

### Not started

Below the journal, **Not started** lists the tasks planned for the day that
ended with nothing recorded and are not completed. Each offers:

- **Continue**, to tomorrow at its planned time with its full duration;
- **Move to Inbox**, or **Move to its project** when it has one;
- **Delete**, to the Recycle Bin.

Continue and the Not started actions can be undone from the entry itself, and
each is one step of the app's normal undo history. A follow-up or a task made
from a Do is undone like any new task. The Check never edits your Do records.

---

## Statistics

The figures in the date row describe the day. The chart button opens **JOBO
statistics**, with **Day**, **Week**, **Month** and **All time** tabs:

| Section | What it shows |
|---|---|
| **Overview** | Scheduled tasks completed, recorded time, tasks with no Do recorded, and how many could be compared with their plan. |
| **Plan vs actual** | Late starts, late finishes, ran long and within plan, out of the tasks that could be compared. |
| **Execution** | Do records, and how many tasks were done in a single session or split across several. |
| **Plan changes** | How often a task's plan changed between when it was first planned and when the work was done: its start, finish or duration. |
| **Priority** | Completion, recorded time and comparisons by priority. |

How the numbers are counted:

- **Recorded time** is measured intervals only. Overlapping records count once.
  Estimates and completion moments without times are not included.
- **A task done over several sessions or days counts once** in the
  comparisons.
- **Missed recurring occurrences** on past days are not counted: only
  occurrences that were completed, changed, or have work recorded.

---

## Past days in the other views

With JOBO on, the other views show what was done as well as what was planned:

- **DAY, MULTI and WEEK:** on past days, and today up to the NOW line,
  recorded work appears as striped cards at the times it happened. A completed
  task's plan block gives way to its Do once its planned time is over. An
  unfinished task keeps its plan block beside its Do, so what is still owed
  stays in sight.
- **MONTH:** a day's bars follow the recorded work.
- **SCHED:** a task card carries a striped **Do** badge with the time recorded
  that day.

Clicking a recorded card shows the interval and **Open in JOBO**, which opens
JOBO at that time, where it can be edited. Only measured times appear outside
JOBO: estimates and comparisons stay inside it.

---

## On the phone

The phone shows Plan and Do side by side on the timeline, sharing the width:

- **One side is wide**, with full cards. The other is a **narrow lane of
  bars** at the same times.
- **To swap,** tap the narrow lane or the **⇄** button on the divider. Tapping
  a bar swaps and highlights that item.
- **Plan opens wide** for today and later, **Do** for past days.
- **Tap a card** to highlight its counterpart on the other side.

The date header adds JOBO's buttons:

- **Side by side** shows Plan and Do at half width each, both as cards, for
  comparing. Your choice is remembered on the device.
- **Check** and **Statistics** open as sheets, with the same content as on
  desktop.
- **Add Do** adds a Do.

To record work, tap an empty spot on the wide Do side, or tap a Do card to
edit it in a sheet. Each change shows a toast with **Undo**. Do cards cannot be
dragged on the phone, so set exact times in the editor.

**Tablets:** held upright, a tablet uses the phone's layout. In landscape it
shows the desktop view.

---

## Devices and sync

- **Do records sync with the rest of your data,** on every sync method.
  Backups include them.
- **The switch is per device, the records are not.** A device with JOBO off
  still keeps, syncs and merges everyone's records; nothing is lost by turning
  it off.
- **Records are created by devices with JOBO on.** Completing a task on a
  device with JOBO off records no Do, and turning JOBO on later does not create
  records for earlier completions. Turn it on on every device where you
  complete tasks.
- **Shared households:** with multi-user on, JOBO shows only the work visible
  to you, as the rest of the app does.

---

## Good to know

- **Deleting a task keeps its Do records,** under the title they recorded.
- **Editing a task does not change the work already recorded** against it.
- **JOBO's own Plan column always shows the plan,** even on past days: the
  recorded work is on its Do side.
- **LIST** shows the plan only.
