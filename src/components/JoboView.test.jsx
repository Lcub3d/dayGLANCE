import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDoRecord } from '../jobo/core.js';

// JOBO's Plan side is DAY's own timeline column and its Do side is drawn to
// the same grid. These tests pin that structure (the Plan column is the app's
// column over the whole day, not a copy of it), the Do cards, and the source
// boundary: the view reads committed records and never the working set.

const fixture = vi.hoisted(() => ({ ctx: {}, features: {}, planColumns: [] }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('../hooks/useDayViewHourHeight.js', () => ({ default: () => 80 }));
vi.mock('./DayView.jsx', () => ({
  DayViewColumn: ({ col, hourHeight }) => {
    fixture.planColumns.push({ ...col, hourHeight });
    return <div data-plan-column={`${col.dateStr} ${col.startHour}-${col.endHour}`} />;
  },
}));
import JoboView from './JoboView.jsx';

const task = { id: 't1', title: 'Native Plan', date: '2026-09-24', startTime: '09:00', duration: 30, color: 'bg-emerald-500', completed: true };
const stamp = '2026-09-24T09:30:00-05:00';
const point = (over = {}) => createDoRecord({
  id: 'do:t1:x', taskId: 't1', title: 'Captured work', source: 'completion', progress: 'completed',
  timing: 'untimed', date: '2026-09-24', startTime: null, endDate: null, endTime: null, planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});
const timed = (over = {}) => createDoRecord({
  id: 'manual:1', taskId: 't1', title: 'Deep work', source: 'manual', progress: 'started',
  timing: 'timed', date: '2026-09-24', startTime: '10:00', endDate: '2026-09-24', endTime: '11:00', planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});

function render(extra = {}) {
  fixture.planColumns = [];
  fixture.ctx = {
    selectedDate: new Date(2026, 8, 24, 12), currentTime: new Date(2026, 8, 24, 12),
    tasks: [task], unscheduledTasks: [], expandedRecurringTasks: [], recurringTasks: [],
    getTasksForDate: () => [task], formatTime: (value) => value,
    textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', darkMode: false,
    calendarRef: { current: null }, stickyHeaderRef: { current: null },
  };
  fixture.features = { joboRecords: [], joboLoaded: true, joboWritable: true, joboError: null, recordJobo: vi.fn(), reloadJobo: vi.fn(), ...extra };
  return renderToStaticMarkup(<JoboView />);
}

describe('JOBO view', () => {
  // MUTATION: render a hand-built Plan lane instead and this fails; that lane
  // is what lost drag and drop, the hover line and the real cards.
  it('the Plan side is DAY\'s own column over the whole selected day', () => {
    const html = render();
    expect(fixture.planColumns).toHaveLength(1);
    expect(fixture.planColumns[0]).toMatchObject({ dateStr: '2026-09-24', startHour: 0, endHour: 24, hourHeight: 80 });
    expect(html).toContain('data-plan-column="2026-09-24 0-24"');
    expect(html).not.toContain('data-jobo-plan');
  });

  it('draws the Do side on the same grid: 24 hour rows and the now line on today', () => {
    const html = render();
    expect(html.match(/border-b border-dashed/g)).toHaveLength(24);
    expect(html).toContain('bg-red-500');
    expect(html).toContain('jobo.view.emptyDo');
  });

  it('draws a completion as a card at its completion time, in the task\'s colour, with a rule marking the moment', () => {
    const html = render({ joboRecords: [point()] });
    expect(html).toContain('data-jobo-point="true"');
    expect(html).toContain('Captured work');
    expect(html).toContain('top:760px'); // 09:30 at 80px an hour
    expect(html).toContain('bg-emerald-500');
    expect(html).toContain('common.edit: Captured work');
    expect(html).not.toContain('jobo.view.untimed');
  });

  it('draws a timed Do as a card spanning its interval, with the resize handle a task card has', () => {
    const html = render({ joboRecords: [timed()] });
    expect(html).toContain('data-jobo-record="manual:1"');
    expect(html).toContain('top:800px');     // 10:00
    expect(html).toContain('height:78px');   // 60 minutes, less the 2px gap
    expect(html).toContain('10:00–11:00');
    expect(html).toContain('w-12 h-1 bg-white rounded-full');
  });

  it('a read-only ledger offers no edit, add or resize', () => {
    const html = render({ joboRecords: [timed()], joboWritable: false });
    expect(html).not.toContain('common.edit: Deep work');
    expect(html).not.toContain('w-12 h-1 bg-white rounded-full');
    expect(html).toContain('jobo.view.readOnly');
    expect(html).toMatch(/disabled=""[^>]*>.*jobo\.view\.addDo/s);
  });

  it('surfaces a read failure rather than an empty day', () => {
    const html = render({ joboLoaded: false, joboRecords: undefined, joboError: 'storageRead' });
    expect(html).toContain('jobo.view.loadError');
    expect(html).not.toContain('jobo.view.emptyDo');
  });

  it('keeps the source boundary explicit', () => {
    const view = readFileSync(new URL('./JoboView.jsx', import.meta.url), 'utf8');
    const column = readFileSync(new URL('./jobo/DoColumn.jsx', import.meta.url), 'utf8');
    const editor = readFileSync(new URL('./jobo/DoEditor.jsx', import.meta.url), 'utf8');
    for (const source of [view, column]) {
      expect(source).not.toMatch(/readJoboWorkingSet|workingSet\(|setTasks|localStorage|indexedDB/);
    }
    expect(editor).toContain('useState(() => record?.id || `manual:${crypto.randomUUID()}`)');
    expect(editor).not.toMatch(/toggleComplete|setTasks|localStorage|indexedDB/);
  });

  // MUTATION: go back to <input type="date|time"> and this fails; the browser's
  // own pickers match nothing else in dayGLANCE.
  it('the Do editor uses the app\'s own date and time pickers, never the browser\'s', () => {
    const editor = readFileSync(new URL('./jobo/DoEditor.jsx', import.meta.url), 'utf8');
    expect(editor).toContain("from '../ClockTimePicker.jsx'");
    expect(editor).toContain("from '../DatePicker.jsx'");
    expect(editor).not.toMatch(/type="(date|time)"/);
  });
});

describe('Do column gestures snap like the rest of the app', () => {
  it('snaps to 15 minutes and clamps to the day', async () => {
    const { snapMinute } = await import('./jobo/DoColumn.jsx');
    expect(snapMinute(7)).toBe(0);
    expect(snapMinute(8)).toBe(15);
    expect(snapMinute(611)).toBe(615);
    expect(snapMinute(-20)).toBe(0);
    expect(snapMinute(1500)).toBe(1440);
  });
});

describe('the Do editor reads an end before the start as the next day', () => {
  it('rolls over only when the end is earlier than the start', async () => {
    const { endDateFor } = await import('./jobo/DoEditor.jsx');
    expect(endDateFor('2026-09-24', '09:00', '10:30')).toBe('2026-09-24');
    expect(endDateFor('2026-09-24', '23:00', '01:00')).toBe('2026-09-25');
    expect(endDateFor('2026-12-31', '23:30', '00:15')).toBe('2027-01-01');
    // Equal stays put, so core refuses an empty interval instead of 24 hours.
    expect(endDateFor('2026-09-24', '09:00', '09:00')).toBe('2026-09-24');
  });
});

describe('a completion with a planned duration is drawn as a dashed estimate', () => {
  const planned = () => point({ planSnapshot: { date: '2026-09-24', startTime: '08:30', duration: 60 } });

  it('spans the planned duration ending at the completion, and stays a marker without one', async () => {
    const { estimateCompletion } = await import('./jobo/DoColumn.jsx');
    const item = { id: 'x', point: true, startMinute: 592, endMinute: 592, time: '09:52', date: '2026-09-24', record: planned() };
    expect(estimateCompletion(item)).toMatchObject({ estimate: true, startMinute: 532, endMinute: 592, markerMinute: 592 });
    expect(estimateCompletion({ ...item, record: point() })).toEqual({ ...item, record: point() });
    expect(estimateCompletion({ ...item, point: false })).toMatchObject({ point: false });
    expect(estimateCompletion({ ...item, startMinute: 20, endMinute: 20 })).toMatchObject({ startMinute: 0, endMinute: 20 });
  });

  // MUTATION: drop estimateCompletion from the view and the card is a marker
  // again; store the estimate and recordJobo is called on render.
  it('renders dashed and labelled, and drawing it writes nothing to the ledger', () => {
    const recordJobo = vi.fn();
    const html = render({ joboRecords: [planned()], recordJobo });
    expect(html).toContain('data-jobo-estimate="true"');
    expect(html).toContain('border-dashed border-white/80');
    expect(html).toContain('top:680px');   // completed 09:30, planned 60 min: from 08:30, at 80px an hour
    expect(html).toContain('jobo.view.estimatedShort');
    expect(html).toContain('~08:30–09:30');
    expect(recordJobo).not.toHaveBeenCalled();
  });
});

describe('an unfinished Do can be continued', () => {
  const plan = { date: '2026-09-24', startTime: '09:00', duration: 30 };

  it('offers Continue on an unfinished linked attempt, and not on a completed, unlinked or estimated one', () => {
    expect(render({ joboRecords: [timed({ progress: 'partial', planSnapshot: plan })] })).toContain('data-jobo-continue');
    expect(render({ joboRecords: [timed({ progress: 'completed', planSnapshot: plan })] })).not.toContain('data-jobo-continue');
    expect(render({ joboRecords: [timed({ taskId: null })] })).not.toContain('data-jobo-continue');
    expect(render({ joboRecords: [point({ planSnapshot: plan })] })).not.toContain('data-jobo-continue');
    expect(render({ joboRecords: [timed({ progress: 'partial' })], joboWritable: false })).not.toContain('data-jobo-continue');
  });

  // MUTATION: drop the task or the plan from continueInitial and the
  // follow-up is a separate "Unplanned" execution instead of a second session.
  it('the follow-up shares the task and captured plan, so it groups with the original', async () => {
    const { continueInitial } = await import('./JoboView.jsx');
    const { createManualDo } = await import('../jobo/viewActions.js');
    const { buildJoboDayModel } = await import('../jobo/viewModel.js');
    const first = timed({ progress: 'partial', planSnapshot: plan });
    const initial = continueInitial(first, '2026-09-24', 11 * 60);
    expect(initial).toMatchObject({ title: 'Deep work', continuing: true, planSnapshot: plan });
    const next = createManualDo({ id: 'manual:2', title: initial.title, task: initial.task, planSnapshot: initial.planSnapshot,
      date: initial.date, startMinute: initial.startMinute, duration: initial.duration, now: Date.parse('2026-09-24T16:00:00Z') });
    expect(next).toMatchObject({ taskId: 't1', planSnapshot: plan, progress: 'started', startTime: '11:00' });
    const model = buildJoboDayModel({ date: '2026-09-24', tasks: [task], records: [first, next] });
    expect(model.timedRecords).toHaveLength(2);
    const [a, b] = model.timedRecords;
    expect(a.groupKey).toBe(b.groupKey);
    expect(a.attempts.map((attempt) => attempt.id ?? attempt.record?.id).sort()).toEqual(['manual:1', 'manual:2']);
  });
});

describe('a single timing status reads on the status line', () => {
  it('"Unplanned" sits beside the progress rather than on a line of its own', async () => {
    const { cardSignals } = await import('./jobo/DoColumn.jsx');
    const t = (key) => key;
    expect(cardSignals({ planContext: 'noPlan', metrics: {} }, t)).toEqual({ inline: { key: 'unplanned', text: 'jobo.view.summary.unplanned' }, rows: [] });
    expect(cardSignals({ metrics: { untimedAttemptCount: 1 } }, t).inline).toMatchObject({ text: 'jobo.view.timeIncompleteShort', title: 'jobo.view.timeIncomplete' });
    expect(cardSignals(null, t)).toEqual({ inline: null, rows: [] });
    const html = render({ joboRecords: [timed({ taskId: null, progress: 'partial' })] });
    expect(html).toMatch(/10:00–11:00 · jobo\.view\.progress\.partial<span data-jobo-axis="unplanned"> · jobo\.view\.summary\.unplanned<\/span>/);
  });
});

describe('a Do card opens its task\'s notes and pairs with its Plan card', () => {
  it('offers Notes on a Do linked to a task, and not on an unlinked one', () => {
    expect(render({ joboRecords: [timed()] })).toContain('data-jobo-notes-toggle');
    expect(render({ joboRecords: [timed({ taskId: null })] })).not.toContain('data-jobo-notes-toggle');
  });

  // MUTATION: render DayViewColumn outside the wrapper and hovering a Plan
  // card no longer finds its Do cards.
  it('wraps DAY\'s column in the hover listener without changing the grid', () => {
    const html = render();
    expect(html).toMatch(/<div class="contents" data-jobo-pairing="true"><div data-plan-column/);
  });
});

describe('START to END only', () => {
  it('windowRange widens the window to whole hours and falls back to the whole day', async () => {
    const { windowRange } = await import('./jobo/DoColumn.jsx');
    expect(windowRange({ start: '07:30', stop: '18:15' })).toEqual({ startHour: 7, endHour: 19 });
    expect(windowRange({ start: '06:00', stop: null })).toEqual({ startHour: 6, endHour: 24 });
    expect(windowRange({ start: null, stop: '22:00' })).toEqual({ startHour: 0, endHour: 22 });
    expect(windowRange({ start: '22:00', stop: '06:00' })).toEqual({ startHour: 0, endHour: 24 });
    expect(windowRange(null)).toEqual({ startHour: 0, endHour: 24 });
  });

  it('offers the toggle only on a day with a window', () => {
    expect(render()).not.toContain('data-jobo-window-toggle');
    expect(render({ getDayWindow: () => ({ start: '08:00', stop: '18:00' }) })).toContain('data-jobo-window-toggle');
  });

  // MUTATION: leave the Do side at 24 hours, or drop windowStart from a card's
  // top, and the two sides no longer line up.
  it('with the toggle on, both sides draw START to END and cards sit relative to START', () => {
    vi.stubGlobal('localStorage', { getItem: () => '1', setItem: () => {} });
    try {
      const html = render({ getDayWindow: () => ({ start: '08:00', stop: '18:00' }), joboRecords: [timed()] });
      expect(fixture.planColumns[0]).toMatchObject({ startHour: 8, endHour: 18 });
      expect(html.match(/border-b border-dashed/g)).toHaveLength(10);
      expect(html).toContain('top:160px'); // 10:00 is two hours after 08:00, at 80px an hour
      expect(html).toContain('aria-pressed="true"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
