import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Deadline and priority are inbox-only (#2116): every path that puts an inbox
// task on the clock drops them and says a deadline went. The editor has one
// such path of its own: "Unscheduled" switched off on a project task moves it
// from the unscheduled list to the scheduled one. Read at the source level like
// the other App.jsx tests (the save needs most of App's state to run).
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const save = app.slice(app.indexOf('const saveMobileEditTaskFrom = '), app.indexOf('// --- Routines handlers ---'));

describe('the editor scheduling an unscheduled task', () => {
  it('leaves priority and deadline behind', () => {
    const branch = save.slice(save.indexOf('Task was unscheduled (e.g. a project task)'));
    expect(branch).toContain('const { priority: _priority, deadline: _deadline, ...scheduledFields } = existing || {};');
    expect(branch).toMatch(/setTasks\(prev => \[\.\.\.prev, \{\s*\.\.\.scheduledFields,/);
    expect(branch).not.toContain('...(existing || {})');
  });

  it('names the dropped deadline in its undo step, only when it reaches that branch', () => {
    expect(save).toMatch(/const dropsDeadline = movesInboxToClock && !!unscheduledTasks\.find\(t => t\.id === taskId\)\?\.deadline;/);
    expect(save).toContain("key: dropsDeadline ? 'scheduledDroppedDeadline' : 'edited'");
    // The same conditions the branches above it take first.
    for (const guard of ['!mobileEditIsInbox', "taskId.startsWith('recurring-')", '!newTask.recurrence', '!(newTask.keepUnscheduled && newTask.projectId)', '!tasks.some(t => t.id === taskId)']) {
      expect(save, guard).toContain(guard);
    }
  });
});
