import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PriorityTimeline from './PriorityTimeline.jsx';
import {
  buildPrioritySegments,
  buildPriorityTimeline,
  priorityColor,
  priorityRank,
  visibleSegment,
} from './TimelineComparison.js';

const item = (startMinute, endMinute, priority, id = `${startMinute}:${endMinute}:${priority}`) => ({
  id,
  startMinute,
  endMinute,
  task: priority === undefined ? undefined : { id: `task-${id}`, priority },
});

describe('priority timeline helpers', () => {
  it('maps native priority direction to the requested P1..P4 colours', () => {
    expect(priorityRank(3)).toBe(3);
    expect(priorityRank(2)).toBe(2);
    expect(priorityRank(1)).toBe(1);
    expect(priorityRank(0)).toBe(0);
    expect(priorityColor(3)).toBe('#ff7775');
    expect(priorityColor(2)).toBe('#ffa834');
    expect(priorityColor(1)).toBe('#609bef');
    expect(priorityColor(0)).toBe('#b3b3b3');
  });

  it('takes the highest priority only inside overlap, preserving the gaps', () => {
    const segments = buildPrioritySegments([
      item(9 * 60, 11 * 60, 1, 'blue'),
      item(10 * 60, 12 * 60, 3, 'red'),
    ]);
    expect(segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ startMinute: 540, endMinute: 600, priority: 1 }),
      expect.objectContaining({ startMinute: 600, endMinute: 720, priority: 3 }),
      expect.objectContaining({ startMinute: 720, endMinute: 1440, kind: 'gap' }),
    ]));
    expect(segments.find((segment) => segment.startMinute === 0 && segment.endMinute === 540)?.kind).toBe('gap');
  });

  it('does not turn a zero-length row into a coloured segment, and keeps priority zero', () => {
    const segments = buildPrioritySegments([
      item(120, 120, 3, 'zero'),
      item(120, 180, 0, 'default'),
    ]);
    expect(segments.some((segment) => segment.startMinute === segment.endMinute)).toBe(false);
    expect(segments).toContainEqual(expect.objectContaining({ startMinute: 120, endMinute: 180, priority: 0, color: '#b3b3b3' }));
  });

  it('clips cross-day ranges to the visible day and uses real minutes', () => {
    const segments = buildPrioritySegments([item(-30, 30, 2, 'before'), item(1430, 1470, 1, 'after')]);
    expect(segments).toContainEqual(expect.objectContaining({ startMinute: 0, endMinute: 30, priority: 2 }));
    expect(segments).toContainEqual(expect.objectContaining({ startMinute: 1430, endMinute: 1440, priority: 1 }));
    expect(visibleSegment({ startMinute: 0, endMinute: 1, priority: 1, kind: 'priority', color: '#609bef' }, 0, 60, 1440)?.height).toBe(1);
  });

  it('omits historical plan bars while keeping unlinked Do neutral', () => {
    const timeline = buildPriorityTimeline({
      plans: [
        { id: 'current', startMinute: 540, endMinute: 600, historical: false, task: { priority: 2 } },
        { id: 'history', startMinute: 540, endMinute: 600, historical: true, task: { priority: 3 } },
      ],
      timedRecords: [item(540, 600, undefined, 'unlinked')],
    });
    expect(timeline.plan).toContainEqual(expect.objectContaining({ startMinute: 540, endMinute: 600, priority: 2 }));
    expect(timeline.plan).not.toContainEqual(expect.objectContaining({ startMinute: 540, endMinute: 600, priority: 3 }));
    expect(timeline.do).toContainEqual(expect.objectContaining({ startMinute: 540, endMinute: 600, priority: 0, color: '#b3b3b3' }));
  });
});

describe('PriorityTimeline', () => {
  it('renders two pointer-transparent halves and real-time segments', () => {
    const html = renderToStaticMarkup(<PriorityTimeline
      plans={[{ id: 'p', startMinute: 540, endMinute: 600, historical: false, task: { priority: 3 } }]}
      timedRecords={[item(570, 630, 1, 'd')]}
      startHour={8}
      scale={60}
      height={1000}
    />);
    expect(html).toContain('data-jobo-priority-timeline="true"');
    expect(html).toContain('data-jobo-priority-half="plan"');
    expect(html).toContain('data-jobo-priority-half="do"');
    expect(html).toContain('data-jobo-priority-segment="plan"');
    expect(html).toContain('data-jobo-priority-segment="do"');
    expect(html).toContain('--jobo-priority-color:#ff7775');
    expect(html).toContain('--jobo-priority-color:#609bef');
  });
});
