import { describe, it, expect } from 'vitest';
import { isObsidianNoteOnlyTask } from './textFormatting.jsx';

// The notes-button icon rule: the open book means the note is IN the vault
// (a [[wikilink]] in the title); notes typed in dayGLANCE get the regular
// icon whatever the task's origin. Project routing (2026-09) stamps
// importSource onto every task assigned to a linked project, which is what
// made the old import-source shortcut wrong.

describe('isObsidianNoteOnlyTask (the open-book rule)', () => {
  it('a wikilinked title means the note is in the vault', () => {
    expect(isObsidianNoteOnlyTask({ title: 'Plan trip [[Trip notes]]' })).toBe(true);
    expect(isObsidianNoteOnlyTask({ title: 'Plan trip [[Trip notes]]', importSource: 'obsidian' })).toBe(true);
  });

  it('notes typed in dayGLANCE get the regular icon, even on a task in a linked project', () => {
    const projectTask = { title: 'Fix the gutter', importSource: 'obsidian', obsidianNotePath: 'Projects/House.md', notes: 'call the roofer first' };
    expect(isObsidianNoteOnlyTask(projectTask)).toBe(false);
  });

  it('local notes on a linked task mean the document, lit: notes live in both places (F4)', () => {
    expect(isObsidianNoteOnlyTask({ title: 'Prepare [[Projects/dayGLANCE/NEXT- Prepare]] #obsidian', notes: 'stranded text' })).toBe(false);
    expect(isObsidianNoteOnlyTask({ title: 'Prepare [[Projects/dayGLANCE/NEXT- Prepare]] #obsidian', notes: '   ' })).toBe(true);
  });

  it('an Obsidian-origin task without a wikilink has no vault note to open', () => {
    expect(isObsidianNoteOnlyTask({ title: 'Daily standup', importSource: 'obsidian' })).toBe(false);
    expect(isObsidianNoteOnlyTask({ title: 'Plain task' })).toBe(false);
  });

  it('subtasks and link-only notes keep their own icons', () => {
    expect(isObsidianNoteOnlyTask({ title: 'Read [[Book]]', subtasks: [{ id: 1, text: 'ch 1' }] })).toBe(false);
    expect(isObsidianNoteOnlyTask({ title: 'See [[Book]]', notes: 'https://example.com' })).toBe(false);
  });
});
