import { describe, it, expect } from 'vitest';
import { noteFocusTarget } from './noteFocusTarget.js';

describe('noteFocusTarget', () => {
  it('is the task\'s own note when the title links none', () => {
    expect(noteFocusTarget({ showLinked: false, hasLocalNotes: false })).toBe('own');
    expect(noteFocusTarget({ showLinked: false, hasLocalNotes: true })).toBe('own');
  });

  // MUTATION: prefer the own note and E on an Obsidian-linked task edits a
  // note the vault never sees, while the real one sits above it.
  it('is the linked vault note where the title has one, loaded or still loading', () => {
    expect(noteFocusTarget({ showLinked: true, wikilinks: ['Plan'], linkedNoteStates: { Plan: { text: 'x' } }, hasLocalNotes: true })).toBe('Plan');
    expect(noteFocusTarget({ showLinked: true, wikilinks: ['Plan'], linkedNoteStates: {}, hasLocalNotes: false })).toBe('Plan');
  });

  it('skips a linked note that failed to load', () => {
    const states = { A: { error: 'not_found' }, B: { text: '' } };
    expect(noteFocusTarget({ showLinked: true, wikilinks: ['A', 'B'], linkedNoteStates: states, hasLocalNotes: false })).toBe('B');
    expect(noteFocusTarget({ showLinked: true, wikilinks: ['A'], linkedNoteStates: states, hasLocalNotes: true })).toBe('own');
  });

  it('is nowhere when every linked note failed and there is no own note shown', () => {
    expect(noteFocusTarget({ showLinked: true, wikilinks: ['A'], linkedNoteStates: { A: { error: 'x' } }, hasLocalNotes: false })).toBe(null);
  });
});
