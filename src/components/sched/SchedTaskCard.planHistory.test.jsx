import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import SchedTaskCard from './SchedTaskCard.jsx';

// The plan-history badge has to reach SCHED as well as the timeline, because
// SCHED is where a rescheduled task is most likely to be looked at. The same
// card backs the SCHED view, the SCHED dashboard, the SCHED pane embedded in
// MONTH, and the project planner, so covering it here covers all four.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const noop = () => {};
const render = async (task, { doSessions = [] } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
      formatTime: (t) => t, toggleComplete: noop, openMobileEditTask: noop, currentTime: new Date(), postponeTask: noop,
      updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
      getDoSessionsForTask: () => doSessions,
    }}>
      <FeaturesContext.Provider value={{ projects: [], goalsProjectsEnabled: false, generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null }}>
        <SyncContext.Provider value={{ loadWikiNote: null, saveWikiNote: null, openInObsidian: null }}>
          <SchedTaskCard task={task} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const base = { id: 'a', title: 'Write the report', date: '2026-09-18', startTime: '09:00', duration: 60, completed: false };
const PLAN = { date: '2026-09-15', startTime: '08:00', duration: 30 };

describe('SchedTaskCard plan history', () => {
  it('shows the badge on a task that has moved', async () => {
    const html = await render({ ...base, originalPlan: PLAN });
    expect(html).toContain('lucide-history');
  });

  it("sizes it to the SCHED row's icons rather than the timeline card's", async () => {
    const html = await render({ ...base, originalPlan: PLAN });
    expect(html).toMatch(/lucide-history[^>]*?width="14"|width="14"[^>]*lucide-history/);
  });

  it('shows nothing on a task with no baseline', async () => {
    expect(await render(base)).not.toContain('lucide-history');
  });

  it('shows nothing on a task still where it was first put', async () => {
    const html = await render({ ...base, originalPlan: { date: '2026-09-18', startTime: '09:00', duration: 60 } });
    expect(html).not.toContain('lucide-history');
  });

  it('shows nothing on an imported calendar event', async () => {
    // An event's schedule belongs to its source calendar, not to any plan the
    // user made here, so a baseline on one would be describing someone else.
    const html = await render({ ...base, imported: true, originalPlan: PLAN });
    expect(html).not.toContain('lucide-history');
  });
});

// JOBO (#1932): a finished task with a Do badge tells one story, so its plan
// history moves into the badge's panel and the separate icon goes. Only
// there: an unfinished card, or one without timed Do, keeps the icon.
describe('SchedTaskCard plan history beside a Do badge', () => {
  const session = { recordId: 'r1', startMinute: 600, endMinute: 660, progress: 'completed', clippedStart: false, clippedEnd: false };

  // MUTATION: drop the completed condition and an unfinished task loses the
  // icon its planning still needs.
  it('keeps the icon on an unfinished task with Do', async () => {
    const html = await render({ ...base, originalPlan: PLAN }, { doSessions: [session] });
    expect(html).toContain('lucide-history');
    expect(html).toContain('data-do-badge');
  });

  it('keeps the icon on a finished task with no timed Do', async () => {
    expect(await render({ ...base, completed: true, originalPlan: PLAN })).toContain('lucide-history');
  });

  // MUTATION: keep the icon here and a full card carries two badges telling
  // halves of one story.
  it('folds it into the Do badge on a finished task with Do', async () => {
    const html = await render({ ...base, completed: true, originalPlan: PLAN }, { doSessions: [session] });
    expect(html).not.toContain('lucide-history');
    expect(html).toContain('data-do-badge');
  });
});

