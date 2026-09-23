// JOBO Plan-anchor facts. Public access is via core.js.

import { planBounds } from './internal/civilTime.js';

/**
 * Raw Original-Plan -> Final-Plan schedule deltas.
 *
 * Positive shifts mean the Final Plan moved later / became longer; negative
 * values mean earlier / shorter. This function reports facts only: it does not
 * infer why the plan changed or classify the change.
 */
export function comparePlanAnchors(originalPlan, finalPlan) {
  const original = planBounds(originalPlan);
  const final = planBounds(finalPlan);
  return {
    startShiftMinutes: final.start - original.start,
    finishShiftMinutes: final.end - original.end,
    durationDifferenceMinutes: finalPlan.duration - originalPlan.duration,
    durationRatio: finalPlan.duration / originalPlan.duration,
  };
}

