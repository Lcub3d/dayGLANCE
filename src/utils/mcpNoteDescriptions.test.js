import { describe, it, expect, vi } from 'vitest';
import {
  enrichGoalTreeDescriptions, splitDescriptionWrite, writeLinkedDescription,
  noteDescriptionUndoOp, undoNoteDescriptionOps, DESCRIPTION_READ_CAP,
} from './mcpNoteDescriptions.js';

// The MCP as one more editor over a linked note's description section
// (2026-10-04): the goal tree read opens the notes to fill descriptions in,
// and a description write on a linked entity goes through the planner's own
// section save with refuse-on-change. No copy, no cache.

const tree = () => ({
  goals: [{
    id: 'g1', title: 'Home', description: '', obsidian_note: { path: 'Goals/Home.md', name: 'Goals/Home', missing: false },
    projects: [
      { id: 'p1', title: 'Roof', description: '', obsidian_note: { path: 'Projects/Roof.md', name: 'Projects/Roof', missing: false } },
      { id: 'p2', title: 'Garden', description: 'Local box.' },
      { id: 'p3', title: 'Attic', description: '', obsidian_note: { path: 'Projects/Attic.md', name: 'Projects/Attic', missing: true } },
    ],
  }],
  standalone_projects: [{ id: 'p4', title: 'Shed', description: '', obsidian_note: { path: 'Projects/Shed.md', name: 'Projects/Shed', missing: false } }],
});

describe('enrichGoalTreeDescriptions', () => {
  it('fills description, source and base from each present note; a missing note, an unlinked entity and an unreadable note are left as they were', async () => {
    const loadNoteDescription = vi.fn(async (path) => {
      if (path === 'Goals/Home.md') return { text: 'Dry roof by spring.', base: 'h1' };
      if (path === 'Projects/Roof.md') return { notFound: true };
      if (path === 'Projects/Shed.md') return null;
      return { text: 'x', base: 'hx' };
    });
    const out = await enrichGoalTreeDescriptions(tree(), { loadNoteDescription });
    expect(out.goals[0]).toMatchObject({ description: 'Dry roof by spring.', description_source: 'obsidian_note', description_base: 'h1' });
    expect(out.goals[0].projects[0]).toMatchObject({ description: '' });
    expect('description_source' in out.goals[0].projects[0]).toBe(false);
    expect(out.goals[0].projects[1]).toEqual({ id: 'p2', title: 'Garden', description: 'Local box.' });
    expect(out.standalone_projects[0]).toMatchObject({ description: '' });
    // The missing note is never opened.
    expect(loadNoteDescription).not.toHaveBeenCalledWith('Projects/Attic.md');
    expect(loadNoteDescription).toHaveBeenCalledTimes(3);
  });
  it('without a loader, or with nothing linked, returns the data unchanged in shape; the input is not mutated', async () => {
    const data = tree();
    const same = await enrichGoalTreeDescriptions(data, {});
    expect(same).toBe(data);
    const out = await enrichGoalTreeDescriptions(data, { loadNoteDescription: async () => ({ text: 'T', base: 'b' }) });
    expect(data.goals[0].description).toBe('');
    expect(out.goals[0].description).toBe('T');
  });
  it('caps the reads and survives a loader that hangs or throws', async () => {
    const many = { goals: [], standalone_projects: Array.from({ length: DESCRIPTION_READ_CAP + 5 }, (_, i) => ({ id: `p${i}`, obsidian_note: { path: `P/${i}.md`, name: `P/${i}`, missing: false } })) };
    const loader = vi.fn(async (path) => (path === 'P/1.md' ? Promise.reject(new Error('boom')) : { text: 'ok', base: 'b' }));
    const out = await enrichGoalTreeDescriptions(many, { loadNoteDescription: loader });
    expect(loader).toHaveBeenCalledTimes(DESCRIPTION_READ_CAP);
    expect(out.standalone_projects[0].description).toBe('ok');
    expect('description' in out.standalone_projects[1]).toBe(false);
    expect('description' in out.standalone_projects[DESCRIPTION_READ_CAP + 2]).toBe(false);
  });
});

describe('splitDescriptionWrite', () => {
  const state = {
    goals: [{ id: 'g1', title: 'Home', obsidianNotePath: 'Goals/Home.md' }, { id: 'g2', title: 'Plain' }],
    projects: [{ id: 'p1', title: 'Roof', obsidianNotePath: 'Projects/Roof.md', obsidianNoteMissingAt: '2026-10-01T00:00:00Z' }],
  };
  it('splits a linked goal\'s description from the rest of the call; a clear writes an empty section', () => {
    const s = splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: { description: 'New', descriptionBase: 'h0', title: 'Home!' }, clear: ['area'] });
    expect(s).toMatchObject({ kind: 'goal', id: 'g1', text: 'New', base: 'h0', link: { path: 'Goals/Home.md' } });
    expect(s.rest).toEqual({ goalId: 'g1', set: { title: 'Home!' }, clear: ['area'] });
    const only = splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: { description: 'New' } });
    expect(only.rest).toBeNull();
    const cleared = splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: {}, clear: ['description'] });
    expect(cleared).toMatchObject({ text: '', rest: null });
  });
  it('is null for an unlinked entity, a missing note, a call that leaves the description alone, or any other method', () => {
    expect(splitDescriptionWrite(state, 'update_goal', { goalId: 'g2', set: { description: 'x' } })).toBeNull();
    expect(splitDescriptionWrite(state, 'update_project', { projectId: 'p1', set: { description: 'x' } })).toBeNull();
    expect(splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: { title: 'x' } })).toBeNull();
    expect(splitDescriptionWrite(state, 'update_task', { taskId: 't', set: { notes: 'x' } })).toBeNull();
  });
});

describe('writeLinkedDescription', () => {
  const split = { kind: 'goal', id: 'g1', link: { path: 'Goals/Home.md', name: 'Goals/Home' }, text: 'New', base: 'h0' };
  it('writes through the section save with the base and reports written or queued', async () => {
    const save = vi.fn(async () => ({ ok: true }));
    await expect(writeLinkedDescription(split, { saveNoteDescription: save, noteWriteMode: () => 'queued' })).resolves.toEqual({ ok: true, text: 'New', mode: 'queued' });
    expect(save).toHaveBeenCalledWith('goal', 'g1', 'Goals/Home.md', 'New', { base: 'h0' });
    await expect(writeLinkedDescription(split, { saveNoteDescription: save })).resolves.toMatchObject({ mode: 'written' });
  });
  it('a refusal is note_changed; a failed write and a device without the vault are typed validation errors; a throw is internal', async () => {
    const refused = await writeLinkedDescription(split, { saveNoteDescription: async () => ({ refused: 'changed', text: 'Edited in Obsidian.' }) });
    expect(refused).toMatchObject({ ok: false, error: { code: 'note_changed' } });
    expect(refused.error.message).toContain('Goals/Home');
    expect(await writeLinkedDescription(split, { saveNoteDescription: async () => ({ ok: false }) })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await writeLinkedDescription(split, {})).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await writeLinkedDescription(split, { saveNoteDescription: async () => { throw new Error('disk'); } })).toMatchObject({ ok: false, error: { code: 'internal', message: 'disk' } });
  });
});

describe('the undo op and its replay', () => {
  it('restores the previous section under the hash of what was written, so an Obsidian edit since is refused and counted as skipped', async () => {
    const split = { kind: 'project', id: 'p1', link: { path: 'Projects/Roof.md', name: 'Projects/Roof' }, text: 'New', base: null, before: 'Old text.' };
    const op = noteDescriptionUndoOp(split, 'hNew');
    expect(op).toEqual({ kind: 'restore_note_description', entityKind: 'project', entityId: 'p1', path: 'Projects/Roof.md', before: 'Old text.', afterBase: 'hNew' });
    const save = vi.fn(async () => ({ ok: true }));
    await expect(undoNoteDescriptionOps([op], { saveNoteDescription: save })).resolves.toEqual({ undone: 1, skipped: 0 });
    expect(save).toHaveBeenCalledWith('project', 'p1', 'Projects/Roof.md', 'Old text.', { base: 'hNew' });
    await expect(undoNoteDescriptionOps([op], { saveNoteDescription: async () => ({ refused: 'changed', text: 'x' }) })).resolves.toEqual({ undone: 0, skipped: 1 });
    await expect(undoNoteDescriptionOps([op, { kind: 'other' }], {})).resolves.toEqual({ undone: 0, skipped: 2 });
  });
});
