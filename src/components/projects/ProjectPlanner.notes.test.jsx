import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import ProjectPlanner from './ProjectPlanner.jsx';

// The planner's notes sidebar: opt-in from a Notes button on desktop and
// landscape tablet, remembered on this device. Closed, nothing changes;
// open, the planner widens and a pane beside the lists shows the selected
// task's notes. Clicks and keys are checked in the browser; these pin what
// renders, and where.

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const noop = () => {};

const project = {
  id: 'p1',
  title: 'dayGLANCE',
  color: 'bg-orange-500',
  goalId: null,
  description: 'notes',
  hyperglance: {
    enabled: true, icon: 'BookOpen', color: '#4f46e5', isRecurring: true,
    scheduledDays: ['monday'], scheduledTime: '10:15', scheduledDuration: 60,
    templateTasks: [], completions: [], createdAt: '2026-01-01T00:00:00.000Z',
  },
};

const unscheduled = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`, title: `TASK ${i}`, duration: 30, color: 'bg-orange-500',
  completed: false, isAllDay: false, notes: '', subtasks: [], priority: 0, projectId: 'p1',
}));

const render = async ({ isMobile = false, scheduledHidden = false, isTablet = false, isLandscape = true } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      isMobile, isTablet, isLandscape, darkMode: false, use24HourClock: false,
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900',
      textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      tasks: [], unscheduledTasks: unscheduled, recurringTasks: [],
      setUnscheduledTasks: noop, reorderUnscheduledTasks: noop,
      openMobileEditTask: noop, scheduleTaskAtNextSlot: noop,
      formatTime: (t) => t, toggleComplete: noop, currentTime: new Date(), postponeTask: noop,
      updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
    }}>
      <FeaturesContext.Provider value={{
        goals: [], projects: [project], goalsProjectsEnabled: true,
        updateProject: noop, isVisibleForUser: () => true,
        generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null,
      }}>
        <SyncContext.Provider value={{ loadWikiNote: null, saveWikiNote: null, openInObsidian: null }}>
          <ProjectPlanner project={{ ...project, plannerScheduledHidden: scheduledHidden }} onClose={noop} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

// Minimal tag walker over static markup: enough to pick the DIRECT children of
// a container out of React's output, which is well formed and self-closes its
// void elements.
const TAG = /<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

function directChildren(html, openTag) {
  const start = html.indexOf(openTag);
  expect(start, `container not found: ${openTag.slice(0, 60)}…`).toBeGreaterThan(-1);
  TAG.lastIndex = start;
  TAG.exec(html); // consume the container's own opening tag
  const children = [];
  let depth = 0;
  let m;
  while ((m = TAG.exec(html)) !== null) {
    const [raw, closing, , , selfClosing] = m;
    if (closing) {
      if (depth === 0) break; // the container's closing tag
      depth -= 1;
      continue;
    }
    if (depth === 0) children.push(raw);
    if (!selfClosing) depth += 1;
  }
  return children;
}

const DESKTOP_BODY = '<div class="p-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">';
// The mobile body carries its own classes and a style attribute, so match the
// opening tag rather than one fixed string.
const bodyTag = (html) => html.match(/<div class="p-4 flex flex-col gap-4[^>]*>/)?.[0] ?? '';

describe('the planner notes sidebar', () => {
  it('starts closed, with the planner as it was', async () => {
    store.clear();
    const html = await render();
    expect(html).toContain('data-planner-notes-toggle');
    expect(html).not.toContain('data-planner-notes=');
    expect(html).toContain('max-w-3xl');
  });

  // MUTATION: drop the wide check and a phone gets a sidebar it has no room for.
  it('is offered on desktop and landscape tablet only', async () => {
    store.set('dg-planner-notes-sidebar', '1');
    expect(await render({ isTablet: true, isLandscape: true })).toContain('data-planner-notes=');
    expect(await render({ isTablet: true, isLandscape: false })).not.toContain('data-planner-notes');
    expect(await render({ isMobile: true })).not.toContain('data-planner-notes');
  });

  it('opens where this device left it, wider, with the pane waiting for a task', async () => {
    store.set('dg-planner-notes-sidebar', '1');
    const html = await render();
    expect(html).toContain('data-planner-notes-sidebar="open"');
    expect(html).toContain('max-w-6xl');
    expect(html).toContain('Select a task to see its notes here.');
    expect(html).toContain('Enter or double-click to edit');
  });
});
