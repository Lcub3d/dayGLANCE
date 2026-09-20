import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { languages, loaders } from '../locales.js';
import GoalTimeline from './goals/GoalTimeline.jsx';
import ReminderToasts from './ReminderToasts.jsx';

const escape = (value) => renderToStaticMarkup(<>{value}</>);
const goal = { id: 'goal', title: 'Release V2.0', startDate: '2026-09-20', targetDate: '2027-05-30', color: 'bg-purple-500' };
const reminder = { id: 'r1', taskId: 't1', taskTitle: 'My task', message: 'Message', type: 'start', startTime: '14:00' };
const planner = { tasks: [], unscheduledTasks: [], darkMode: false, textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', toggleComplete: vi.fn() };

async function translation(language) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: await loaders[language]() } }, interpolation: { escapeValue: false } });
  return i18n;
}

function render(ui, i18n, features = {}, day = {}) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={{ ...planner, ...day }}>
        <FeaturesContext.Provider value={features}>{ui}</FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

afterEach(() => vi.useRealTimers());

describe.each(languages)('%s remaining UI localization', (language) => {
  it('formats roadmap ticks and dates using the selected app language', async () => {
    const i18n = await translation(language);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12));
    const html = render(<GoalTimeline goals={[goal]} projects={[]} />, i18n);
    for (const count of [1, 3, 6]) expect(html).toContain(escape(i18n.t('goals.rangeMonthsShort', { count })));
    for (const count of [1, 2]) expect(html).toContain(escape(i18n.t('goals.rangeYearsShort', { count })));
    const format = (date, options) => new Intl.DateTimeFormat(language, options).format(date);
    expect(html).toContain(escape(format(new Date(2026, 8, 1), { month: 'short' })));
    expect(html).toContain(escape(format(new Date(2027, 0, 1), { month: 'short', year: 'numeric' })));
    expect(html).toContain(escape(format(new Date(2027, 4, 30), { month: 'short', day: 'numeric', year: 'numeric' })));
    expect(html).toContain('Release V2.0');
    expect(html).not.toContain('goals.rangeMonthsShort');
    // The May deadline remains May even though the default chart ends in March.
    expect(goal.targetDate).toBe('2027-05-30');
    if (language === 'zh-CN') {
      expect(html).toContain('6个月');
      expect(html).toContain('2027年5月30日');
      expect(html).not.toMatch(/May 30|Jan|Sep/);
    }
  });

  it('omits the year on same-year targets and handles open-ended goals', async () => {
    const i18n = await translation(language);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12));
    const target = new Date(2026, 9, 10);
    const dated = render(<GoalTimeline goals={[{ ...goal, targetDate: '2026-10-10' }]} projects={[]} />, i18n);
    expect(dated).toContain(escape(new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(target)));
    const open = render(<GoalTimeline goals={[{ ...goal, targetDate: null }]} projects={[]} />, i18n);
    expect(open).toContain(escape(i18n.t('goals.noTarget')));
    expect(open).not.toContain('Invalid Date');
  });

  it('localizes reminder actions without translating user content or clock text', async () => {
    const i18n = await translation(language);
    const html = render(<ReminderToasts />, i18n, { activeReminders: [reminder] });
    expect(html).toContain(escape(i18n.t('reminders.snoozeMinutes', { count: 15 })));
    expect(html).toContain(escape(i18n.t('common.dismiss')));
    expect(html).toContain(`aria-label="${escape(i18n.t('common.dismiss'))}"`);
    expect(html).toContain('My task');
    expect(html).toContain('14:00');
    expect(html).not.toContain('reminders.snoozeMinutes');
    expect(html).not.toContain('Snooze 15m');
  });

  it.each([6, 7])('localizes overflow counts and dismiss-all for %i reminders', async (count) => {
    const i18n = await translation(language);
    const activeReminders = Array.from({ length: count }, (_, i) => ({ ...reminder, id: `r${i}` }));
    const html = render(<ReminderToasts />, i18n, { activeReminders });
    expect(html).toContain(escape(i18n.t('reminders.more', { count: count - 5 })));
    expect(html).not.toContain('reminders.more');
    expect(html.split('My task').length - 1).toBe(5);
    if (language === 'zh-CN') expect(html).not.toMatch(/Dismiss| more/);
  });

  it('preserves the reminder action visibility rules', async () => {
    const i18n = await translation(language);
    expect(render(<ReminderToasts />, i18n, { activeReminders: [] })).toBe('');
    for (const type of ['end', 'morning']) {
      const html = render(<ReminderToasts />, i18n, { activeReminders: [{ ...reminder, type }] });
      expect(html).not.toContain(escape(i18n.t('reminders.snoozeMinutes', { count: 15 })));
    }
    const event = render(<ReminderToasts />, i18n, { activeReminders: [{ ...reminder, type: 'end', isCalendarEvent: true }] });
    const task = render(<ReminderToasts />, i18n, { activeReminders: [{ ...reminder, type: 'end' }] });
    expect((event.match(/<button/g) || []).length).toBe(2);
    expect((task.match(/<button/g) || []).length).toBe(3);
  });
});

it('wires every task-context-menu text node to an existing translation in every language', async () => {
  const source = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const menu = source.split('{/* Task Context Menu */}')[1].split('{/* Timeline Context Menu')[0];
  expect(menu).not.toMatch(/\n\s+(Edit|Notes|Notes \/ subtasks|Generate subtasks \(AI\)|Move to tomorrow|Move to inbox|Delete)\s*\n/);
  expect(menu).not.toContain("isCompleted ? 'Uncomplete' : 'Complete'");
  const keys = [...menu.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]);
  expect(keys).toContain('common.edit');
  expect(keys).toContain('common.delete');
  expect(keys.length).toBeGreaterThanOrEqual(9);
  for (const language of languages) {
    const i18n = await translation(language);
    for (const key of keys) expect(i18n.exists(key), `${language}: ${key}`).toBe(true);
  }
  // Localization must not replace any of the existing task operations.
  for (const call of ['openMobileEditTask(ctxTask, isInbox)', 'postponeTask(taskId)', 'moveToInbox(taskId)', 'toggleComplete(taskId, isInbox)', 'moveToRecycleBin(taskId, isInbox)']) {
    expect(menu).toContain(call);
  }
});
