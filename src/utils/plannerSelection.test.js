import { describe, it, expect } from 'vitest';
import { isSelectionKey, moveSelection } from './plannerSelection.js';

const lists = [
  { column: 'scheduled', ids: ['s1', 's2', 's3'] },
  { column: 'unscheduled', ids: ['u1', 'u2'] },
];

describe('planner selection by keyboard', () => {
  it('starts on the first task of the first column with one', () => {
    expect(moveSelection(lists, null, 'ArrowDown')).toBe('s1');
    expect(moveSelection([{ column: 'scheduled', ids: [] }, lists[1]], null, 'ArrowUp')).toBe('u1');
    expect(moveSelection([], null, 'ArrowDown')).toBeNull();
  });

  it('moves up and down within a column and stops at its ends', () => {
    expect(moveSelection(lists, 's1', 'ArrowDown')).toBe('s2');
    expect(moveSelection(lists, 's3', 'ArrowDown')).toBe('s3');
    expect(moveSelection(lists, 's1', 'ArrowUp')).toBe('s1');
    expect(moveSelection(lists, 'u2', 'ArrowUp')).toBe('u1');
  });

  // MUTATION: keep the row index without clamping and Right from the third
  // scheduled task selects nothing.
  it('switches columns at the same row, or the last task of a shorter column', () => {
    expect(moveSelection(lists, 's2', 'ArrowRight')).toBe('u2');
    expect(moveSelection(lists, 's3', 'ArrowRight')).toBe('u2');
    expect(moveSelection(lists, 'u1', 'ArrowLeft')).toBe('s1');
    expect(moveSelection(lists, 'u1', 'ArrowRight')).toBe('u1');
    expect(moveSelection(lists, 's1', 'ArrowLeft')).toBe('s1');
  });

  it('treats a selection that left the lists as none, and ignores other keys', () => {
    expect(moveSelection(lists, 'gone', 'ArrowDown')).toBe('s1');
    expect(moveSelection(lists, 's2', 'Enter')).toBe('s2');
    expect(isSelectionKey('Enter')).toBe(false);
  });
});
