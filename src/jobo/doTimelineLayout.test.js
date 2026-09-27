import { describe, expect, it } from 'vitest';
import { createDoRecord } from './core.js';
import { DO_POINT_HEIGHT_PX, layoutDoTimeline } from './doTimelineLayout.js';

const DATE = '2026-09-27';

function completion(id, createdAt, overrides = {}) {
  return createDoRecord({
    id,
    taskId: 'task-1',
    title: 'Completed task',
    source: 'completion',
    progress: 'completed',
    timing: 'untimed',
    date: DATE,
    startTime: null,
    endDate: null,
    endTime: null,
    planSnapshot: null,
    createdAt,
    updatedAt: createdAt,
    observedAt: createdAt,
    ...overrides,
  });
}

function pointItem(id, createdAt, overrides = {}) {
  const record = completion(id, createdAt, overrides);
  return { id, record, groupKey: `group-${id}` };
}

function timedItem(id, startMinute, endMinute, overrides = {}) {
  return { id, startMinute, endMinute, record: { id: `record-${id}` }, ...overrides };
}

function byId(items, id) {
  return items.find(item => item.id === id);
}

describe('layoutDoTimeline', () => {
  it('keeps canonical fields and records while filtering points to the selected date', () => {
    const current = pointItem('point-current', `${DATE}T10:23:54Z`);
    const otherDay = pointItem('point-other-day', '2026-09-28T10:23:54Z');
    const timed = timedItem('timed', 600, 630, { custom: 'preserve-me' });
    const beforeTimed = { ...timed };
    const beforeRecord = current.record;

    const out = layoutDoTimeline([timed], [current, otherDay], { date: DATE, scale: 84 });
    const point = byId(out, current.id);
    const keptTimed = byId(out, timed.id);

    expect(out.map(item => item.id)).not.toContain(otherDay.id);
    expect(point).toMatchObject({ point: true, startMinute: 623, endMinute: 623, displayHeightPx: DO_POINT_HEIGHT_PX });
    expect(point.marker).toMatchObject({ date: DATE, startMinute: 623, endMinute: 623, point: true });
    expect(point.record).toBe(beforeRecord);
    expect(keptTimed).toMatchObject(beforeTimed);
    expect(timed).toEqual(beforeTimed);
    expect(current.record.timing).toBe('untimed');
    expect(current.record.startTime).toBeNull();
  });

  it('puts completion points at the same minute into separate columns', () => {
    const first = pointItem('point-a', `${DATE}T10:00:12Z`);
    const second = pointItem('point-b', `${DATE}T10:00:58Z`);
    const out = layoutDoTimeline([], [first, second], { date: DATE, scale: 84 });

    const a = byId(out, first.id);
    const b = byId(out, second.id);
    expect(a.columnCount).toBe(2);
    expect(b.columnCount).toBe(2);
    expect(new Set([a.leftPct, b.leftPct])).toEqual(new Set([0, 50]));
    expect(a.widthPct).toBe(50);
    expect(b.widthPct).toBe(50);
    expect(a.startMinute).toBe(a.endMinute);
    expect(b.startMinute).toBe(b.endMinute);
  });

  it('shares one layout with a timed item whose interval intersects a point footprint', () => {
    const point = pointItem('point', `${DATE}T10:00:00Z`);
    const timed = timedItem('timed', 595, 605);
    const out = layoutDoTimeline([timed], [point], { date: DATE, scale: 84 });

    const laidPoint = byId(out, point.id);
    const laidTimed = byId(out, timed.id);
    expect(laidPoint.columnCount).toBe(2);
    expect(laidTimed.columnCount).toBe(2);
    expect(laidPoint.leftPct).not.toBe(laidTimed.leftPct);
    expect(laidPoint.startMinute).toBe(600);
    expect(laidPoint.endMinute).toBe(600);
    expect(laidPoint.displayStartMinute).toBeLessThan(600);
  });

  it('uses the timed card minimum pixel footprint when it meets a point visually', () => {
    const point = pointItem('point', `${DATE}T10:00:00Z`);
    // The measured interval ends before the point, but its 40px card minimum
    // reaches into the point's 40px footprint at this scale.
    const shortTimed = timedItem('short', 580, 585);
    const out = layoutDoTimeline([shortTimed], [point], { date: DATE, scale: 84 });

    expect(byId(out, point.id).columnCount).toBe(2);
    expect(byId(out, shortTimed.id).columnCount).toBe(2);
    expect(byId(out, shortTimed.id).startMinute).toBe(580);
    expect(byId(out, shortTimed.id).endMinute).toBe(585);
  });

  it.each([1, 52, 84, 132, 240, undefined])('keeps the point footprint finite and at/after day start at scale %s', scale => {
    const point = pointItem('point', `${DATE}T00:00:00Z`);
    const out = layoutDoTimeline([], [point], { date: DATE, scale });
    const laidPoint = byId(out, point.id);

    expect(laidPoint.displayStartMinute).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(laidPoint.displayStartMinute)).toBe(true);
    expect(laidPoint.displayHeightPx).toBe(40);
    expect(laidPoint.startMinute).toBe(0);
    expect(laidPoint.endMinute).toBe(0);
  });
});
