import { describe, expect, it } from 'vitest';
import { handleMcpWrite } from './mcpWriteModel.js';
import { stampTimestamps } from './stampTimestamps.js';
import { mergeTaskArrays } from '../mergeSync.js';

// #2083, walked the way it happened: a sync apply lands a task, an MCP write
// edits it while the apply is still being committed, and the save pass skips
// stamping for that window (suppressTimestampRef) and persists the rows as
// they are. The write's own stamp is what must make the edit newer than the
// copy it replaced, so the next merge keeps it. Before the fix the edited row
// kept the old stamp, and the equal-stamp tie-break (#2084) chose the copy
// that still carried the project.

const T0 = '2026-10-14T12:00:00.000Z';
const TASK = {
  id: 'fd07e88e', title: 'Planning', date: '2026-10-17', startTime: '19:00', duration: 60,
  color: 'bg-blue-500', completed: false, isAllDay: false, notes: 'meeting', subtasks: [],
  projectId: 'd2e2921e', lastModified: T0,
};

function store(tasks) {
  const s = { state: { tasks, unscheduledTasks: [], projects: [{ id: 'd2e2921e' }, { id: 'p2' }], users: [] } };
  const set = (key) => (v) => { s.state = { ...s.state, [key]: typeof v === 'function' ? v(s.state[key]) : v }; };
  s.setters = { setTasks: set('tasks'), setUnscheduledTasks: set('unscheduledTasks'), setRecurringTasks: set('recurringTasks'), setRecycleBin: set('recycleBin') };
  s.write = (method, params) => handleMcpWrite(s.state, s.setters, { method, params });
  return s;
}

/** The suppressed save pass persists as-is; the next payload diff-stamps against that. */
const persistSuppressedThenBuildPayload = (tasks) => {
  const stored = JSON.parse(JSON.stringify(tasks));
  return stampTimestamps(tasks, stored, new Date().toISOString());
};

describe('an MCP edit made while a sync apply is committed (#2083)', () => {
  it.each([
    ['update_task: clearing the project', 'update_task', { taskId: TASK.id, set: {}, clear: ['project'] }, (t) => expect(t).not.toHaveProperty('projectId')],
    ['update_task: moving it to another project', 'update_task', { taskId: TASK.id, set: { projectId: 'p2' }, clear: [] }, (t) => expect(t.projectId).toBe('p2')],
    ['update_task: new notes', 'update_task', { taskId: TASK.id, set: { notes: 'agenda' }, clear: [] }, (t) => expect(t.notes).toBe('agenda')],
    ['move_block', 'move_block', { blockId: TASK.id, date: '2026-10-18', startTime: '09:00' }, (t) => expect(t).toMatchObject({ date: '2026-10-18', startTime: '09:00' })],
    ['resize_block', 'resize_block', { blockId: TASK.id, durationMinutes: 90 }, (t) => expect(t.duration).toBe(90)],
  ])('%s survives the next merge against the copy it replaced', (_label, method, params, check) => {
    const s = store([TASK]);
    const r = s.write(method, params);
    expect(r.ok).toBe(true);

    const [edited] = s.state.tasks;
    expect(Date.parse(edited.lastModified)).toBeGreaterThan(Date.parse(T0));

    const payload = persistSuppressedThenBuildPayload(s.state.tasks);
    // The other device (or the file) still holds the copy the apply wrote.
    const { merged } = mergeTaskArrays(payload, [TASK], {});
    check(merged.find((t) => t.id === TASK.id));
  });
});
