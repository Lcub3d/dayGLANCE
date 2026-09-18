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
// Its rule is simpler than archived's, because the field is write-once and
// nothing in the app can ever clear it: an absent value on the incoming copy can
// ONLY mean "this device never had it", never "the user removed it". So it is
// carried forward unconditionally, with no explicit-value escape hatch. Losing it
// is not corruption — nothing reads the field yet — but it is unrecoverable, and
// a baseline that survives only until the first merge from an older device is not
// a baseline at all.
//
// Items are matched by id. Fields are handled independently: a task can be
// missing one and carry the other.
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
    if (out.archived === undefined && prev.archived !== undefined) {
      out = { ...out, archived: prev.archived };
    }
    if (out.originalPlan === undefined && prev.originalPlan !== undefined) {
      out = { ...out, originalPlan: prev.originalPlan };
    }
    return out;
  });
}
