import React from 'react';
import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DayPlannerContext, useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import JoboView from './JoboView.jsx';

const calls = vi.hoisted(() => ({ renders: 0, loads: 0, tasks: null, dailyNotes: null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
vi.mock('./jobo/JoboViews.jsx', () => {
  calls.loads++;
  return { JoboDayView: () => {
    const ctx = useDayPlannerCtx();
    calls.renders++;
    calls.tasks = ctx.tasks;
    calls.dailyNotes = ctx.dailyNotes;
    return <div data-existing-prototype />;
  } };
});

beforeEach(() => { calls.renders = 0; });
function render(planner = {}, features = {}) {
  return new Promise((resolve, reject) => {
    let html = '';
    const destination = new Writable({ write(chunk, encoding, callback) { html += chunk; callback(); } });
    destination.on('finish', () => resolve(html));
    const stream = renderToPipeableStream(
      <DayPlannerContext.Provider value={{ dataLoaded: true, ...planner }}>
        <FeaturesContext.Provider value={{ joboEnabled: true, ...features }}><JoboView /></FeaturesContext.Provider>
      </DayPlannerContext.Provider>,
      { onAllReady() { stream.pipe(destination); }, onError: reject },
    );
  });
}

it('leaves the prototype module and its ledger unopened with main flag off', async () => {
  expect(await render({}, { joboEnabled: false })).toBe('');
  expect(calls.loads).toBe(0);
  expect(calls.renders).toBe(0);
});
it.each([
  [{ isTrayMode: true }, {}], [{}, { multiUserEnabled: true }],
])('keeps the existing tray and multi-user exclusions', async (planner, features) => {
  expect(await render(planner, features)).toContain('data-jobo-unavailable');
  expect(calls.renders).toBe(0);
});
it('waits for main task hydration before mounting the prototype', async () => {
  expect(await render({ dataLoaded: false })).not.toContain('data-existing-prototype');
  expect(calls.renders).toBe(0);
});
it('passes main native task and daily-note state to the complete prototype unchanged', async () => {
  const tasks = [{ id: 'native', title: 'Existing task', originalPlan: { date: '2026-09-20', startTime: '09:00', duration: 30 } }];
  const dailyNotes = { '2026-09-20': { text: 'Native daily note' } };
  const html = await render({ tasks, dailyNotes });
  expect(html).toContain('data-jobo-view');
  expect(html).toContain('data-existing-prototype');
  expect(calls.tasks).toBe(tasks);
  expect(calls.dailyNotes).toBe(dailyNotes);
});
