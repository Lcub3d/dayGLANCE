import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SpaceSwitcher, { GoalsSpaceTitle } from './SpaceSwitcher.jsx';

const fixture = vi.hoisted(() => ({ features: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => ({ darkMode: false, textPrimary: 'text-stone-900', textSecondary: 'text-stone-500' }),
}));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts && 'count' in opts ? `${key}:${opts.count}` : key),
  }),
}));

const buttons = (html) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);

beforeEach(() => {
  fixture.features = { desktopSpace: 'calendar', setDesktopSpace: vi.fn(), goalsProjectsEnabled: true, setGoalsProjectsEnabled: vi.fn() };
});

describe('SpaceSwitcher', () => {
  it('is a two-button segmented control that opts out of the Electron drag region', () => {
    const html = renderToStaticMarkup(<SpaceSwitcher />);
    expect(html).toContain('role="group"');
    expect(html).toContain('-webkit-app-region:no-drag');
    const [calendar, goals] = buttons(html);
    expect(buttons(html)).toHaveLength(2);
    expect(calendar).toContain('aria-pressed="true"');
    expect(goals).toContain('aria-pressed="false"');
    // Tooltips read "Calendar · G toggles" / "Goals & Projects · G toggles" (D2).
    expect(calendar).toContain('title="goals.spaceCalendar  ·  goals.spaceToggleHint"');
    expect(goals).toContain('title="goals.dashboardTitle  ·  goals.spaceToggleHint"');
  });

  it('presses the Goals button while the Goals space is active', () => {
    fixture.features.desktopSpace = 'goals';
    const [calendar, goals] = buttons(renderToStaticMarkup(<SpaceSwitcher />));
    expect(calendar).toContain('aria-pressed="false"');
    expect(goals).toContain('aria-pressed="true"');
  });

  it('launches in the Calendar space when nothing has set a space yet (D3)', () => {
    fixture.features = { goalsProjectsEnabled: true };
    const [calendar] = buttons(renderToStaticMarkup(<SpaceSwitcher />));
    expect(calendar).toContain('aria-pressed="true"');
  });

  it('is not rendered at all while Goals & Projects is off in Settings', () => {
    fixture.features = { desktopSpace: 'calendar', setDesktopSpace: vi.fn(), goalsProjectsEnabled: false };
    expect(renderToStaticMarkup(<SpaceSwitcher />)).toBe('');
    fixture.features = {};
    expect(renderToStaticMarkup(<SpaceSwitcher />)).toBe('');
  });
});

describe('GoalsSpaceTitle', () => {
  it('counts active goals and projects the current user can see, never archived ones', () => {
    fixture.features = {
      goals: [{ id: 'a' }, { id: 'b', status: 'archived' }, { id: 'c', hidden: true }],
      projects: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', status: 'archived' }],
      isVisibleForUser: (item) => !item.hidden,
    };
    const html = renderToStaticMarkup(<GoalsSpaceTitle />);
    expect(html).toContain('goals.dashboardTitle');
    expect(html).toContain('goals.goalCount:1 · goals.projectCount:2');
  });
});
