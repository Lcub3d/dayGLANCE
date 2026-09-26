import { describe, it, expect } from 'vitest';
import { sortByProjectOrder, applyProjectReorder, orderProjectTasks, sortProjectsByOrder } from './projectOrder.js';

const t = (id, extra = {}) => ({ id, title: id, projectId: 'p1', lastModified: '2026-09-01T00:00:00.000Z', ...extra });

describe('sortByProjectOrder', () => {
  it('orders by the field, keeps unordered tasks after in array order, and is stable on ties', () => {
    const list = [t('c'), t('a', { projectOrder: 10 }), t('d'), t('b', { projectOrder: 0 }), t('e', { projectOrder: 10 })];
    expect(sortByProjectOrder(list).map((x) => x.id)).toEqual(['b', 'a', 'e', 'c', 'd']);
  });

  it('a list with no field at all keeps its order (the pre-field behavior)', () => {
    expect(sortByProjectOrder([t('x'), t('y')]).map((x) => x.id)).toEqual(['x', 'y']);
    expect(sortByProjectOrder(null)).toEqual([]);
  });
});

describe('applyProjectReorder', () => {
  const NOW = '2026-09-08T20:00:00.000Z';
  const inbox = [t('other1', { projectId: 'p2' }), t('a'), t('b'), t('other2', { projectId: 'p2' }), t('c')];

  it('renumbers the moved group, stamps the changed rows, and moves the array positions', () => {
    const out = applyProjectReorder(inbox, ['c', 'a', 'b'], NOW);
    expect(out.map((x) => x.id)).toEqual(['other1', 'c', 'a', 'other2', 'b']);   // the group's slots, new order
    expect(out.find((x) => x.id === 'c')).toMatchObject({ projectOrder: 0, lastModified: NOW });
    expect(out.find((x) => x.id === 'a')).toMatchObject({ projectOrder: 10, lastModified: NOW });
    expect(out.find((x) => x.id === 'b')).toMatchObject({ projectOrder: 20, lastModified: NOW });
    expect(out.find((x) => x.id === 'other1')).toBe(inbox[0]);                    // untouched rows are the same objects
    expect(sortByProjectOrder(out.filter((x) => x.projectId === 'p1')).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('a task already at its number is not re-stamped (no needless push)', () => {
    const first = applyProjectReorder(inbox, ['a', 'b', 'c'], NOW);
    const again = applyProjectReorder(first, ['a', 'b', 'c'], '2026-09-08T21:00:00.000Z');
    expect(again.find((x) => x.id === 'a')).toBe(first.find((x) => x.id === 'a'));
    expect(again.every((x) => x.lastModified !== '2026-09-08T21:00:00.000Z')).toBe(true);
  });

  it('ids not in the inbox are ignored; the rest still renumber', () => {
    const out = applyProjectReorder(inbox, ['ghost', 'b', 'a', 'c'], NOW);
    expect(out.find((x) => x.id === 'b').projectOrder).toBe(10);
    expect(out.find((x) => x.id === 'a').projectOrder).toBe(20);
    expect(out).toHaveLength(inbox.length);
  });
});

describe('orderProjectTasks', () => {
  it('lists open scheduled by date, open inbox by projectOrder, then the completed in the same groups', () => {
    const scheduled = [
      { id: 's-late', date: '2026-10-05' },
      { id: 's-done', date: '2026-09-01', completed: true },
      { id: 's-early', date: '2026-09-28' },
    ];
    const unscheduled = [
      { id: 'u-none' },
      { id: 'u-20', projectOrder: 20 },
      { id: 'u-done', projectOrder: 0, completed: true },
      { id: 'u-10', projectOrder: 10 },
    ];
    expect(orderProjectTasks(scheduled, unscheduled).map((t) => t.id))
      .toEqual(['s-early', 's-late', 'u-10', 'u-20', 'u-none', 's-done', 'u-done']);
  });

  it('tolerates missing lists and does not mutate its input', () => {
    const scheduled = [{ id: 'b', date: '2026-10-02' }, { id: 'a', date: '2026-10-01' }];
    expect(orderProjectTasks(scheduled, undefined).map((t) => t.id)).toEqual(['a', 'b']);
    expect(scheduled.map((t) => t.id)).toEqual(['b', 'a']);
    expect(orderProjectTasks(null, null)).toEqual([]);
  });
});

describe('sortProjectsByOrder', () => {
  it('orders by sortOrder with unordered projects after, in array order', () => {
    const projects = [{ id: 'x' }, { id: 'b', sortOrder: 2 }, { id: 'y' }, { id: 'a', sortOrder: 1 }];
    expect(sortProjectsByOrder(projects).map((p) => p.id)).toEqual(['a', 'b', 'x', 'y']);
  });
});
