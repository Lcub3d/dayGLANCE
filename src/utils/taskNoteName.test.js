import { describe, it, expect } from 'vitest';
import { taskNoteNameFor, taskNoteTargetFor, folderOfNotePath, planTaskNoteMigration } from './taskNoteName.js';

const project = { id: 'p1', title: 'House', obsidianNotePath: 'Projects/House.md' };
const placed = (over = {}) => ({
  id: 'obsidian-dg-abc12345', title: 'Fix the gutter #obsidian', notes: 'Call the roofer first',
  importSource: 'obsidian', obsidianRawTitle: 'Fix the gutter', obsidianNotePath: 'Projects/House.md', obsidianBlockId: 'abc12345',
  projectId: 'p1', completed: false, ...over,
});

describe('taskNoteNameFor', () => {
  it('drops wikilinks and hashtags, keeps the words', () => {
    expect(taskNoteNameFor('Fix the gutter #obsidian')).toBe('Fix the gutter');
    expect(taskNoteNameFor('Read [[Some Note]] tonight #urgent #obsidian')).toBe('Read tonight');
  });
  it('applies the portability rules and caps the length', () => {
    expect(taskNoteNameFor('What: next? #obsidian')).toBe('What- next-');
    expect(taskNoteNameFor('CON #obsidian')).toBe('CON note');
    expect(taskNoteNameFor(`${'a'.repeat(100)} #obsidian`)).toHaveLength(80);
  });
  it('is null when nothing nameable is left', () => {
    expect(taskNoteNameFor('#obsidian')).toBeNull();
    expect(taskNoteNameFor('[[Only a link]]')).toBeNull();
    expect(taskNoteNameFor('')).toBeNull();
  });
});

describe('taskNoteTargetFor', () => {
  it('lives in the project note folder, bare at the root', () => {
    expect(folderOfNotePath('Projects/House.md')).toBe('Projects');
    expect(folderOfNotePath('House.md')).toBe('');
    expect(taskNoteTargetFor('Projects/House.md', 'Fix the gutter #obsidian')).toBe('Projects/Fix the gutter');
    expect(taskNoteTargetFor('House.md', 'Fix the gutter #obsidian')).toBe('Fix the gutter');
  });
  it('suffixes while the target or its basename is taken, case-insensitively', () => {
    const taken = new Set(['projects/fix the gutter', 'fix the gutter', 'fix the gutter 2']);
    expect(taskNoteTargetFor('Projects/House.md', 'Fix the Gutter #obsidian', taken)).toBe('Projects/Fix the Gutter 3');
  });
});

describe('planTaskNoteMigration', () => {
  it('plans the note in the project folder and the title with the link before the tag', () => {
    const plan = planTaskNoteMigration(placed(), project, { tasks: [placed()] });
    expect(plan).toEqual({
      target: 'Projects/Fix the gutter',
      title: 'Fix the gutter [[Projects/Fix the gutter]] #obsidian',
      content: 'Call the roofer first',
    });
  });
  it('reserves the names other tasks link and the projects\' own notes', () => {
    const other = placed({ id: 'x', title: 'Other [[Fix the gutter]] #obsidian', notes: '' });
    const plan = planTaskNoteMigration(placed(), project, { tasks: [placed(), other], reservedNotePaths: ['Projects/House.md', 'Goals/Fix the gutter 2.md'] });
    expect(plan.target).toBe('Projects/Fix the gutter 3');
    // The project note itself is never the target.
    expect(planTaskNoteMigration(placed({ title: 'House #obsidian' }), project, { tasks: [] }).target).toBe('Projects/House 2');
  });
  it('is null when there is nothing to move or nowhere to put it', () => {
    expect(planTaskNoteMigration(placed({ notes: '   ' }), project)).toBeNull();
    expect(planTaskNoteMigration(placed({ completed: true }), project)).toBeNull();
    expect(planTaskNoteMigration(placed({ title: 'Fix [[Already]] #obsidian' }), project)).toBeNull();
    expect(planTaskNoteMigration(placed({ obsidianBlockId: null }), project)).toBeNull(); // not yet placed under a token
    expect(planTaskNoteMigration(placed({ obsidianNotePath: 'Daily/2026-09-14.md' }), project)).toBeNull(); // not home yet
    expect(planTaskNoteMigration(placed(), { ...project, obsidianNoteMissingAt: '2026-09-14T00:00:00Z' })).toBeNull();
    expect(planTaskNoteMigration(placed(), { id: 'p1', title: 'Unlinked' })).toBeNull();
    expect(planTaskNoteMigration(placed({ recurringTemplateId: 'r1' }), project)).toBeNull();
  });
});
