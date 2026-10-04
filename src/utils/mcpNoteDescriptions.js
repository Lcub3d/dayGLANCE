// The MCP as one more editor over a linked note's description section
// (owner, 2026-10-04). A goal or project linked to an Obsidian note keeps
// its description in the note's opening section (companion spec §4.3,
// 2026-10-03), not on the record. The MCP server runs only in the desktop
// app, which can read and write vault files itself, so the MCP reads the
// section through the same loader the planner uses and writes it through
// the same save, which re-reads the note first and refuses when it changed
// since the text was read. No copy, no cache, no second home for the text.
//
// Pure orchestration with the note functions injected (the hook passes the
// sync hook's loadNoteDescription and saveNoteDescription), so every rule
// here is testable without React or a vault.

import { noteLinkOf } from './obsidianProjectNotes.js';

/** How many linked entities one goal-tree read will open notes for, and how long it may take in all. */
export const DESCRIPTION_READ_CAP = 40;
export const DESCRIPTION_READ_BUDGET_MS = 2000;

const withTimeout = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(undefined), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(undefined); });
});

/**
 * Fill `description` on every linked goal and project in a goal_progress
 * result from the note itself, marking the source and carrying the
 * section's hash as `description_base` for a later refuse-on-change write.
 * An entity whose note cannot be read on this device keeps the pointer it
 * already carries. Mutates nothing: returns a new data object.
 */
export async function enrichGoalTreeDescriptions(data, { loadNoteDescription } = {}) {
  if (!data || typeof loadNoteDescription !== 'function') return data;
  const targets = [];
  const goals = (data.goals ?? []).map((g) => ({ ...g, projects: (g.projects ?? []).map((p) => ({ ...p })) }));
  const standalone = (data.standalone_projects ?? []).map((p) => ({ ...p }));
  for (const g of goals) {
    if (g.obsidian_note && !g.obsidian_note.missing) targets.push(g);
    for (const p of g.projects) if (p.obsidian_note && !p.obsidian_note.missing) targets.push(p);
  }
  for (const p of standalone) if (p.obsidian_note && !p.obsidian_note.missing) targets.push(p);
  if (targets.length === 0) return { ...data, goals, standalone_projects: standalone };
  const chosen = targets.slice(0, DESCRIPTION_READ_CAP);
  const reads = chosen.map((entity) => withTimeout(
    Promise.resolve().then(() => loadNoteDescription(entity.obsidian_note.path)),
    DESCRIPTION_READ_BUDGET_MS,
  ));
  const results = await Promise.all(reads);
  results.forEach((r, i) => {
    if (!r || r.notFound || typeof r.text !== 'string') return;
    const entity = chosen[i];
    entity.description = r.text;
    entity.description_source = 'obsidian_note';
    if (r.base) entity.description_base = r.base;
  });
  return { ...data, goals, standalone_projects: standalone };
}

/**
 * Does this write touch the description of a LINKED entity? If so, split it:
 * the note write (text to put in the section, '' for a clear, and the base
 * the caller read it under) and the remaining record edit, if any.
 * Returns null when the pure write model should handle the whole call.
 */
export function splitDescriptionWrite(state, method, params = {}) {
  const kind = method === 'update_goal' ? 'goal' : method === 'update_project' ? 'project' : null;
  if (!kind) return null;
  const id = kind === 'goal' ? params.goalId : params.projectId;
  const list = kind === 'goal' ? state.goals : state.projects;
  const entity = (list ?? []).find((e) => e && e.id === id);
  if (!entity) return null;
  const link = noteLinkOf(entity);
  if (!link || link.missing) return null;
  const set = params.set ?? {};
  const clear = params.clear ?? [];
  const sets = set.description !== undefined;
  const clears = clear.includes('description');
  if (!sets && !clears) return null;
  const { description: _d, descriptionBase, ...restSet } = set;
  const restClear = clear.filter((f) => f !== 'description');
  return {
    kind, id, entity, link,
    text: sets ? String(set.description) : '',
    base: typeof descriptionBase === 'string' && descriptionBase ? descriptionBase : null,
    rest: Object.keys(restSet).length || restClear.length ? { ...params, set: restSet, clear: restClear } : null,
  };
}

/**
 * Perform the note half of a split write. Resolves to
 *   { ok: true, text, mode }          mode 'written' (direct) or 'queued' (plugin)
 *   { ok: false, error }              a typed error for the tool layer
 */
export async function writeLinkedDescription(split, { saveNoteDescription, noteWriteMode } = {}) {
  if (typeof saveNoteDescription !== 'function') {
    return { ok: false, error: { code: 'validation', message: `This device cannot write the ${split.kind}'s linked note (${split.link.name}); the vault is not connected here.` } };
  }
  let r;
  try {
    r = await saveNoteDescription(split.kind, split.id, split.link.path, split.text, { base: split.base });
  } catch (err) {
    return { ok: false, error: { code: 'internal', message: String(err?.message ?? err) } };
  }
  if (r?.refused === 'changed') {
    return {
      ok: false,
      error: {
        code: 'note_changed',
        message: `The description of this ${split.kind} changed in Obsidian since it was read (${split.link.name}). Nothing was written. Read the ${split.kind} again and retry with the new description_base.`,
      },
    };
  }
  if (!r?.ok) {
    return { ok: false, error: { code: 'validation', message: `The ${split.kind}'s linked note (${split.link.name}) could not be written on this device. The vault is not reachable here, or the note no longer exists.` } };
  }
  const mode = typeof noteWriteMode === 'function' ? noteWriteMode() : 'written';
  return { ok: true, text: split.text, mode };
}

/**
 * The undo op for a description write: puts the previous section back
 * through the same save, under the hash of the text that was written, so
 * an edit made in Obsidian since is never overwritten (the undo refuses
 * instead, and reports as skipped).
 */
export function noteDescriptionUndoOp(split, afterBase) {
  return {
    kind: 'restore_note_description',
    entityKind: split.kind, entityId: split.id, path: split.link.path,
    before: split.before ?? '', ...(afterBase ? { afterBase } : {}),
  };
}

export const NOTE_DESCRIPTION_UNDO_KIND = 'restore_note_description';

/** Apply the note-description undo ops; returns counts like applyUndoOps. */
export async function undoNoteDescriptionOps(ops, { saveNoteDescription } = {}) {
  let undone = 0;
  let skipped = 0;
  for (const op of ops ?? []) {
    if (op?.kind !== NOTE_DESCRIPTION_UNDO_KIND || typeof saveNoteDescription !== 'function') { skipped += 1; continue; }
    try {
      const r = await saveNoteDescription(op.entityKind, op.entityId, op.path, op.before ?? '', { base: op.afterBase ?? null });
      if (r?.ok) undone += 1; else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { undone, skipped };
}
