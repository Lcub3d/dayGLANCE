import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import GoalDashboard from './GoalDashboard.jsx';

// The cards and the roadmap chart have their own concerns; here they are
// stand-ins so the assertions are about WHERE the space puts things.
vi.mock('../projects/ProjectCard.jsx', () => ({
  default: React.forwardRef(({ project, compact, onMoveToClick }, ref) => (
    <div ref={ref} data-project-card={project.id} data-compact={compact ? '1' : '0'} data-move-to={onMoveToClick ? '1' : '0'}>{project.title}</div>
  )),
}));
vi.mock('./GoalTimeline.jsx', () => ({
  default: ({ goals }) => <div data-goal-timeline={goals.map(g => g.id).join(',')} />,
}));

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

const GOALS = [
  { id: 'done', title: 'Shipped goal', status: 'completed', color: 'bg-green-500', targetDate: '2026-01-01' },
  { id: 'ios', title: 'Ship iOS Apps', status: 'active', color: 'bg-blue-500', areaId: 'dev', targetDate: '2099-01-01' },
  { id: 'electron', title: 'Ship Electron Apps', status: 'active', color: 'bg-purple-500', areaId: 'dev' },
  { id: 'old', title: 'Archived goal', status: 'archived' },
];
const PROJECTS = [
  { id: 'asc', title: 'App Store Connect', goalId: 'ios', status: 'active', sortOrder: 0 },
  { id: 'billing', title: 'Setup App Billing', goalId: 'ios', status: 'completed', sortOrder: 10 },
  { id: 'dg', title: 'dayGLANCE', status: 'active' },
  { id: 'gone', title: 'Archived project', status: 'archived' },
];

const planner = () => ({
  tasks: [{ id: 't1', projectId: 'dg', title: 'x' }], unscheduledTasks: [{ id: 't2', projectId: 'dg', title: 'y' }], recurringTasks: [],
  setTasks: vi.fn(), setUnscheduledTasks: vi.fn(),
  getTodayStr: () => '2026-09-22',
  showAddTask: false, setShowAddTask: vi.fn(), setShowNewTaskDeadlinePicker: vi.fn(),
  isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(),
});
const features = (overrides = {}) => ({
  goals: GOALS, projects: PROJECTS, setProjects: vi.fn(),
  areas: [{ id: 'dev', name: 'App Development', color: 'bg-orange-500', order: 0 }],
  goalsAreaFilter: 'all', setGoalsAreaFilter: vi.fn(), goalsViewMode: 'list', setGoalsViewMode: vi.fn(),
  goalsDashboardFocusId: null, setGoalsDashboardFocusId: vi.fn(),
  addGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn(),
  addProject: vi.fn(), updateProject: vi.fn(), moveProject: vi.fn(),
  plannerProjectId: null, setPlannerProjectId: vi.fn(),
  isVisibleForUser: () => true, multiUserEnabled: false, users: [],
  ...overrides,
});

let i18n;
beforeEach(async () => { i18n = i18n || await i18nFor('en'); });

const render = (props, feat = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={planner()}>
      <FeaturesContext.Provider value={features(feat)}>
        <SyncContext.Provider value={{ createProjectNote: vi.fn(), openInObsidian: vi.fn() }}>
          <GoalDashboard {...props} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);
const section = (html, marker) => {
  const start = html.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  return html.slice(start);
};
const cards = (html) => [...html.matchAll(/data-project-card="([^"]+)"/g)].map((m) => m[1]);
const rows = (html) => [...html.matchAll(/<button[^>]*data-goal-row="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], selected: m[0].includes('aria-pressed="true"') }));

describe('GoalDashboard desktop space', () => {
  it('renders the sidebar and the main area, not the old modal', () => {
    const html = render({ desktop: true, isActive: true });
    expect(html).toContain('data-goals-sidebar');
    expect(html).toContain('data-goals-main');
    expect(html).not.toContain('max-w-6xl');
    expect(html).not.toContain('bg-black/50');
    expect(html).not.toContain('goal-carousel');
  });

  it('lists the active goals in carousel order with the first active one selected (D6)', () => {
    const html = render({ desktop: true, isActive: true });
    // completed first, then by target date; archived never listed
    expect(rows(html)).toEqual([
      { id: 'done', selected: false },
      { id: 'ios', selected: true },
      { id: 'electron', selected: false },
    ]);
    const sidebar = html.slice(html.indexOf('data-goals-sidebar'), html.indexOf('data-goals-main'));
    expect(sidebar).toContain('App Development');
    expect(sidebar).toContain('Goals <span');
    expect(sidebar).toContain('>3</span>');
    // the Projects tab counts OPEN standalone projects
    expect(sidebar).toContain('Projects <span');
    expect(sidebar).toContain('>1</span>');
  });

  it('keeps the area filter, Manage Areas and Add Goal on the Goals tab of the sidebar (D8, D10)', () => {
    const html = render({ desktop: true, isActive: true });
    const sidebar = html.slice(html.indexOf('data-goals-sidebar'), html.indexOf('data-goals-main'));
    expect(sidebar).toContain('<select');
    expect(sidebar).toContain('All areas');
    expect(sidebar).toContain('aria-label="Manage Areas"');
    expect(sidebar).not.toContain('data-project-filter');
  });

  it('puts only List/Roadmap in the main toolbar; creating lives in the FAB, the card and Manage Areas', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    const toolbar = main.slice(0, main.indexOf('overflow-y-auto'));
    expect(toolbar).toContain(' List</button>');
    expect(toolbar).toContain(' Roadmap</button>');
    expect(toolbar).not.toContain('Add Area');
    expect(toolbar).not.toContain('Add Goal');
    expect(toolbar).not.toContain('Add Project');
    expect(main).toContain('overflow-y-auto');
    // the divider matches the calendar area's (border-x) and the toolbar row is
    // 46px plus its border like the sidebar tab row, so the lines meet
    expect(main).toContain('border-x border-stone-200');
    expect(main).toContain('height:var(--header-row-h);box-sizing:content-box');
  });

  it('stacks the FABs bottom-right over the main scroll area, contextual to the tab, above the Archived footer', () => {
    const html = render({ desktop: true, isActive: true });
    const main = section(html, 'data-goals-main');
    const fabs = main.slice(main.indexOf('data-goals-fabs'));
    expect(fabs).toContain('absolute bottom-6 right-6');
    expect(fabs).toContain('flex-col');
    expect(fabs).toContain('aria-label="Add Goal"');
    expect(main.indexOf('data-goals-fabs')).toBeLessThan(main.indexOf('data-archived-section'));
    expect(main).toContain('pb-28');
    const projects = section(render({ desktop: true, isActive: true, initialSidebarTab: 'projects' }), 'data-goals-fabs');
    expect(projects).toContain('aria-label="Add Project"');
    expect(html).not.toContain('bottom-6 left-4');
  });

  it('anchors the Archived section under the scroll area, expanding upward', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    const archived = main.slice(main.indexOf('data-archived-section'));
    expect(archived).toContain('flex flex-col-reverse');
    expect(main.indexOf('overflow-y-auto')).toBeLessThan(main.indexOf('data-archived-section'));
    expect(archived).toContain('aria-expanded="false"');
  });

  it('shows the selected goal card and only ITS project cards, with Move to… wired', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    expect(main).toContain('data-goal-list-view="ios"');
    expect(main).toContain('Ship iOS Apps');
    expect(cards(main)).toEqual(['asc', 'billing']);
    expect(main).toContain('data-project-card="billing" data-compact="1"');
    expect(main).toContain('data-move-to="1"');
    expect(main).not.toContain('dayGLANCE');
    // every goal row is a reassign drop target; the goal's group and its cards carry the move semantics too
    expect(render({ desktop: true, isActive: true })).toContain('data-move-goal="electron"');
    expect(main).toContain('data-move-goal="ios" data-move-before="asc"');
    // cards sit in a measured-column grid: one active + one done card here, each in
    // its own one-column grid capped at one card's max width (no ResizeObserver on
    // the server, so the default 3 columns apply and 1 < 3)
    expect(main).toContain('grid-template-columns:repeat(1, minmax(0, 1fr))');
    expect(main).toContain('max-width:560px');
    // cards are dealt into stacked columns, in order
    expect(main).toContain('data-card-column');
    expect(main).not.toContain('w-[260px]');
    expect(main).not.toContain('w-[325px]');
  });

  it('shows the empty state for a selected goal without projects', () => {
    const feat = { goals: GOALS.filter(g => g.id !== 'ios' && g.id !== 'done') };
    const main = section(render({ desktop: true, isActive: true }, feat), 'data-goals-main');
    expect(main).toContain('data-goal-list-view="electron"');
    expect(main).toContain('No projects linked to this goal yet');
    expect(cards(main)).toEqual([]);
  });

  it('honours the area filter for the list and the roadmap alike', () => {
    const html = render({ desktop: true, isActive: true }, { goalsAreaFilter: 'uncategorized' });
    expect(rows(html)).toEqual([{ id: 'done', selected: true }]);
    const roadmap = render({ desktop: true, isActive: true }, { goalsAreaFilter: 'dev', goalsViewMode: 'timeline' });
    expect(roadmap).toContain('data-goal-timeline="ios,electron"');
    expect(roadmap).not.toContain('data-goal-list-view');
  });

  it('on the Projects tab: Open | Completed with icons and count badges, rows with a ring, done/total and Stalled', () => {
    const html = render({ desktop: true, isActive: true, initialSidebarTab: 'projects' });
    const sidebar = html.slice(html.indexOf('data-goals-sidebar'), html.indexOf('data-goals-main'));
    const main = section(html, 'data-goals-main');
    // toolbar: no List/Roadmap; Open (active, white badge on blue) and Completed (blue badge)
    expect(main).not.toContain(' Roadmap</button>');
    expect(main).toContain('lucide-circle-dashed');
    expect(main).toContain('lucide-circle-check-big');
    expect(main).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Open<span class="[^"]*bg-white text-blue-600">1<\/span>/);
    expect(main).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?Completed<span class="[^"]*bg-blue-600 text-white">0<\/span>/);
    // the open standalone project's card is in the grid; completed ones are not
    expect(cards(main)).toEqual(['dg']);
    // sidebar row: progress ring, "done/total", and Stalled (open tasks, nothing completed, no createdAt)
    const row = sidebar.match(/<button[^>]*data-project-row="dg"[\s\S]*?<\/button>/)[0];
    expect(row).toContain('<svg width="18"');
    expect(row).toContain('>0/2</span>');
    expect(row).toContain('Stalled');
    // rows are separated by hairlines (none before the first)
    expect(sidebar.match(/data-row-divider/g) ?? []).toHaveLength(0); // one open standalone project: no divider
    // the filter field sits where the area filter sits on the Goals tab
    expect(sidebar).toContain('data-project-filter');
    expect(sidebar).toContain('placeholder="Filter projects…"');
  });

  it('keeps the sidebar tab across renders it was given, but starts on Goals by default', () => {
    expect(render({ desktop: true, isActive: true })).toContain(' Roadmap</button>');
  });

  it('deals cards into the columns in order and stacks each column', () => {
    // five open standalone projects, default 3 columns (no ResizeObserver on the server)
    const five = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, title: id, status: 'active', sortOrder: i }));
    const main = section(render({ desktop: true, isActive: true, initialSidebarTab: 'projects' }, { projects: five }), 'data-goals-main');
    expect(main).toContain('data-columns="3"');
    const columns = [...main.matchAll(/<div[^>]*data-card-column[^>]*>([\s\S]*?)<\/div><\/div><\/div>/g)];
    expect(columns.length).toBeGreaterThanOrEqual(1);
    const order = cards(main);
    // column 1 holds a and d, column 2 b and e, column 3 c: DOM order is column-major
    expect(order).toEqual(['a', 'd', 'b', 'e', 'c']);
  });

  it('lists the archived goals and projects under the main area', () => {
    const main = section(render({ desktop: true, isActive: true }), 'data-goals-main');
    expect(main).toContain('Archived (2)');
  });
});

describe('GoalDashboard embedded (phone) mode', () => {
  it('is unchanged: the carousel, no sidebar, no toolbar', () => {
    const html = render({ embedded: true, isActive: true });
    expect(html).toContain('goal-carousel');
    expect(html).not.toContain('data-goals-sidebar');
    expect(html).not.toContain('data-goals-main');
  });

  it('renders nothing outside either mode', () => {
    expect(render({})).toBe('');
  });
});
