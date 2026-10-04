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

  // A click shows the details first, as WEEK's chip does; it never jumps
  // to JOBO, and never opens the task editor (a past record is no edit
  // target outside JOBO).
  it('a click opens its details, not JOBO', () => {
    const setViewMode = vi.fn();
    const openJoboAt = vi.fn();
    const stopPropagation = vi.fn();
    clickCard({ setViewMode, openJoboAt }, { stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(openJoboAt).not.toHaveBeenCalled();
    expect(setViewMode).not.toHaveBeenCalled();
  });
});

describe('PastDoDetails, the popup in DAY, MULTI and WEEK', () => {
  it('shows what was recorded and a button into JOBO', () => {
    const html = render(<PastDoDetails item={item} onClose={() => {}} />);
    expect(html).toContain('jobo.past.recorded:09:30–10:15');
    expect(html).toContain('jobo.view.progress.partial');
    expect(html).toContain('jobo.past.open');
  });

  // MUTATION: drop the minute and JOBO opens at now, not at the Do.
  it('opens JOBO on the Do\'s date, at its time', () => {
    const openJoboAt = vi.fn();
    const onClose = vi.fn();
    clickOpen({ openJoboAt }, onClose);
    expect(onClose).toHaveBeenCalled();
    expect(openJoboAt).toHaveBeenCalledWith({ date: '2026-09-24', minute: 9 * 60 + 30 });
  });

  it('still opens JOBO on the date where the app offers no time request', () => {
    const setViewMode = vi.fn();
    const setSelectedDate = vi.fn();
    clickOpen({ setViewMode, setSelectedDate }, () => {});
    expect(setSelectedDate).toHaveBeenCalledWith(new Date('2026-09-24T12:00:00'));
    expect(setViewMode).toHaveBeenCalledWith('jobo');
  });
});

it('exports the stripes JOBO\'s own cards use', () => {
  expect(DO_STRIPES).toMatch(/^repeating-linear-gradient/);
});

// Server rendering has no events, so a probe component calls the component
// as a function (its hooks run inside the probe's render) and fires the
// handler on the element it returns.
// Fired once: a state change during the render renders the probe again.
function probe(ctx, fire) {
  let fired = false;
  const Probe = () => { if (!fired) { fired = true; fire(); } return null; };
  renderToStaticMarkup(
    <DayPlannerContext.Provider value={{ formatTime: (v) => v, ...ctx }}><Probe /></DayPlannerContext.Provider>,
  );
}
// The card is the first child of what PastDoCard returns (its popup follows).
function clickCard(ctx, event = { stopPropagation() {} }) {
  probe(ctx, () => PastDoCard({ item, style: {} }).props.children[0].props.onClick(event));
}
function clickOpen(ctx, onClose) {
  const findButton = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(findButton).find(Boolean) || null;
    if (node.type === 'button') return node;
    return findButton(node.props?.children);
  };
  probe(ctx, () => findButton(PastDoDetails({ item, onClose })).props.onClick({ stopPropagation() {} }));
}
