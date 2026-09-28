# JOBO header statistics

Follow-up to #1726, separate from the completion fix and slice 7 Check.
The header consumes the existing `buildJoboDayModel` result before display-only
completion estimates and drag previews. Nothing is stored or written.

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

The scope line and tooltips expose denominators and unmeasured records. START to
END trims drawing only; the headline numbers still describe the whole day.
The existing shared grid, start/end control, Add Do and notes toggle stay intact.
Pills reuse `summaryPillClass` from DAY's SummaryStrip and `formatDuration`.
They wrap at narrow widths in light/dark themes. No new modal, preference, task
handler, timeline gesture, Check journal, storage schema or sync rule is included.
