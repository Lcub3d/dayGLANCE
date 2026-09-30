import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, values) => (values?.range ? `${key}:${values.range}` : key) }) }));
const { default: PastDoCard, PastDoDetails, DO_STRIPES } = await import('./PastDoCard.jsx');

// The recorded Do on a past day in DAY, MULTI and WEEK (slice 6): striped in
// its task's colour, read-only, and a way into JOBO.
const item = {
  id: 'jobo-do:manual:1:2026-09-24', title: 'Write the report #work', color: 'bg-blue-500', date: '2026-09-24',
  startTime: '09:30', duration: 45, joboDo: true, joboRecordId: 'manual:1', joboProgress: 'partial',
};
const render = (node, ctx = {}) => renderToStaticMarkup(
  <DayPlannerContext.Provider value={{ formatTime: (v) => v, ...ctx }}>{node}</DayPlannerContext.Provider>,
);

describe('PastDoCard', () => {
  it('is striped in the task\'s colour, with the recorded interval and progress, and no task controls', () => {
    const html = render(<PastDoCard item={item} style={{ top: '10px', height: '60px' }} />);
    expect(html).toContain('data-jobo-past-do="manual:1"');
    expect(html).toContain('bg-blue-500');
    expect(html).toContain('repeating-linear-gradient');
    expect(html).toContain('jobo.past.recorded:09:30–10:15');
    expect(html).toContain('09:30–10:15 · jobo.view.progress.partial');
    expect(html).toContain('Write the report');
    expect(html).not.toContain('#work');
    expect(html).toContain('draggable="false"');
    expect(html).not.toMatch(/type="checkbox"|data-ctx-menu/);
  });

  it('uses a neutral colour for unlinked work, and drops the time line on a short card', () => {
    const html = render(<PastDoCard item={{ ...item, color: null }} style={{}} showTime={false} />);
    expect(html).toContain('bg-gray-500');
    expect(html).not.toContain('lucide-clock');
  });

  // MUTATION: open the task editor instead and a past record becomes an
  // edit target outside JOBO.
  it('opens JOBO on the Do\'s date when clicked', () => {
    const setViewMode = vi.fn();
    const setSelectedDate = vi.fn();
    clickCard({ setViewMode, setSelectedDate });
    expect(setSelectedDate).toHaveBeenCalledWith(new Date('2026-09-24T12:00:00'));
    expect(setViewMode).toHaveBeenCalledWith('jobo');
  });
});

describe('PastDoDetails, WEEK\'s popup', () => {
  it('shows what was recorded and a button into JOBO', () => {
    const html = render(<PastDoDetails item={item} onClose={() => {}} />);
    expect(html).toContain('jobo.past.recorded:09:30–10:15');
    expect(html).toContain('jobo.view.progress.partial');
    expect(html).toContain('jobo.past.open');
  });
});

it('exports the stripes JOBO\'s own cards use', () => {
  expect(DO_STRIPES).toMatch(/^repeating-linear-gradient/);
});

// Server rendering has no events, so a probe component calls the card as a
// function (its hooks run inside the probe's render) and fires its onClick.
function clickCard(ctx) {
  const Probe = () => {
    PastDoCard({ item, style: {} }).props.onClick({ stopPropagation() {} });
    return null;
  };
  renderToStaticMarkup(
    <DayPlannerContext.Provider value={{ formatTime: (v) => v, ...ctx }}><Probe /></DayPlannerContext.Provider>,
  );
}
