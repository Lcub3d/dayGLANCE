# JOBO Slice 5 acceptance

Based on #1726 and the UI follow-up on #1840. The full scaffold remains on
`reference/jobo-full-20260927`; this PR is the minimal shared-axis view.

## Native integration

- JOBO is available on narrow desktop and landscape tablet through the same
  registry, switcher and shortcut keys. Phones and portrait tablets are unchanged.
- Notes open the existing `NotesSubtasksPanel`, including formatted text,
  subtasks and linked Obsidian notes. There is no plain-text or daily-note column.
- The Do editor uses the desktop modal's Tailwind layout and theme tokens,
  a body portal, Escape/focus restoration and a keyboard focus loop.
- No JOBO-specific stylesheet is loaded. Inline styles encode time geometry only.

## Completion points and intervals

- Completing a native Plan still calls `toggleComplete`. Slice 4 captures its
  completion stamp. A completion stamp is a time point, not a measured interval.
- New and historical records without a measured interval appear as markers on
  the Do axis at `createdAt`'s own date/time prefix, including Z/offset stamps.
  There is no top strip or Timed/Untimed selector. Missing start/end data is not
  replaced with a planned start, zero minutes or a fabricated duration.
- Drag a marker to select an interval anchored at its time; release writes the
  explicit interval under the same id. A click, Escape or pointer cancellation
  does not write. Keyboard users can open the same interval fields with Enter.
- The editor pre-fills a completion point's end time from its stamp, leaving
  the actual start blank. Progress-only changes preserve the point; supplying a
  start/end changes it to a timed interval, without changing captured history.
- UTC and offset points remain at their source civil coordinates on all devices.
  Recurring occurrence identity is separate from the day the completion occurred.

## Persistence and review checks

- Committed `joboRecords` remains the only evidence input. Every Do edit goes
  through `recordJobo`; the view does not read the working set or own a retry queue.
- Manual Do ids are allocated once before writing and survive refused-write retry.
- Stale edits/tombstones are rejected. Held writes show pending until committed.
- Read failure is not an empty day. No Do recorded does not negate native completion.
- Cross-midnight intervals, point/interval overlaps, 1024/1280/1440px layouts,
  disabled/read-only actions and dark mode need both unit and browser checks.
- Day tiles remain a separate follow-up PR as agreed in #1726. Plan creation,
  copying/dragging/resizing, daily notes and independent Do notes remain deferred.
