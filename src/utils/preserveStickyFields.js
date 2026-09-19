// Carry "sticky" app-only task fields across a sync/merge apply.
//
// The merge keeps the newer copy WHOLE. So a field that some devices carry and
// others do not is dropped whenever a copy without it happens to win: not because
// anyone changed it, but because the winning device never had it to send. Each
// field below is one this has actually cost us, and the rule for each differs.
//
// `archived` is a dayGLANCE-local flag. An incoming copy that OMITS it (value is
// `undefined`) falls back to the current in-memory value; applying the copy as-is
// would silently un-archive the item AND, because it differs from the healed
// in-memory state, re-stamp `lastModified` on every sync, which is an endless
// push/strip churn. A genuine remote unarchive sends `archived: false`
// EXPLICITLY, which is not `undefined`, so it is left alone and still propagates.
//
// `originalPlan` (utils/originalPlan.js) is the schedule a task was first given.
// It is write-once and nothing in the app can clear it, so an absent value can
// only ever mean "this device never had it". Losing it is not corruption —
// nothing else depends on the field — but it is unrecoverable, and a baseline
// that survives only until the first merge from an older device is not a baseline.
//
// `starredDate` (utils/starredTasks.js) marks a task as one of today's few.
// Unstarring writes an explicit `null` precisely so this rule can tell the two
// cases apart: `null` is a real unstar and propagates, absent means the winning
// device predates the field and the local value stands.
//
// All three share one rule — carry forward when the incoming copy's value is
// `undefined`, honour any explicit value — so they are listed rather than
// written out three times. A fourth sticky field belongs in STICKY_FIELDS and
// nowhere else in this file.
//
// Items are matched by id. Fields are handled independently: a task can be
// missing one and carry another.
import { mergeDeferrals } from './deferrals.js';
import { mergePlanTrail, sameTrail } from './planTrail.js';

export const STICKY_FIELDS = ['archived', 'originalPlan', 'starredDate'];
//
// @param {object[]} incoming  the merged/remote tasks about to be applied
// @param {object[]} existing  the current in-memory tasks (source of the values)
// @returns {object[]} incoming with the sticky fields back-filled where absent
export function preserveStickyFields(incoming, existing) {
  const local = new Map(
    (existing || []).filter(Boolean).map((t) => [String(t.id), t]),
  );
  return (incoming || []).map((t) => {
    if (!t) return t;
    const prev = local.get(String(t.id));
    if (!prev) return t;
    let out = t;
    for (const field of STICKY_FIELDS) {
      if (out[field] === undefined && prev[field] !== undefined) {
        out = { ...out, [field]: prev[field] };
      }
    }
    // `deferrals` is not in that list because its rule is different: a monotonic
    // count merges by taking the higher value, which subsumes carrying an absent
    // one and also protects a local count the incoming copy has fallen behind.
    const count = mergeDeferrals(out.deferrals, prev.deferrals);
    if (count !== out.deferrals) out = { ...out, deferrals: count };
    // `planTrail` is that same rule in list form: a union, which subsumes the
    // carry and also recovers stops the incoming copy has fallen behind on.
    const trail = mergePlanTrail(out.planTrail, prev.planTrail);
    if (!sameTrail(trail, out.planTrail)) out = { ...out, planTrail: trail };
    return out;
  });
}
