import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

// SCHED's Do badge. Clicks and the popover's placement are checked in the
// browser; these pin what renders.
const fixture = {};
vi.mock('../../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, o) => (o ? `${key}${JSON.stringify(o)}` : key) }) }));
const { default: DoSessionsBadge, DoSessionsPanel, sessionsTotal } = await import('./DoSessionsBadge.jsx');

const task = { id: 't1', title: 'Write', date: '2026-10-02', color: 'bg-blue-500' };
const two = [
  { recordId: 'r1', startMinute: 570, endMinute: 615, progress: 'partial', clippedStart: false, clippedEnd: false },
  { recordId: 'r2', startMinute: 840, endMinute: 870, progress: 'completed', clippedStart: false, clippedEnd: false },
];
const render = (sessions, more = {}) => {
  fixture.ctx = { getDoSessionsForTask: () => sessions, formatTime: (v) => v, ...more };
  return renderToStaticMarkup(<DoSessionsBadge task={task} />);
};

describe('SCHED\'s Do badge', () => {
  it('renders nothing without timed Do (JOBO off, or none recorded)', () => {
    expect(render([])).toBe('');
    fixture.ctx = {};
    expect(renderToStaticMarkup(<DoSessionsBadge task={task} />)).toBe('');
  });

  it('is a striped pill in the task\'s colour showing the time recorded, its summary on hover', () => {
    const html = render(two);
    expect(sessionsTotal(two)).toBe(75);
    expect(html).toContain('data-do-badge="t1"');
    expect(html).toContain('bg-blue-500');
    expect(html).toContain('repeating-linear-gradient');
    expect(html).toMatch(/title="jobo\.sched\.badge\{&quot;count&quot;:2/);
    expect(html).toContain('aria-expanded="false"');
  });
});

// Lcub3d on #1726: watch the room it takes on narrow screens. A phone
// card's details row is already full when busy, so there the badge is a dot
// on the title line, which truncates to make room.
describe('where it sits', () => {
  const at = (placement, isMobile) => {
    fixture.ctx = { getDoSessionsForTask: () => two, formatTime: (v) => v, isMobile };
    return renderToStaticMarkup(<DoSessionsBadge task={task} placement={placement} />);
  };

  it('is the pill with the time in the details row, off a phone', () => {
    expect(at('meta', false)).toContain('px-1.5 py-1');
    expect(at('title', false)).toBe('');
  });

  // MUTATION: draw the meta placement on a phone and a busy card's details
  // row overflows at 360 and 390px, hiding its tags.
  it('is a dot with no text on the title line, on a phone', () => {
    expect(at('meta', true)).toBe('');
    const dot = at('title', true);
    expect(dot).toContain('w-3.5 h-3.5');
    expect(dot).not.toContain('px-1.5');
    expect(dot).toMatch(/<button[^>]*><\/button>/);
    expect(dot).toMatch(/aria-label="jobo\.sched\.badge/);
  });
});

describe('its panel', () => {
  const panel = (sessions, onOpenJobo) => renderToStaticMarkup(<DoSessionsPanel sessions={sessions} formatTime={(v) => v} onOpenJobo={onOpenJobo} />);

  it('lists each session with its times and progress, and the total for more than one', () => {
    const html = panel(two, () => {});
    expect(html).toContain('09:30–10:15');
    expect(html).toContain('jobo.view.progress.partial');
    expect(html).toContain('14:00–14:30');
    expect(html).toContain('common.completed');
    expect(html).toContain('jobo.sched.total');
    expect(html).toContain('data-do-open-jobo');
  });

  it('marks a session cut at midnight, and has no total for one session', () => {
    const html = panel([{ ...two[0], startMinute: 0, endMinute: 45, clippedStart: true }], () => {});
    expect(html).toContain('…00:00–00:45');
    expect(html).not.toContain('jobo.sched.total');
  });

  it('carries the plan history of a finished task the card folds in, under its own heading', () => {
    const planTask = { id: 't1', date: '2026-10-02', startTime: '14:00', duration: 60, completed: true, deferrals: 2,
      originalPlan: { date: '2026-09-29', startTime: '09:00', duration: 60 } };
    const html = panel(two, () => {});
    expect(html).not.toContain('data-do-plan-history');
    const folded = renderToStaticMarkup(<DoSessionsPanel sessions={two} formatTime={(v) => v} onOpenJobo={() => {}} planTask={planTask} />);
    expect(folded).toContain('data-do-plan-history');
    expect(folded).toContain('task.planHistory');
    expect(folded).toContain('task.originallyPlanned');
    expect(folded).toContain('task.deferredTimes');
    // the way to JOBO stays last
    expect(folded.indexOf('data-do-plan-history')).toBeLessThan(folded.indexOf('data-do-open-jobo'));
  });

  it('has no plan section for a folded task with nothing to tell', () => {
    const still = { id: 't1', date: '2026-10-02', startTime: '14:00', duration: 60, completed: true };
    expect(renderToStaticMarkup(<DoSessionsPanel sessions={two} planTask={still} />)).not.toContain('data-do-plan-history');
  });

  // JOBO has no phone layout until slice 8.
  it('has no way to JOBO where there is none', () => {
    expect(panel(two, null)).not.toContain('data-do-open-jobo');
  });
});
