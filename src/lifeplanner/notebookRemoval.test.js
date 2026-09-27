import { describe, expect, it } from 'vitest';
import { removeNotebookBlocks, restoreNotebookBlocks } from './notebookRemoval.js';

describe('atomic notebook block removal and undo', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id, visions: [{ id: `vision-${id}`, steps: [{ id: `step-${id}`, projectId: `project-${id}` }] }] }));
  it('restores nonadjacent blocks in order with their entire linked content', () => {
    const entries = [1, 3].map(index => ({ item: items[index], index }));
    const remaining = removeNotebookBlocks(items, entries.map(entry => entry.item));
    expect(remaining.map(item => item.id)).toEqual(['a', 'c']);
    const restored = restoreNotebookBlocks(remaining, entries, 100);
    expect(restored).toEqual(items);
    expect(restored[1]).toBe(items[1]);
    expect(items).toHaveLength(4);
  });
  it('rejects the whole deletion if any selected content changed concurrently', () => {
    const latest = items.map(item => item.id === 'd' ? { ...item, title: 'changed' } : item);
    expect(() => removeNotebookBlocks(latest, [items[1], items[3]])).toThrow('conflict');
    expect(latest).toHaveLength(4);
  });
  it('does not duplicate a restored identity or exceed the notebook limit', () => {
    expect(() => restoreNotebookBlocks(items, [{ item: items[1], index: 1 }], 100)).toThrow('conflict');
    expect(() => restoreNotebookBlocks(items.slice(0, 3), [{ item: items[3], index: 3 }], 3)).toThrow('limit');
  });
});
