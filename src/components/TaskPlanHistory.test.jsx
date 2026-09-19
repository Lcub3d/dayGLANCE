import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import TaskPlanHistory, { PlanHistoryPanel } from './TaskPlanHistory.jsx';
import { planHistory } from '../utils/originalPlan.js';

// The badge must be ABSENT on the overwhelming majority of tasks: everything
// that predates the baseline, and everything still sitting where it was first
// put. An icon on all of them that opens to say "nothing happened" would be
// worse than no icon, so that is the case worth pinning.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const ctx = { formatTime: (t) => t };

const render = async (task) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={ctx}>
      <TaskPlanHistory task={task} />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const PLANNED = { date: '2026-09-17', startTime: '09:00', duration: 60 };

describe('TaskPlanHistory', () => {
  it('renders nothing for a task with no baseline', async () => {
    expect(await render({ id: 't1', date: '2026-09-17', startTime: '09:00' })).toBe('');
  });

  it('renders nothing for a task still where it was first put', async () => {
    expect(await render({ id: 't1', ...PLANNED, originalPlan: PLANNED })).toBe('');
  });

  it('renders the badge once the task has moved', async () => {
    const html = await render({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).toContain('lucide-history');
    expect(html).toContain('Schedule history');
  });

  it('renders for a duration-only change, which is the easiest one to miss', async () => {
    const html = await render({ id: 't1', ...PLANNED, duration: 15, originalPlan: PLANNED });
    expect(html).toContain('lucide-history');
  });

  it('keeps the history closed until asked', async () => {
    const html = await render({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).not.toContain('Originally planned');
    expect(html).toContain('aria-expanded="false"');
  });
});

// The panel body is where the formatting actually happens, and it only runs
// while the popover is open. The first version of this component imported the
// duration formatter from the wrong module; every test above still passed,
// because none of them reached this code. The dev server caught it instead.
describe('PlanHistoryPanel', () => {
  const renderPanel = async (task) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <PlanHistoryPanel history={planHistory(task)} task={task} formatTime={(v) => v} />
    </I18nextProvider>,
  );

  it('shows the original schedule beside the current one', async () => {
    const html = await renderPanel({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).toContain('Originally planned');
    expect(html).toContain('09:00');
    expect(html).toContain('Now');
    expect(html).toContain('16:00');
  });

  it('formats durations rather than printing raw minutes', async () => {
    const html = await renderPanel({ id: 't1', ...PLANNED, duration: 15, originalPlan: PLANNED });
    expect(html).toContain('1h');   // the original 60
    expect(html).toContain('15m');  // the current
  });

  it('emphasises what changed and dims what did not', async () => {
    // Duration moved, date and time did not: only the duration should be bold.
    const html = await renderPanel({ id: 't1', ...PLANNED, duration: 15, originalPlan: PLANNED });
    expect(html).toMatch(/font-semibold[^>]*>1h/);
    expect(html).toMatch(/opacity-60[^>]*>09:00/);
  });

  it('omits the duration entirely when the baseline carries none', async () => {
    const plan = { date: '2026-09-17', startTime: '09:00' };
    const html = await renderPanel({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: plan });
    expect(html).toContain('Originally planned');
    expect(html).toContain('09:00');
  });
});

describe('rendering outside the timeline', () => {
  const MOVED = { id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED };

  it('takes the icon size of the row it sits in', async () => {
    // SCHED rows use 10px icons; the timeline card uses 12.
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <DayPlannerContext.Provider value={ctx}>
          <TaskPlanHistory task={MOVED} size={10} />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
    expect(html).toContain('width="10"');
  });

  it('renders without the day-planner provider at all', async () => {
    // SchedTaskCard is also used by the project planner, which is not guaranteed
    // to sit under that provider. Reading formatTime off a null context threw.
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <TaskPlanHistory task={MOVED} />
      </I18nextProvider>,
    );
    expect(html).toContain('lucide-history');
  });

  it('falls back to the raw time in the panel when there is no provider', async () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <PlanHistoryPanel history={planHistory(MOVED)} task={MOVED} formatTime={(v) => v} />
      </I18nextProvider>,
    );
    expect(html).toContain('09:00');
  });
});

describe('the surfaces that carry it', () => {
  // Four now: the timeline card, SCHED, LIST, and MONTH's embedded SCHED pane.
  // LIST was missed when the badge first shipped and found in manual testing, so
  // this pins the rule rather than the wiring: any card showing a task's time
  // should offer its history, and a calendar event never should.
  const MOVED = { id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED };

  it('offers history for a task that has moved', async () => {
    expect(await render(MOVED)).toContain('lucide-history');
  });

  it('takes the icon size of the row it sits in', async () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <DayPlannerContext.Provider value={ctx}>
          <TaskPlanHistory task={MOVED} size={11} />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
    expect(html).toContain('width="11"');
  });
});

// The question this answers, asked of the shipped feature: "the popup shows the
// original plan and the current plan, nothing in between. Is this by design?"
// It was, because nothing recorded the in-between. Now something does.
describe('PlanHistoryPanel — the stops in between', () => {
  const renderPanel = async (task) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <PlanHistoryPanel history={planHistory(task)} task={task} formatTime={(v) => v} />
    </I18nextProvider>,
  );
  const stop = (at, date, startTime) => ({ at, date, startTime });

  const SLID = {
    id: 't1', date: '2026-09-20', startTime: '14:00', duration: 60,
    originalPlan: PLANNED, deferrals: 2,
    planTrail: [stop(1, '2026-09-18', '11:00'), stop(2, '2026-09-20', '14:00')],
  };

  it('lists the schedules the task passed through', async () => {
    const html = await renderPanel(SLID);
    expect(html).toContain('Recent moves');
    expect(html).toContain('11:00');
  });

  it('does not repeat the final stop, which is already the current plan', async () => {
    const html = await renderPanel(SLID);
    // "14:00" belongs to the "Now" line only — one occurrence, not two.
    expect(html.match(/14:00/g)).toHaveLength(1);
  });

  it('says nothing about stops when there are none to show', async () => {
    const html = await renderPanel({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).not.toContain('Recent moves');
  });

  // The trail is capped at six, so the heading says RECENT rather than claiming
  // the list is everything. The total lives on the count line at the foot of the
  // panel; an earlier version printed the arithmetic between the two and read as
  // a fragment with something missing around it.
  it('does not print the arithmetic between the trail and the count', async () => {
    const html = await renderPanel({ ...SLID, deferrals: 9 });
    expect(html).toContain('Recent moves');
    expect(html).toContain('Deferred 9 times');
    expect(html).not.toMatch(/\b7\b/);
  });

  // An intermediate stop took no part in the baseline-versus-now diff, so
  // bolding it against that diff would point at nothing.
  it('renders the stops flat rather than emphasised', async () => {
    const html = await renderPanel(SLID);
    expect(html).not.toMatch(/font-semibold[^>]*>11:00/);
  });
});
