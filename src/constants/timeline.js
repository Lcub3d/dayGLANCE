// The hour-label gutter down the left of every timeline view.
//
// The desktop timelines share one column: MULTI and DAY spell it as Tailwind's
// `w-16`, WEEK sets it inline because its header has to line up with it. The
// phone's timeline runs a narrower one. The numbers live here so anything that
// needs to CLEAR the gutter (the summary strip, which floats over it) or align
// to it (the week header) reads one value instead of re-deriving it from a
// utility class in a file it does not own.
//
// Changing either number means changing the matching class in the grid it
// belongs to: `w-16` in TimeGrid.jsx and DayView.jsx, `w-12` in MobileTimeGrid.
export const HOUR_GUTTER_W = 64; // px — MULTI, DAY, WEEK
export const MOBILE_HOUR_GUTTER_W = 48; // px — the phone's MobileTimeGrid
