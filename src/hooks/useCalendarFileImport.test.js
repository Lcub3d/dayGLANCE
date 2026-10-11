import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeSyncData } from '../mergeSync.js';
import { dropResurrectedTasks } from '../utils/dropResurrectedTasks.js';
import { stampTimestamps } from '../utils/stampTimestamps.js';
import useDataPersistence from './useDataPersistence.js';

// Run the production hook with controlled React commits and FileReader order.
// Updaters are replayed, as in StrictMode; only the second result is committed.
const react = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], dirty: false }));
vi.mock('react', () => ({
  useRef: (initial) => {
    const i = react.cursor++;
    return react.slots[i] ??= { current: initial };
  },
  useState: (initial) => {
    const i = react.cursor++;
    const slot = react.slots[i] ??= { value: initial };
    return [slot.value, value => {
      slot.value = typeof value === 'function' ? value(slot.value) : value;
      react.dirty = true;
    }];
  },
  useLayoutEffect: (effect, deps) => {
    const i = react.cursor++;
    const slot = react.slots[i] ??= {};
    if (!slot.deps || deps.some((d, n) => d !== slot.deps[n])) {
      react.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      slot.deps = deps;
    }
  },
  useEffect: (effect, deps) => {
    const i = react.cursor++;
    const slot = react.slots[i] ??= {};
    if (!slot.deps || deps.some((d, n) => d !== slot.deps[n])) {
      react.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      slot.deps = deps;
    }
  },
}));
import useCalendarFileImport from './useCalendarFileImport.js';

const DELETED = 'day-planner-deleted-task-ids';
const COMPLETED = 'day-planner-task-completed-uids';
const NOW = '2026-10-09T12:00:00.000Z';
const DELETION = '2026-10-09T12:00:00.001Z';
const OLD = '2026-10-08T12:00:00.000Z';
const DATE = '2026-10-09';
let readers;
function calendar(...uids) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...uids.flatMap(uid => [
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTART:20261009T090000Z',
    'DTEND:20261009T100000Z', `SUMMARY:${uid}`, 'END:VEVENT',
  ]), 'END:VCALENDAR'].join('\r\n');
}
function fileTask(uid, asTaskCalendar = false, extra = {}) {
  return { id: `${uid}-${DATE}`, icalUid: uid, title: uid, date: DATE,
    imported: true, isTaskCalendar: asTaskCalendar, importSource: 'file',
    lastModified: OLD, ...extra };
}
function harness(tasks = []) {
  const state = { tasks, pendingImportFile: null, showImportModal: false, importColor: 'bg-gray-600' };
  const queuedTasks = [];
  const notifications = vi.fn();
  const setters = Object.fromEntries(['pendingImportFile', 'showImportModal', 'importColor'].map(key => [
    `set${key[0].toUpperCase()}${key.slice(1)}`, value => { state[key] = value; react.dirty = true; },
  ]));
  const setTasks = vi.fn(update => { queuedTasks.push(update); react.dirty = true; });
  let hook;
  const renderHook = useCalendarFileImport;
  const flush = () => {
    let turns = 0;
    do {
      if (++turns > 20) throw new Error('Render loop');
      while (queuedTasks.length) {
        const update = queuedTasks.shift();
        if (typeof update === 'function') {
          const writes = localStorage.setItem.mock.calls.length;
          update(state.tasks);
          state.tasks = update(state.tasks);
          expect(localStorage.setItem.mock.calls).toHaveLength(writes);
        } else state.tasks = update;
      }
      react.dirty = false;
      react.cursor = 0;
      hook = renderHook({ ...state, ...setters, setTasks,
        syncRetentionDays: 0, setSyncNotification: notifications, t: key => key });
      react.effects.splice(0).forEach(effect => effect());
    } while (react.dirty || queuedTasks.length);
  };
  flush();
  return { state, setTasks, notifications, flush, get hook() { return hook; },
    select(name) {
      const file = { name };
      hook.handleFileUpload({ target: { files: [file], value: name } });
      flush();
      return file;
    },
    start(asTaskCalendar) { hook.processImportFile(asTaskCalendar); return readers.at(-1); },
    finish(reader, content) { reader.onload({ target: { result: content } }); flush(); },
    cancel() { hook.cancelImport(); flush(); },
    unmount() { react.slots.forEach(slot => slot.cleanup?.()); },
  };
}

beforeEach(() => {
  react.slots = []; react.effects = []; react.cursor = 0; react.dirty = false;
  readers = [];
  const data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(key => data.get(key) ?? null),
    setItem: vi.fn((key, value) => data.set(key, value)),
  });
  vi.stubGlobal('FileReader', class {
    constructor() { readers.push(this); this.readyState = 0; }
    readAsText(file) { this.file = file; this.readyState = 1; }
    abort() { this.readyState = 2; this.onabort?.(); }
  });
  vi.useFakeTimers(); vi.setSystemTime(NOW);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

for (const asTaskCalendar of [false, true]) {
  describe(asTaskCalendar ? 'task-calendar imports' : 'event imports', () => {
    it('preserves concurrent edits/additions/deletions and the opposite import subset', () => {
      const other = fileTask('opposite', !asTaskCalendar);
      const subscription = fileTask('subscription', asTaskCalendar, { importSource: 'sync' });
      const h = harness([{ id: 'native', title: 'before' }, { id: 'deleted' }, other, subscription, fileTask('old', asTaskCalendar)]);
      h.select('A'); const reader = h.start(asTaskCalendar);
      h.state.tasks = [{ id: 'native', title: 'edited during read' }, { id: 'added' }, other, subscription, fileTask('old', asTaskCalendar)];
      h.flush();
      h.finish(reader, calendar('new'));
      expect(h.state.tasks).toEqual([{ id: 'native', title: 'edited during read' }, { id: 'added' }, other, subscription,
        expect.objectContaining({ id: `new-${DATE}`, isTaskCalendar: asTaskCalendar })]);
      expect(h.setTasks).toHaveBeenCalledWith(expect.any(Function));
    });
    it('does nothing when cancelled, including storage and notifications', () => {
      const original = [fileTask('old', asTaskCalendar)];
      const h = harness(original); h.select('A'); const reader = h.start(asTaskCalendar);
      h.cancel(); h.finish(reader, calendar('new'));
      expect(h.state.tasks).toBe(original);
      expect(h.notifications).not.toHaveBeenCalled();
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });
    it('cannot replace a newer completed import', () => {
      const h = harness(); h.select('A'); const first = h.start(asTaskCalendar);
      h.cancel(); h.select('B'); const second = h.start(asTaskCalendar);
      h.finish(second, calendar('B')); h.finish(first, calendar('A'));
      expect(h.state.tasks.map(task => task.icalUid)).toEqual(['B']);
      expect(h.notifications).toHaveBeenCalledTimes(1);
    });
    it('cannot clear a newer pending selection even without Cancel first', () => {
      const h = harness(); h.select('A'); const first = h.start(asTaskCalendar);
      const selected = h.select('B'); h.finish(first, calendar('A'));
      expect(h.state.tasks).toEqual([]);
      expect(h.state.pendingImportFile).toBe(selected);
      expect(h.state.showImportModal).toBe(true);
      expect(h.notifications).not.toHaveBeenCalled();
    });
    it('tombstones only missing ids, and they stay absent through the real sync merge', () => {
      const removed = fileTask('removed', asTaskCalendar);
      const shared = fileTask('shared', asTaskCalendar);
      const opposite = fileTask('opposite', !asTaskCalendar);
      const h = harness([removed, shared, opposite]);
      localStorage.setItem(DELETED, JSON.stringify({ unrelated: OLD }));
      h.select('new'); h.finish(h.start(asTaskCalendar), calendar('shared', 'new'));
      const tombstones = JSON.parse(localStorage.getItem(DELETED));
      expect(tombstones).toEqual({ unrelated: OLD, [removed.id]: DELETION });
      const outgoing = dropResurrectedTasks(h.state.tasks, tombstones);
      const stamped = stampTimestamps(outgoing, [removed, shared, opposite], NOW);
      const remote = { tasks: [removed, shared, opposite], deletedTaskIds: {} };
      const result = mergeSyncData({ tasks: stamped, deletedTaskIds: tombstones }, remote, 0);
      expect(result.data.tasks.map(task => task.id).sort()).toEqual(stamped.map(task => task.id).sort());
      const reverse = mergeSyncData(remote, { tasks: stamped, deletedTaskIds: tombstones }, 0);
      expect(reverse.data.tasks.map(task => task.id).sort()).toEqual(stamped.map(task => task.id).sort());
    });
    it('retains the existing empty-file replacement behavior', () => {
      const h = harness([fileTask('old', asTaskCalendar), { id: 'native' }]);
      h.select('empty'); h.finish(h.start(asTaskCalendar), calendar());
      expect(h.state.tasks).toEqual([{ id: 'native' }]);
      expect(h.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'info', message: 'sync.icalImportEmpty' }));
    });
    it('an uninterrupted import preserves completion and color semantics', () => {
      const h = harness([{ id: 'native' }]); h.select('A'); h.state.importColor = 'bg-blue-600'; h.flush();
      const reader = h.start(asTaskCalendar);
      localStorage.setItem(COMPLETED, JSON.stringify([`new::${DATE}`]));
      h.finish(reader, calendar('new'));
      expect(h.state.tasks[1]).toMatchObject({ completed: asTaskCalendar,
        color: asTaskCalendar ? 'task-calendar' : 'bg-blue-600', duration: asTaskCalendar ? 15 : 60 });
      expect(h.state.pendingImportFile).toBeNull(); expect(h.state.showImportModal).toBe(false);
      expect(h.notifications).toHaveBeenCalledTimes(1);
    });
  });
}

it('no selected file is a no-op', () => {
  const h = harness(); h.start(false); h.flush();
  expect(readers).toHaveLength(0); expect(h.setTasks).not.toHaveBeenCalled();
  expect(h.notifications).not.toHaveBeenCalled(); expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('a result queued by onload is still invalidated before the commit', () => {
  const original = [fileTask('old')];
  const h = harness(original); h.select('A'); const reader = h.start(false);
  reader.onload({ target: { result: calendar('A') } });
  h.cancel();
  expect(h.state.tasks).toBe(original);
  expect(h.notifications).not.toHaveBeenCalled();
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('a newer submission for the same file owns the import mode', () => {
  const h = harness(); h.select('A'); const first = h.start(false); const second = h.start(true);
  h.finish(first, calendar('old')); h.finish(second, calendar('new'));
  expect(h.state.tasks).toHaveLength(1);
  expect(h.state.tasks[0]).toMatchObject({ icalUid: 'new', isTaskCalendar: true });
  expect(h.notifications).toHaveBeenCalledTimes(1);
});

it('unmount invalidates a pending reader without touching tasks or storage', () => {
  const h = harness(); h.select('A'); const reader = h.start(false);
  h.unmount(); reader.onload({ target: { result: calendar('A') } });
  expect(h.setTasks).not.toHaveBeenCalled(); expect(h.notifications).not.toHaveBeenCalled();
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('tombstones a file task added while the read was in flight', () => {
  const h = harness(); h.select('A'); const reader = h.start(false);
  h.setTasks(prev => [...prev, fileTask('late')]);
  h.finish(reader, calendar('A'));
  expect(JSON.parse(localStorage.getItem(DELETED))).toEqual({ [`late-${DATE}`]: DELETION });
});

it.each(['malformed', 'null', '[]'])('an unreadable tombstone map (%s) fails closed', value => {
  const original = [fileTask('old')];
  const h = harness(original); const selected = h.select('A');
  localStorage.setItem(DELETED, value);
  h.finish(h.start(false), calendar('A'));
  expect(h.state.tasks).toBe(original);
  expect(h.state.pendingImportFile).toBe(selected); expect(h.state.showImportModal).toBe(true);
  expect(localStorage.getItem(DELETED)).toBe(value);
  expect(h.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
});

it('a failed tombstone write preserves tasks and permits retry', () => {
  const original = [fileTask('old')]; const h = harness(original); h.select('A');
  const write = localStorage.setItem.getMockImplementation();
  localStorage.setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
  h.finish(h.start(false), calendar('A'));
  expect(h.state.tasks).toBe(original); expect(h.state.showImportModal).toBe(true);
  expect(h.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
  localStorage.setItem.mockImplementation(write);
  h.finish(h.start(false), calendar('A'));
  expect(h.state.tasks.map(task => task.icalUid)).toEqual(['A']);
  expect(h.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'success' }));
});

it('re-importing a removed uid survives the outbound filter and a peer tombstone', () => {
  const h = harness([fileTask('returning')]);
  h.select('empty'); h.finish(h.start(false), calendar());
  const peer = { tasks: [], deletedTaskIds: JSON.parse(localStorage.getItem(DELETED)) };
  vi.setSystemTime('2026-10-09T12:01:00.000Z');
  h.select('restore'); h.finish(h.start(false), calendar('returning'));
  const tombstones = JSON.parse(localStorage.getItem(DELETED));
  expect(tombstones).toEqual(peer.deletedTaskIds);
  const outgoing = dropResurrectedTasks(h.state.tasks, tombstones);
  expect(outgoing).toHaveLength(1);
  expect(mergeSyncData({ tasks: outgoing, deletedTaskIds: tombstones }, peer, 0).data.tasks).toEqual(outgoing);
  expect(mergeSyncData(peer, { tasks: outgoing, deletedTaskIds: tombstones }, 0).data.tasks).toEqual(outgoing);
});

it('does not tombstone an id still present in the other import subset', () => {
  const retained = fileTask('same', true);
  const h = harness([fileTask('same'), retained]);
  h.select('empty'); h.finish(h.start(false), calendar());
  expect(h.state.tasks).toEqual([retained]);
  expect(localStorage.getItem(DELETED)).toBeNull();
});

it('repeat imports replace in place without duplicates or new deletion markers', () => {
  const h = harness();
  for (let i = 0; i < 3; i++) { h.select('A'); h.finish(h.start(false), calendar('same')); }
  expect(h.state.tasks).toHaveLength(1);
  expect(localStorage.getItem(DELETED)).toBeNull();
});

it('late read errors are silent, while an active read error allows retry', () => {
  const h = harness(); h.select('A'); const stale = h.start(false);
  h.cancel(); h.select('B'); stale.onerror();
  expect(h.notifications).not.toHaveBeenCalled();
  const active = h.start(false); active.onerror(); h.flush();
  expect(h.state.showImportModal).toBe(true); expect(h.state.tasks).toEqual([]);
  expect(h.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
  h.finish(h.start(false), calendar('B'));
  expect(h.state.tasks.map(task => task.icalUid)).toEqual(['B']);
});

it('a synchronous FileReader failure leaves the selection available for retry', () => {
  const h = harness(); h.select('A');
  const read = FileReader.prototype.readAsText;
  FileReader.prototype.readAsText = () => { throw new Error('Cannot read'); };
  h.start(false); h.flush();
  expect(h.state.showImportModal).toBe(true); expect(h.state.tasks).toEqual([]);
  expect(h.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
  FileReader.prototype.readAsText = read;
  h.finish(h.start(false), calendar('A'));
  expect(h.state.tasks.map(task => task.icalUid)).toEqual(['A']);
});

it('a cancelled file picker does not invalidate the current selection', () => {
  const h = harness(); const selected = h.select('A'); const reader = h.start(false);
  h.hook.handleFileUpload({ target: { files: [], value: '' } });
  expect(h.state.pendingImportFile).toBe(selected);
  h.finish(reader, calendar('A'));
  expect(h.state.tasks.map(task => task.icalUid)).toEqual(['A']);
});

it('same-millisecond replacement and re-import survive persistence and sync', () => {
  const original = fileTask('same', false, { lastModified: NOW });
  const h = harness([original]);
  h.select('empty'); h.finish(h.start(false), calendar());
  const tombstones = JSON.parse(localStorage.getItem(DELETED));
  const deletion = { tasks: [], deletedTaskIds: tombstones };
  expect(mergeSyncData(deletion, { tasks: [original] }, 0).data.tasks).toEqual([]);
  h.select('restore'); h.finish(h.start(false), calendar('same'));
  const outgoing = stampTimestamps(dropResurrectedTasks(h.state.tasks, tombstones), [], NOW);
  expect(outgoing).toHaveLength(1);
  expect(mergeSyncData({ tasks: outgoing, deletedTaskIds: tombstones }, deletion, 0).data.tasks).toEqual(outgoing);
});

// Exercise the same save and outbound stamping functions used by App.jsx.
// Unlike synthetic stamped state, an ordinary parsed import has NO live stamp:
// saveData stamps its stored copy without putting lastModified back in state.
const persistence = useDataPersistence;
function savedImport(h) {
  const make = () => persistence({
    tasks: h.state.tasks, setTasks: h.setTasks, unscheduledTasks: [], recycleBin: [],
    recurringTasks: [], todayRoutines: [], completedTaskUids: new Set(), syncRetentionDays: 0,
    suppressTimestampRef: { current: false }, cloudSyncInitialDoneRef: { current: true },
    setUndoToast: vi.fn(), setUnscheduledTasks: vi.fn(),
  });
  return {
    save() { make().saveData(); h.flush(); },
    payload() {
      const deletedTaskIds = JSON.parse(localStorage.getItem(DELETED) || '{}');
      return {
        tasks: make().stampTaskTimestamps(dropResurrectedTasks(h.state.tasks, deletedTaskIds), 'day-planner-tasks'),
        deletedTaskIds,
      };
    },
  };
}
for (const asTaskCalendar of [false, true]) {
  describe(`production persistence, task-calendar=${asTaskCalendar}`, () => {
    it('a same-millisecond replacement defeats the real stored copy although live state has no stamp', () => {
      const h = harness(); const persisted = savedImport(h);
      h.select('A'); h.finish(h.start(asTaskCalendar), calendar('same')); persisted.save();
      expect(h.state.tasks[0].lastModified).toBeUndefined();
      const peer = { tasks: JSON.parse(localStorage.getItem('day-planner-tasks')) };
      expect(peer.tasks[0].lastModified).toBe(NOW);
      h.select('empty'); h.finish(h.start(asTaskCalendar), calendar()); persisted.save();
      const payload = persisted.payload();
      expect(mergeSyncData(payload, peer, 0).data.tasks).toEqual([]);
      expect(mergeSyncData(peer, payload, 0).data.tasks).toEqual([]);
    });
    it('changed re-import after a future-tombstone restore survives save and outbound stamping', () => {
      const h = harness(); const persisted = savedImport(h);
      const future = '2026-10-10T12:00:00.000Z';
      localStorage.setItem(DELETED, JSON.stringify({ [`same-${DATE}`]: future }));
      h.select('A'); h.finish(h.start(asTaskCalendar), calendar('same')); persisted.save();
      const first = JSON.parse(localStorage.getItem('day-planner-tasks'))[0];
      expect(Date.parse(first.lastModified)).toBeGreaterThan(Date.parse(future));
      h.select('changed');
      h.finish(h.start(asTaskCalendar), calendar('same').replace('SUMMARY:same', 'SUMMARY:changed on re-import'));
      persisted.save();
      const stored = JSON.parse(localStorage.getItem('day-planner-tasks'))[0];
      const payload = persisted.payload();
      expect(stored.title).toBe('changed on re-import');
      expect(Date.parse(stored.lastModified)).toBeGreaterThan(Date.parse(first.lastModified));
      expect(payload.tasks[0].lastModified).toBe(stored.lastModified);
      const peer = { tasks: [first], deletedTaskIds: payload.deletedTaskIds };
      expect(mergeSyncData(payload, peer, 0).data.tasks).toMatchObject([{ title: 'changed on re-import' }]);
      expect(mergeSyncData(peer, payload, 0).data.tasks).toMatchObject([{ title: 'changed on re-import' }]);
      // A later removal must also dominate the persisted future restoration.
      h.select('empty'); h.finish(h.start(asTaskCalendar), calendar()); persisted.save();
      expect(mergeSyncData(persisted.payload(), payload, 0).data.tasks).toEqual([]);
    });
  });
}


it('an ordinary completion after restoring a file task survives production save and sync', () => {
  const h = harness(); const persisted = savedImport(h);
  const future = '2026-10-10T12:00:00.000Z';
  localStorage.setItem(DELETED, JSON.stringify({ [`same-${DATE}`]: future }));
  h.select('A'); h.finish(h.start(true), calendar('same')); persisted.save();
  const before = persisted.payload();
  h.setTasks(prev => prev.map(task => ({ ...task, completed: true })));
  h.flush(); persisted.save();
  const completed = persisted.payload();
  expect(completed.tasks).toMatchObject([{ completed: true }]);
  expect(Date.parse(completed.tasks[0].lastModified)).toBeGreaterThan(Date.parse(before.tasks[0].lastModified));
  expect(mergeSyncData(completed, before, 0).data.tasks).toMatchObject([{ completed: true }]);
  expect(mergeSyncData(before, completed, 0).data.tasks).toMatchObject([{ completed: true }]);
});

it.each([false, true])('replacement reads the persisted timestamp if the clock moved backwards (task-calendar=%s)', asTaskCalendar => {
  const h = harness(); const persisted = savedImport(h);
  h.select('A'); h.finish(h.start(asTaskCalendar), calendar('same')); persisted.save();
  expect(h.state.tasks[0].lastModified).toBeUndefined();
  const peer = persisted.payload();
  vi.setSystemTime('2026-10-09T11:00:00.000Z');
  h.select('empty'); h.finish(h.start(asTaskCalendar), calendar()); persisted.save();
  expect(mergeSyncData(persisted.payload(), peer, 0).data.tasks).toEqual([]);
});

it('explicit restore outranks an unchanged stored copy still present behind a newer tombstone', () => {
  const h = harness(); const persisted = savedImport(h);
  h.select('A'); h.finish(h.start(false), calendar('same')); persisted.save();
  const old = persisted.payload();
  const future = '2026-10-10T12:00:00.000Z';
  localStorage.setItem(DELETED, JSON.stringify({ [`same-${DATE}`]: future }));
  h.select('restore'); h.finish(h.start(false), calendar('same')); persisted.save();
  const restored = persisted.payload();
  expect(restored.tasks).toHaveLength(1);
  expect(Date.parse(restored.tasks[0].lastModified)).toBeGreaterThan(Date.parse(future));
  expect(mergeSyncData(restored, old, 0).data.tasks).toMatchObject([{ icalUid: 'same' }]);
});
