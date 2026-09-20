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

// The PLANNER body is a flex COLUMN with a bounded height, so a section that
// does not opt out of shrinking is squashed when the content overflows
// instead of the body scrolling past it. hyperGLANCE clips its own overflow,
// which drops its automatic minimum size to zero: it collapsed to its two
// border pixels and every setting inside it became unreachable, worst on the
// projects with the most tasks (#1753). These assertions pin the opt-out on
// every section, so the body scrolls and no section is silently flattened.

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

const render = async ({ isMobile = false, scheduledHidden = false } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      isMobile, isTablet: false, darkMode: false, use24HourClock: false,
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

describe('ProjectPlanner layout', () => {
  it('scrolls its body on desktop rather than squashing the sections inside it', async () => {
    const html = await render();
    expect(html).toContain('max-h-[85vh]');
    expect(html).toContain(DESKTOP_BODY);
    const children = directChildren(html, DESKTOP_BODY);
    expect(children.length).toBeGreaterThan(2);
    for (const child of children) expect(child).toContain('flex-shrink-0');
  });

  it('keeps every section unshrinkable with the SCHEDULED list hidden too', async () => {
    const html = await render({ scheduledHidden: true });
    const children = directChildren(html, DESKTOP_BODY);
    expect(children.some(c => c.includes('hover:underline'))).toBe(true); // the Show Scheduled affordance
    for (const child of children) expect(child).toContain('flex-shrink-0');
  });

  it('gives hyperGLANCE, which clips its own overflow, an explicit shrink opt-out', async () => {
    const html = await render();
    const hg = html.match(/<div class="rounded-xl border [^"]*overflow-hidden[^"]*"/)?.[0] ?? '';
    expect(hg).toContain('flex-shrink-0');
    expect(html).toContain('hyperGLANCE');
  });

  it('does not let the mobile sheet shrink its header or its body either', async () => {
    const html = await render({ isMobile: true });
    const sheet = html.match(/<div class="relative bg-white[^>]*>/)?.[0] ?? '';
    expect(sheet).toContain('overflow-y-auto'); // the sheet is the scroller on mobile
    const children = directChildren(html, sheet);
    expect(children.length).toBe(2); // header + body
    for (const child of children) expect(child).toContain('flex-shrink-0');
    // …and the body's own sections, which on mobile include the column tabs.
    const sections = directChildren(html, bodyTag(html));
    expect(sections.some(c => c.includes('p-0.5'))).toBe(true); // the Scheduled/Unscheduled tabs
    for (const section of sections) expect(section).toContain('flex-shrink-0');
  });
});
