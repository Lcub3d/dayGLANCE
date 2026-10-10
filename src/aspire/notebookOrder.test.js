import { describe, expect, it } from 'vitest';
import { moveNotebookItem, moveNotebookItems } from './notebookOrder.js';

const rows = (...ids) => ids.map(id => ({ id }));
const order = items => items.map(item => item.id);

describe('moveNotebookItem', () => {
  it.each([
    ['a', 'd', true, ['b', 'c', 'd', 'a']],
    ['d', 'a', false, ['d', 'a', 'b', 'c']],
    ['b', 'd', false, ['a', 'c', 'b', 'd']],
    ['d', 'b', true, ['a', 'b', 'd', 'c']],
    ['b', 'c', false, ['a', 'b', 'c', 'd']],
    ['c', 'b', true, ['a', 'b', 'c', 'd']],
  ])('moves %s relative to %s (after: %s)', (id, target, after, expected) => {
    const items = rows('a', 'b', 'c', 'd');
    const moved = moveNotebookItem(items, id, target, after);
    expect(order(moved)).toEqual(expected);
    expect(moved).not.toBe(items);
    for (const item of items) expect(moved.find(row => row.id === item.id)).toBe(item);
    expect(order(items)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('defaults to inserting before the target using the current order', () => {
    expect(order(moveNotebookItem(rows('a', 'b', 'c'), 'c', 'a'))).toEqual(['c', 'a', 'b']);
  });

  it.each([false, true])('returns the original array when dropped on itself (after: %s)', after => {
    const items = rows('a', 'b', 'c');
    expect(moveNotebookItem(items, 'b', 'b', after)).toBe(items);
  });
});

describe('moveNotebookItems', () => {
  it.each([
    [['b', 'c'], 'a', false, ['b', 'c', 'a', 'd']],
    [['b', 'c'], 'd', true, ['a', 'd', 'b', 'c']],
    [['a', 'c'], 'd', false, ['b', 'a', 'c', 'd']],
    [['c', 'a'], 'd', true, ['b', 'd', 'a', 'c']],
    [['d', 'b'], 'a', false, ['b', 'd', 'a', 'c']],
  ])('moves %j as one block in current item order', (movingIds, target, after, expected) => {
    const items = rows('a', 'b', 'c', 'd');
    const moved = moveNotebookItems(items, movingIds, target, after);
    expect(order(moved)).toEqual(expected);
    for (const item of items) expect(moved.find(row => row.id === item.id)).toBe(item);
    expect(order(items)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('defaults to inserting the block before the target', () => {
    expect(order(moveNotebookItems(rows('a', 'b', 'c'), ['c', 'b'], 'a'))).toEqual(['b', 'c', 'a']);
  });

  it.each([false, true])('returns the original array when the target is selected (after: %s)', after => {
    const items = rows('a', 'b', 'c');
    expect(moveNotebookItems(items, ['c', 'b'], 'c', after)).toBe(items);
    expect(moveNotebookItems(items, ['c', 'a', 'b'], 'a', after)).toBe(items);
  });

  it('does not mutate frozen items, nested content, selections or snapshots', () => {
    const items = Object.freeze(['a', 'b', 'c', 'd'].map(id => Object.freeze({
      id, content: Object.freeze({ text: id }),
    })));
    const movingIds = Object.freeze(['c', 'a']);
    const expectedIds = Object.freeze(['a', 'b', 'c', 'd']);
    const moved = moveNotebookItems(items, movingIds, 'd', true, expectedIds);
    expect(moved).toEqual([items[1], items[3], items[0], items[2]]);
    for (const item of items) expect(moved.find(row => row.id === item.id)).toBe(item);
    expect(order(items)).toEqual(['a', 'b', 'c', 'd']);
    expect(movingIds).toEqual(['c', 'a']);
    expect(expectedIds).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('expectedIds snapshots', () => {
  it.each([
    ['b', 'a', false, ['hidden-1', 'b', 'a', 'hidden-2', 'hidden-3', 'c', 'hidden-4']],
    ['c', 'a', true, ['hidden-1', 'a', 'c', 'hidden-2', 'b', 'hidden-3', 'hidden-4']],
  ])('moves %s relative to %s while retaining interleaved hidden rows', (id, target, after, expected) => {
    const items = rows('hidden-1', 'a', 'hidden-2', 'b', 'hidden-3', 'c', 'hidden-4');
    const moved = moveNotebookItem(items, id, target, after, ['a', 'b', 'c']);
    expect(order(moved)).toEqual(expected);
    for (const item of items) expect(moved.find(row => row.id === item.id)).toBe(item);
    expect(order(items)).toEqual(['hidden-1', 'a', 'hidden-2', 'b', 'hidden-3', 'c', 'hidden-4']);
  });

  it('moves a scoped selection in current order without moving hidden rows into the block', () => {
    const items = rows('a', 'hidden-1', 'b', 'hidden-2', 'c', 'd');
    const moved = moveNotebookItems(items, ['c', 'a'], 'd', true, ['a', 'b', 'c', 'd']);
    expect(order(moved)).toEqual(['hidden-1', 'b', 'hidden-2', 'd', 'a', 'c']);
    expect(moved.filter(item => item.id.startsWith('hidden'))).toEqual([items[1], items[3]]);
  });

  it('keeps the latest content and unrelated rows inserted since the snapshot', () => {
    const expectedIds = ['a', 'b', 'c'];
    const updated = { id: 'a', content: { text: 'Updated elsewhere' } };
    const items = [updated, ...rows('new', 'b', 'c')];
    const moved = moveNotebookItem(items, 'c', 'a', false, expectedIds);
    expect(order(moved)).toEqual(['c', 'a', 'new', 'b']);
    expect(moved[1]).toBe(updated);
    expect(moved[1].content).toBe(updated.content);
    expect(moved[2]).toBe(items[1]);
  });

  it.each([
    ['hidden-2', 'a', 'b', 'hidden-1', 'c'],
    ['a', 'b', 'c'],
  ])('ignores reorders or removals outside the captured group: %j', (...ids) => {
    const items = rows(...ids);
    const moved = moveNotebookItem(items, 'b', 'a', false, ['a', 'b', 'c']);
    expect(order(moved).filter(id => ['a', 'b', 'c'].includes(id))).toEqual(['b', 'a', 'c']);
    expect(moved.filter(item => item.id.startsWith('hidden')))
      .toEqual(items.filter(item => item.id.startsWith('hidden')));
  });

  it.each([
    ['c', 'b', 'a'],
    ['b', 'c'],
    ['a', 'c'],
    ['a', 'b'],
  ])('rejects a reordered or removed group member: %j', (...ids) => {
    const items = rows(...ids);
    expect(() => moveNotebookItem(items, 'a', 'b', false, ['a', 'b', 'c'])).toThrow('conflict');
    expect(order(items)).toEqual(ids);
  });

  it('rejects a stale batch snapshot before treating a selected target as a no-op', () => {
    expect(() => moveNotebookItems(rows('c', 'b', 'a'), ['c', 'b'], 'c', false, ['a', 'b', 'c']))
      .toThrow('conflict');
  });

  it('rejects duplicate IDs in a snapshot', () => {
    expect(() => moveNotebookItem(rows('a', 'b'), 'a', 'b', false, ['a', 'a', 'b']))
      .toThrow('conflict');
  });
});

describe('invalid selections and targets', () => {
  it.each([[], null, undefined, ['a', 'a'], ['absent'], ['a', 'absent']])('rejects selection %j', movingIds => {
    const items = rows('a', 'b', 'c');
    expect(() => moveNotebookItems(items, movingIds, 'c')).toThrow('missing');
    expect(order(items)).toEqual(['a', 'b', 'c']);
  });

  it.each([
    [['c'], 'a'],
    [['a', 'c'], 'b'],
    [['a'], 'c'],
    [['a'], 'absent'],
  ])('rejects a selection or target outside the captured group: %j, %s', (movingIds, target) => {
    expect(() => moveNotebookItems(rows('a', 'b', 'c'), movingIds, target, false, ['a', 'b']))
      .toThrow('missing');
  });

  it('rejects an invalid selection even when it contains the target', () => {
    expect(() => moveNotebookItems(rows('a', 'b'), ['a', 'a'], 'a')).toThrow('missing');
    expect(() => moveNotebookItems(rows('a', 'b'), ['a', 'absent'], 'a')).toThrow('missing');
  });

  it('rejects a missing single item or target', () => {
    expect(() => moveNotebookItem(rows('a', 'b'), 'absent', 'b')).toThrow('missing');
    expect(() => moveNotebookItem(rows('a', 'b'), 'a', 'absent')).toThrow('missing');
  });

  it('rejects an empty list or empty scope', () => {
    expect(() => moveNotebookItem([], 'a', 'b')).toThrow('missing');
    expect(() => moveNotebookItem(rows('a', 'b'), 'a', 'b', false, [])).toThrow('missing');
  });
});
