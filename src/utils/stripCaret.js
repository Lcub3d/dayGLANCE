// Where the desktop summary strip's caret sits in the hour gutter (#2118).
//
// The caret belongs at the gutter's RIGHT edge, beside the pill row it folds
// away, so it reads as part of the strip rather than as a gutter control. It
// moves only when something already lives at that spot: WEEK hangs its
// end-hour toggle at the foot of the gutter whenever the band is trimmed, and
// with short rows the last row's hour label sits low enough to meet it. Those
// are marked `data-gutter-foot` where they render, and the strip measures them
// instead of assuming them, so a WEEK with nothing at its foot keeps the caret
// where every other view has it.

export const CARET_W = 20;
export const CARET_H = 26;
// Matches the pill row's pb-2, so the caret and the pills share one line.
const BASE_BOTTOM = 8;
// Clears WEEK's end-hour toggle (bottom-0.5, 10px type) with a little air.
const LIFTED_BOTTOM = 16;
const EDGE_GAP = 6;

/**
 * The spots to try, best first: right of the gutter, then lifted, then the
 * gutter's left edge (WEEK right-aligns its labels, so that side is free).
 *
 * @param gutterW Hour gutter width in px.
 * @returns {{ left: number, bottom: number }[]} offsets within the strip's box
 */
export function caretSpots(gutterW) {
  const right = gutterW - CARET_W - EDGE_GAP;
  return [
    { left: right, bottom: BASE_BOTTOM },
    { left: right, bottom: LIFTED_BOTTOM },
    { left: EDGE_GAP, bottom: BASE_BOTTOM },
    { left: EDGE_GAP, bottom: LIFTED_BOTTOM },
  ];
}

const overlaps = (a, b, pad) => (
  a.left < b.right + pad && a.right + pad > b.left
  && a.top < b.bottom + pad && a.bottom + pad > b.top
);

/**
 * First spot that clears every mark. If none does, the last one: the gutter's
 * left edge, lifted, is the spot least likely to meet anything.
 *
 * @param spots  From caretSpots, best first.
 * @param box    The strip container's client rect.
 * @param marks  Client rects of the `data-gutter-foot` elements. Empty
 *               (zero-size) rects are ignored: an element that is not laid out
 *               cannot be covered.
 * @param pad    Minimum clearance in px.
 */
export function pickCaretSpot(spots, box, marks, pad = 1) {
  const solid = marks.filter((m) => m.right > m.left && m.bottom > m.top);
  for (const spot of spots) {
    const left = box.left + spot.left;
    const bottom = box.bottom - spot.bottom;
    const rect = { left, right: left + CARET_W, top: bottom - CARET_H, bottom };
    if (!solid.some((m) => overlaps(rect, m, pad))) return spot;
  }
  return spots[spots.length - 1];
}
