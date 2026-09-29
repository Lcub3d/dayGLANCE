# JOBO header statistics

Follow-up to #1726, separate from the completion fix and slice 7 Check.
`CalendarHeader` renders the tiles beside the selected date, in the same row,
using MONTH's label-over-value treatment. No extra timeline row is added.

The header reuses `buildJoboDayModel` with the view's task/occurrence inputs and
committed records, then aggregates that result. It does not use display-only
completion estimates or drag previews. Nothing is stored or written, and an
unloaded/unreadable ledger does not render empty-day figures.

- Scheduled tasks: completed / all CURRENT, timed native task checkboxes, not Do
  progress. Read-only imported calendar entries and archived tasks are excluded.
- Recorded time: union of committed measured Do intervals clipped to the selected
  civil day. Overlap counts once. Untimed and inferred intervals are excluded;
  no measurements is unknown, not zero activity. This is not an actual/plan ratio.
- Late starts, late finishes and longer duration: separate counts over fully
  comparable captured Plan groups dated that day. A group counts once and uses
  all its attempts, including those recorded later. Mixed/inferred groups are
  excluded, not presented as complete comparisons. Malformed ledger data makes
  recorded/comparison totals unavailable rather than asserting complete totals.

Tooltips carry the full-day scope, denominators and unmeasured records, as
MONTH's dense header does for its side notes. START to END trims drawing only;
the numbers still describe the whole day. Tiles use Tailwind, existing theme
and duration-formatting tokens, and scroll within a narrow header cell rather
than wrapping to another row. The native date actions, Plan/Do grid, start/end
control, Add Do and notes toggle are unchanged. No new modal, preference, task
handler, timeline gesture, Check journal, storage schema or sync rule is included.
