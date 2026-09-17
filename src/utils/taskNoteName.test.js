import { describe, it, expect } from 'vitest';
import { taskNoteNameFor, taskNoteTargetFor, folderOfNotePath, planTaskNoteMigration, planLinkedNoteAppend, planNoteLinkReassert, isOwnTaskNote, plainTaskTitle, titleWithNoteLink } from './taskNoteName.js';

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
      kind: 'create',
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

describe('plainTaskTitle and titleWithNoteLink', () => {
  it('cleans and inserts before the display tag', () => {
    expect(plainTaskTitle('Read [[Book]] tonight #urgent #obsidian')).toBe('Read tonight');
    expect(titleWithNoteLink('Fix the gutter #obsidian', 'Projects/Fix the gutter')).toBe('Fix the gutter [[Projects/Fix the gutter]] #obsidian');
    expect(titleWithNoteLink('Fix the gutter', 'Projects/Fix the gutter')).toBe('Fix the gutter [[Projects/Fix the gutter]]');
  });
});

describe('isOwnTaskNote (the discriminator, option B)', () => {
  const linked = (over = {}) => placed({ title: 'Fix the gutter [[Projects/Fix the gutter]] #obsidian', ...over });
  it('by the stored target, rename-proof', () => {
    expect(isOwnTaskNote(linked({ obsidianNoteTarget: 'Projects/Fix the gutter' }), project, 'Projects/Fix the gutter')).toBe(true);
    expect(isOwnTaskNote(linked({ title: 'Renamed [[Projects/Fix the gutter]] #obsidian', obsidianNoteTarget: 'Projects/Fix the gutter' }), project, 'Projects/Fix the gutter')).toBe(true);
    expect(isOwnTaskNote(linked({ obsidianNoteTarget: 'Projects/Fix the gutter' }), project, 'Projects/Other')).toBe(false);
  });
  it('without the field: folder and derived name, suffix allowed; renamed reads as hand-linked', () => {
    expect(isOwnTaskNote(linked(), project, 'Projects/Fix the gutter')).toBe(true);
    expect(isOwnTaskNote(linked(), project, 'Projects/Fix the gutter 2')).toBe(true);
    expect(isOwnTaskNote(linked(), project, 'Fix the gutter')).toBe(false); // wrong folder
    expect(isOwnTaskNote(linked(), project, 'Projects/GLANCE-repo-setup')).toBe(false);
    expect(isOwnTaskNote(linked({ title: 'Renamed [[Projects/Fix the gutter]] #obsidian' }), project, 'Projects/Fix the gutter')).toBe(false);
  });
});

describe('planLinkedNoteAppend', () => {
  it('appends to the task\'s own note and nothing else', () => {
    const own = placed({ title: 'Fix the gutter [[Projects/Fix the gutter]] #obsidian', notes: 'more', obsidianNoteTarget: 'Projects/Fix the gutter' });
    expect(planLinkedNoteAppend(own, project)).toEqual({ kind: 'append', target: 'Projects/Fix the gutter', content: 'more' });
    const shared = placed({ title: 'Setup [[GLANCE-repo-setup]] #obsidian', notes: 'more' });
    expect(planLinkedNoteAppend(shared, project)).toBeNull();
    const twoLinks = placed({ title: 'Fix the gutter [[Notes/Other]] [[Projects/Fix the gutter]] #obsidian', notes: 'more' });
    expect(planLinkedNoteAppend(twoLinks, project)).toEqual({ kind: 'append', target: 'Projects/Fix the gutter', content: 'more' });
  });
  it('is null without notes, without a link, when not placed, or for an unportable stored target', () => {
    expect(planLinkedNoteAppend(placed({ title: 'Fix the gutter [[Projects/Fix the gutter]] #obsidian', notes: '' }), project)).toBeNull();
    expect(planLinkedNoteAppend(placed({ notes: 'x' }), project)).toBeNull();
    expect(planLinkedNoteAppend(placed({ title: 'Fix [[Projects/Fix the gutter]] #obsidian', notes: 'x', obsidianBlockId: null }), project)).toBeNull();
    expect(planLinkedNoteAppend(placed({ title: 'Fix [[Projects/plans?]] #obsidian', notes: 'x', obsidianNoteTarget: 'Projects/plans?' }), project)).toBeNull();
  });
});

describe('planNoteLinkReassert', () => {
  it('puts the link back only while it was never observed on the line', () => {
    const lost = placed({ title: 'Fix the gutter #obsidian', obsidianNoteTarget: 'Projects/Fix the gutter', notes: '' });
    expect(planNoteLinkReassert(lost, project)).toEqual({ kind: 'reassert', target: 'Projects/Fix the gutter', title: 'Fix the gutter [[Projects/Fix the gutter]] #obsidian' });
    expect(planNoteLinkReassert({ ...lost, obsidianNoteLinkSeen: true }, project)).toBeNull();
    expect(planNoteLinkReassert({ ...lost, title: 'Fix the gutter [[Projects/Fix the gutter]] #obsidian' }, project)).toBeNull();
    expect(planNoteLinkReassert({ ...lost, obsidianNoteTarget: null }, project)).toBeNull();
  });
});
