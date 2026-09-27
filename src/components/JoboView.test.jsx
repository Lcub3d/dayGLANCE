import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDoRecord } from '../jobo/core.js';
const fixture = vi.hoisted(() => ({ ctx: {}, features: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
import JoboView from './JoboView.jsx';
const task = { id: 't1', title: 'Native Plan', date: '2026-09-24', startTime: '09:00', duration: 30, notes: 'Native note', completed: true };
function render(extra = {}) {
  fixture.ctx = { selectedDate: new Date(2026, 8, 24, 12), currentTime: new Date(2026, 8, 24, 12), tasks: [task],
    unscheduledTasks: [], expandedRecurringTasks: [], recurringTasks: [], getTasksForDate: () => [task], formatTime: value => value,
    textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', toggleComplete: vi.fn() };
  fixture.features = { joboRecords: [], joboLoaded: true, joboWritable: true, joboError: null, recordJobo: vi.fn(), reloadJobo: vi.fn(), ...extra };
  return renderToStaticMarkup(<JoboView />);
}
describe('minimal JOBO view', () => {
  it('shows live native completion and task notes without planning or day-level surfaces', () => {
    const html = render();
    expect(html).toContain('Native Plan');
    expect(html).toContain('checked');
    expect(html).toContain('task.notes: Native Plan');
    expect(html).not.toContain('Native note');
    expect(html).toContain('jobo.view.addDo');
    expect(html).not.toMatch(/data-jobo-daily|jobo-s5-connections|draggable=|jobo-priority|jobo-s5-time-frames/);
  });
  it('surfaces read failures rather than perpetual loading or an empty day', () => {
    const html = render({ joboLoaded: false, joboRecords: undefined, joboError: 'storageRead' });
    expect(html).toContain('jobo.view.loadError');
    expect(html).not.toContain('common.loading');
    expect(html).not.toContain('jobo.view.emptyDo');
  });
  it('draws completion evidence as a source-time point without inventing a time span', () => {
    const stamp = '2026-09-24T09:30:00.000Z';
    const row = createDoRecord({ id: 'do:t1:x', taskId: 't1', title: 'Captured work', source: 'completion', progress: 'completed',
      timing: 'untimed', date: '2026-09-24', startTime: null, endDate: null, endTime: null, planSnapshot: null,
      createdAt: stamp, updatedAt: stamp, observedAt: stamp });
    const html = render({ joboRecords: [row] });
    expect(html).toContain('Captured work');
    expect(html).not.toContain('jobo.view.untimed');
    expect(html).toContain('data-jobo-point="true"');
    expect(html).toContain('09:30');
    expect(html).toContain('top:126px');
    expect(html).toContain('common.edit: Captured work');
    expect(row.startTime).toBeNull();
  });
  it('keeps the source boundary explicit', () => {
    const view = readFileSync(new URL('./JoboView.jsx', import.meta.url), 'utf8');
    const editor = readFileSync(new URL('./jobo/DoEditor.jsx', import.meta.url), 'utf8');
    expect(view).not.toMatch(/readJoboWorkingSet|workingSet\(|createQuickPlan|copyPlan|startPlanDrag|writeDailyNotes|prepareDoNotesEdit/);
    expect(editor).toContain('useState(() => record?.id || `manual:${crypto.randomUUID()}`)');
    expect(editor).not.toMatch(/toggleComplete|setTasks|localStorage|indexedDB/);
    expect(editor).not.toContain('jobo.view.untimed');
    expect(editor).not.toContain('jobo.view.timed');
    expect(editor).toContain('createPortal');
  });
});


describe('JOBO narrow-card controls', () => {
  it('keeps secondary comparisons clipped without nested horizontal scrollers', () => {
    const html = render();
    expect(html).toContain('data-jobo-metadata');
    expect(html).toContain('min-w-0 truncate');
    expect(html).not.toContain('overflow-x-auto');
    expect(html).not.toContain('min-w-[1600px]');
    expect(html).toContain('task.notes: Native Plan');
    expect(html).toContain('title="Native Plan"');
  });

  it('keeps point actions available without a user-facing Untimed category', () => {
    const stamp = '2026-09-24T09:30:00.000Z';
    const row = createDoRecord({ id: 'do:t1:narrow', taskId: 't1', title: 'A long captured title in a narrow column',
      source: 'completion', progress: 'completed', timing: 'untimed', date: '2026-09-24',
      startTime: null, endDate: null, endTime: null, planSnapshot: null,
      createdAt: stamp, updatedAt: stamp, observedAt: stamp });
    const html = render({ joboRecords: [row] });
    expect(html).toContain('data-jobo-point="true"');
    expect(html).toContain('data-jobo-marker-handle');
    expect(html).toContain('title="09:30"');
    expect(html).toContain('shrink-0 p-1 rounded');
    expect(html).not.toContain('jobo.view.untimed');
    expect(html).not.toContain('jobo-s5-untimed');
    expect(row.startTime).toBeNull();
    expect(row.endTime).toBeNull();
  });
});
