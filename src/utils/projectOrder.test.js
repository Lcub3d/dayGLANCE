import { describe, it, expect } from 'vitest';
import { sortByProjectOrder, applyProjectReorder, orderProjectTasks, sortProjectsByOrder, projectReorderIds, topProjectOrder, sendToBottomIds } from './projectOrder.js';
import { mergeTaskArrays } from '../mergeSync.js';

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

  it('a drop that changes nothing is a no-op: no stamp, no push', () => {
    const first = applyProjectReorder(inbox, ['a', 'b', 'c'], NOW);
    const again = applyProjectReorder(first, ['a', 'b', 'c'], '2026-09-08T21:00:00.000Z');
    expect(again).toBe(first);
  });

  it('any change stamps the WHOLE group, not only the rows whose number moved', () => {
    const first = applyProjectReorder(inbox, ['a', 'b', 'c'], NOW);
    const later = '2026-09-08T21:00:00.000Z';
    // Swapping b and c leaves a at 0, and it is stamped anyway.
    const out = applyProjectReorder(first, ['a', 'c', 'b'], later);
    for (const id of ['a', 'b', 'c']) expect(out.find((x) => x.id === id).lastModified).toBe(later);
    expect(out.find((x) => x.id === 'other1')).toBe(first[0]);
  });

  it('ids not in the inbox are ignored; the rest still renumber', () => {
    const out = applyProjectReorder(inbox, ['ghost', 'b', 'a', 'c'], NOW);
    expect(out.find((x) => x.id === 'b').projectOrder).toBe(10);
    expect(out.find((x) => x.id === 'a').projectOrder).toBe(20);
    expect(out).toHaveLength(inbox.length);
  });
});

describe('reorders on two devices converge (the order held on one device, reshuffled on the next)', () => {
  // Each device keeps its own copy; sync keeps the newer copy of each task
  // (mergeTaskArrays, the file tier's rule, and the vault tier's per-row pick).
  const start = [t('a', { projectOrder: 0 }), t('b', { projectOrder: 10 }), t('c', { projectOrder: 20 })];
  const merge = (x, y) => mergeTaskArrays(x, y, {}).merged;
  const order = (list) => sortByProjectOrder(list).map((x) => x.id);

  it('two stale reorders resolve to the newer one as a whole, with no tied numbers', () => {
    const onX = applyProjectReorder(start, ['b', 'a', 'c'], '2026-09-08T20:00:00.000Z');   // X: b first
    const onY = applyProjectReorder(start, ['a', 'c', 'b'], '2026-09-08T21:00:00.000Z');   // Y, later, never saw X: b last
    const both = [merge(onX, onY), merge(onY, onX)];
    for (const merged of both) {
      expect(order(merged)).toEqual(['a', 'c', 'b']);
      expect(new Set(merged.map((x) => x.projectOrder)).size).toBe(3);
    }
  });

  it('completed tasks keep a number after the open ones, so un-completing one cannot collide', () => {
    const inbox = [t('a', { projectOrder: 0 }), t('done', { projectOrder: 10, completed: true }), t('b', { projectOrder: 20 })];
    const ids = projectReorderIds(['b', 'a'], inbox);
    expect(ids).toEqual(['b', 'a', 'done']);
    const out = applyProjectReorder(inbox, ids, '2026-09-08T20:00:00.000Z');
    const reopened = out.map((x) => (x.id === 'done' ? { ...x, completed: false } : x));
    expect(order(reopened)).toEqual(['b', 'a', 'done']);
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

describe('topProjectOrder', () => {
  it('puts a new task above the lowest number, so it sorts first', () => {
    const inbox = [t('a', { projectOrder: 0 }), t('b', { projectOrder: 10 }), t('c')];
    const order = topProjectOrder(inbox);
    expect(order).toBe(-10);
    expect(sortByProjectOrder([...inbox, t('new', { projectOrder: order })]).map((x) => x.id)).toEqual(['new', 'a', 'b', 'c']);
  });

  it('tops a list with no numbers, and an empty one', () => {
    const inbox = [t('a'), t('b')];
    expect(sortByProjectOrder([...inbox, t('new', { projectOrder: topProjectOrder(inbox) })]).map((x) => x.id)).toEqual(['new', 'a', 'b']);
    expect(topProjectOrder([])).toBe(0);
  });
});

describe('sendToBottomIds', () => {
  it('moves the task below the other open tasks, completed ones still last', () => {
    const inbox = [t('a', { projectOrder: 10 }), t('new', { projectOrder: 0 }), t('b'), t('done', { completed: true, projectOrder: 20 })];
    const ids = sendToBottomIds(inbox, 'new');
    expect(ids).toEqual(['a', 'b', 'new', 'done']);
    expect(sortByProjectOrder(applyProjectReorder(inbox, ids, 'now')).map((x) => x.id)).toEqual(['a', 'b', 'new', 'done']);
  });

  it('does nothing for a task that is no longer open in this inbox', () => {
    expect(sendToBottomIds([t('a'), t('x', { completed: true })], 'x')).toBeNull();
    expect(sendToBottomIds([t('a')], 'gone')).toBeNull();
  });
});
