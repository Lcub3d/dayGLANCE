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

  // JOBO has no phone layout until slice 8.
  it('has no way to JOBO where there is none', () => {
    expect(panel(two, null)).not.toContain('data-do-open-jobo');
  });
});
