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
