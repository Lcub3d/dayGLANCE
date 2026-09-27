import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createDoRecord, pickJoboRecord } from './core.js';
import { createLedger } from './ledger.js';
import { createJoboStore } from './store.js';
import { doNotesText, prepareDoNotesEdit } from './doNotes.js';

const T0 = '2026-09-26T10:00:00.000Z';
const T1 = '2026-09-26T10:01:00.000Z';
const T2 = '2026-09-26T10:02:00.000Z';
const DAY = '2026-09-26';

const independent = (patch = {}) => createDoRecord({
  id: 'manual:free', taskId: null, timing: 'timed', date: DAY,
  startTime: '10:00', endDate: DAY, endTime: '10:30', title: 'Unlinked work',
  planSnapshot: null, source: 'manual', progress: 'started',
  createdAt: T0, updatedAt: T0, observedAt: T0, deleted: false,
  ...patch,
});

const linked = (patch = {}) => independent({ taskId: 'task-1', planSnapshot: {
  date: DAY, startTime: '10:00', duration: 30,
}, ...patch });

describe('independent Do notes adapter', () => {
  it('reads absent, existing, and cleared notes, but never exposes linked/deleted notes', () => {
    expect(doNotesText(independent())).toBe('');
    expect(doNotesText(independent({ notes: '  keep spaces  ' }))).toBe('  keep spaces  ');
    expect(doNotesText(independent({ notes: '' }))).toBe('');
    expect(doNotesText(linked({ notes: 'task-owned' }))).toBe('');
    expect(doNotesText(linked({ notes: 42 }))).toBe('');
    expect(doNotesText(independent({ deleted: true, notes: 'old' }))).toBe('');
  });

  it('creates a note on a new independent Do and preserves captured fields', () => {
    const source = independent({ extra: { keep: ['opaque'] } });
    const next = prepareDoNotesEdit({ records: [source], record: source, text: 'first note', now: 0 });
    expect(next).toMatchObject({ id: source.id, taskId: null, title: source.title, notes: 'first note' });
    expect(next.updatedAt).toBe('2026-09-26T10:00:00.001Z');
    for (const key of ['createdAt', 'observedAt', 'source', 'planSnapshot', 'extra']) {
      expect(next[key]).toEqual(source[key]);
    }
  });

  it('edits and clears text using the canonical latest record', () => {
    const source = independent({ notes: 'old' });
    const edited = prepareDoNotesEdit({ records: [source], record: source, text: 'new', now: Date.parse(T1) });
    expect(edited.notes).toBe('new');
    expect(edited.updatedAt).toBe(T1);
    const cleared = prepareDoNotesEdit({ records: [edited], record: edited, text: '', now: Date.parse(T2) });
    expect(cleared.notes).toBe('');
    expect(cleared.updatedAt).toBe(T2);
    expect(cleared.deleted).toBe(false);
  });

  it('returns the current record without changing the version for a no-op', () => {
    const source = independent({ notes: 'same' });
    const current = prepareDoNotesEdit({ records: [source], record: source, text: 'same', now: Date.parse(T2) });
    expect(current).toBe(source);
    expect(current.updatedAt).toBe(T0);
  });

  it('retains a concurrent time/progress update while applying the note', () => {
    const opened = independent({ notes: 'base' });
    const current = independent({ notes: 'base', startTime: '10:05', endTime: '10:35', progress: 'partial', updatedAt: T1 });
    const next = prepareDoNotesEdit({ records: [current], record: opened, text: 'annotated', now: Date.parse(T1) });
    expect(next).toMatchObject({ startTime: '10:05', endTime: '10:35', progress: 'partial', notes: 'annotated' });
    expect(next.updatedAt).toBe('2026-09-26T10:01:00.001Z');
  });

  it.each([
    ['note changed remotely', independent({ notes: 'remote' }), independent({ notes: 'opened' })],
    ['deleted remotely', independent({ deleted: true }), independent()],
    ['title changed remotely', independent({ title: 'other' }), independent()],
    ['opaque field changed remotely', independent({ extra: { remote: true } }), independent({ extra: { remote: false } })],
    ['opaque field added remotely', independent({ extra: { remote: true } }), independent()],
  ])('returns null when there is a stale or unsafe concurrent change: %s', (_name, current, opened) => {
    expect(prepareDoNotesEdit({ records: [current], record: opened, text: 'mine', now: Date.parse(T1) })).toBeNull();
  });

  it('returns null for a missing row, linked Do, and remote tombstone', () => {
    const source = independent();
    expect(prepareDoNotesEdit({ records: [], record: source, text: 'x', now: Date.parse(T1) })).toBeNull();
    expect(prepareDoNotesEdit({ records: [linked()], record: linked(), text: 'x', now: Date.parse(T1) })).toBeNull();
    const deleted = independent({ deleted: true, updatedAt: T1 });
    expect(prepareDoNotesEdit({ records: [deleted], record: source, text: 'x', now: Date.parse(T1) })).toBeNull();
  });

  it('keeps updatedAt strictly monotonic when the device clock moves backwards', () => {
    const source = independent({ notes: 'old', updatedAt: T1 });
    const next = prepareDoNotesEdit({ records: [source], record: source, text: 'new', now: Date.parse(T0) });
    expect(next.updatedAt).toBe('2026-09-26T10:01:00.001Z');
  });

  it('rejects invalid inputs and never edits a linked Do', () => {
    expect(() => doNotesText(null)).toThrow(TypeError);
    expect(() => doNotesText(independent({ notes: 42 }))).toThrow(TypeError);
    expect(() => prepareDoNotesEdit({ records: [independent()], record: independent(), text: 42, now: Date.parse(T1) })).toThrow(TypeError);
    expect(() => prepareDoNotesEdit({ records: [independent()], record: independent(), text: 'x', now: '2026-09-26T10:01:00.000Z' })).toThrow(TypeError);
    expect(prepareDoNotesEdit({ records: [linked()], record: linked(), text: 'x', now: Date.parse(T1) })).toBeNull();
  });

  it('does not let unrelated legacy rows block the target note edit', () => {
    const target = independent();
    const unrelated = linked({ id: 'do:linked', notes: 42 });
    const next = prepareDoNotesEdit({ records: [unrelated, target], record: target, text: 'target only', now: Date.parse(T1) });
    expect(next.notes).toBe('target only');
  });
});

describe('opaque note extension through ledger/store and merge', () => {
  let dbName;
  beforeEach(() => { dbName = `jobo-do-notes-${Math.random().toString(36).slice(2)}`; });

  it('survives real IndexedDB store and ledger commit without a second notes store', async () => {
    const store = createJoboStore({ dbName });
    const ledger = createLedger({ store });
    await ledger.load();
    const row = independent({ notes: 'persist me' });
    expect((await ledger.commit([row])).ok).toBe(true);
    expect((await store.read()).value).toEqual([row]);
    expect(ledger.get().records[0].notes).toBe('persist me');
    ledger.dispose();
  });

  it('keeps the opaque notes extension in the deterministic sync winner', () => {
    const older = independent({ notes: 'old', updatedAt: T0 });
    const newer = independent({ notes: 'new', updatedAt: T1 });
    expect(pickJoboRecord(older, newer)).toBe(newer);
    expect(pickJoboRecord(newer, older)).toBe(newer);
  });

  it('round-trips the extension through an explicit backup/restore-shaped store value', async () => {
    const store = createJoboStore({ dbName });
    const row = independent({ notes: 'backup text', extra: { source: 'backup' } });
    expect((await store.write([row])).ok).toBe(true);
    const backup = (await store.read()).value;
    const restoredStore = createJoboStore({ dbName: `${dbName}-restore` });
    expect((await restoredStore.write(backup)).ok).toBe(true);
    expect((await restoredStore.read()).value).toEqual([row]);
  });
});
