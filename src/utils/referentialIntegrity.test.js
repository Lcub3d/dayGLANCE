import { describe, it, expect } from 'vitest';
import {
  stripProjectRefs, stripGoalRefs, stripUserRefs, resolveDeletedIds,
} from './referentialIntegrity.js';

const task = (id, projectId) => (projectId ? { id, title: id, projectId } : { id, title: id });

describe('stripProjectRefs', () => {
  it('removes a tombstoned project id and leaves every other reference alone', () => {
    const rows = [task('a', 'p1'), task('b', 'p2'), task('c')];
    const out = stripProjectRefs(rows, new Set(['p1']));
    expect(out).not.toBe(rows);
    expect(out[0]).not.toHaveProperty('projectId');
    expect(out[1].projectId).toBe('p2');
    expect(out[2]).not.toHaveProperty('projectId');
    // everything except the dangling key is preserved
    expect(out[1]).toEqual(rows[1]);
  });

  it('returns the same array (identity) when nothing is dangling', () => {
    const rows = [task('a', 'p1')];
    expect(stripProjectRefs(rows, new Set(['p2']))).toBe(rows);
    expect(stripProjectRefs(rows, {})).toBe(rows);
    expect(stripProjectRefs(rows, null)).toBe(rows);
    expect(stripProjectRefs([], ['p1'])).toEqual([]);
  });

  it('does NOT treat an id outside a (possibly partial) project list as deleted', () => {
    // The review on #2137: absence from a local list is not a deletion. Only a
    // tombstone may detach a row; this helper no longer takes a known-id list.
    const rows = [task('a', 'p1'), task('b', 'only-on-another-device')];
    const out = stripProjectRefs(rows, {});
    expect(out).toBe(rows);
  });

  it('accepts the tombstone map shape stored in localStorage', () => {
    const rows = [task('a', 'p1')];
    const out = stripProjectRefs(rows, { p1: '2026-10-18T13:30:15.460Z' });
    expect(out[0]).not.toHaveProperty('projectId');
  });
});

describe('stripGoalRefs', () => {
  const project = (id, goalId) => ({ id, title: id, goalId, updatedAt: '2026-10-01T00:00:00.000Z' });

  it('makes the deleted goal\'s projects standalone, stamped when asked (delete-time cascade)', () => {
    const projects = [project('a', 'g1'), project('b', 'g2'), project('c', null)];
    const out = stripGoalRefs(projects, new Set(['g1']), '2026-10-19T00:00:00.000Z');
    expect(out[0]).not.toHaveProperty('goalId');
    expect(out[0].updatedAt).toBe('2026-10-19T00:00:00.000Z');
    expect(out[1].goalId).toBe('g2');
    expect(out[1].updatedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(out[2]).toBe(projects[2]);
  });

  it('leaves updatedAt alone when no stamp is passed (boot/apply repair)', () => {
    const projects = [project('a', 'gone')];
    const out = stripGoalRefs(projects, { gone: '2026-10-18T00:00:00.000Z' });
    expect(out[0]).not.toHaveProperty('goalId');
    expect(out[0].updatedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('returns the same array when no project points at the deleted goal', () => {
    const projects = [project('a', 'g2')];
    expect(stripGoalRefs(projects, new Set(['g1']))).toBe(projects);
    expect(stripGoalRefs(projects, null)).toBe(projects);
  });

  it('does NOT treat a goal id missing from the local goal list as deleted', () => {
    const projects = [project('a', 'goal-only-on-another-device')];
    expect(stripGoalRefs(projects, {})).toBe(projects);
  });
});

describe('stripUserRefs', () => {
  it('drops a deleted member from assignedUserSyncIds and removes the empty field', () => {
    const rows = [
      { id: 'a', assignedUserSyncIds: ['u1', 'u2'] },
      { id: 'b', assignedUserSyncIds: ['u1'], lastModified: 'old' },
      { id: 'c' },
    ];
    const out = stripUserRefs(rows, { deletedUserSyncIds: new Set(['u1']) }, 'now');
    expect(out[0].assignedUserSyncIds).toEqual(['u2']);
    expect(out[1]).not.toHaveProperty('assignedUserSyncIds');
    expect(out[1].lastModified).toBe('now');
    expect(out[2]).toBe(rows[2]);
  });

  it('drops a deleted member as owner (habits, routines, frames)', () => {
    const rows = [{ id: 'a', ownerSyncId: 'u1' }, { id: 'b', ownerSyncId: 'u2' }, { id: 'c' }];
    const out = stripUserRefs(rows, { deletedUserSyncIds: ['u1'], field: 'ownerSyncId' }, 'now');
    expect(out[0]).not.toHaveProperty('ownerSyncId');
    expect(out[0].lastModified).toBe('now');
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });

  it('returns the same array when no deleted member is referenced', () => {
    const rows = [{ id: 'a', assignedUserSyncIds: ['u2'] }];
    expect(stripUserRefs(rows, { deletedUserSyncIds: new Set(['u1']) })).toBe(rows);
    expect(stripUserRefs(rows, { deletedUserSyncIds: new Set() })).toBe(rows);
  });
});

describe('resolveDeletedIds (the apply boundary rule)', () => {
  it('trusts the payload map when it carries one (merged sync and backup restore)', () => {
    expect(resolveDeletedIds({ p1: 'payload' }, { p1: 'local', p2: 'local' })).toEqual({ p1: 'payload' });
  });

  it('treats a carried empty map as the word of the payload (a restore clears the tombstone)', () => {
    expect(resolveDeletedIds({}, { p1: 'local' })).toEqual({});
  });

  it('falls back to the local map only when an older client omits the key', () => {
    expect(resolveDeletedIds(undefined, { p1: 'local' })).toEqual({ p1: 'local' });
    expect(resolveDeletedIds(null, {})).toEqual({});
  });
});
