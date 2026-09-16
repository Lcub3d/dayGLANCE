import { describe, it, expect } from 'vitest';
import { buildSpotlightResults, searchDailyNotes, dailyNoteTitle, SPOTLIGHT_MAX_RESULTS } from './spotlightSearch.js';

// Fixed clock so grouping (today / this week / past / future) is deterministic.
const NOW = new Date(2026, 8, 16, 12, 0, 0); // 2026-09-16
const task = (over = {}) => ({ id: 'id', title: 'Untitled', ...over });

describe('buildSpotlightResults', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(buildSpotlightResults({ query: '', tasks: [task({ title: 'x' })], now: NOW })).toEqual([]);
    expect(buildSpotlightResults({ query: '   ', tasks: [task({ title: 'x' })], now: NOW })).toEqual([]);
  });

  it('matches title, then tag, then task notes, then subtasks, in that order', () => {
    const tasks = [
      task({ id: 't', title: 'Plan the launch', date: '2026-09-16' }),
      task({ id: 'g', title: 'Errands #launch', date: '2026-09-16' }),
      task({ id: 'n', title: 'Sync', notes: 'discuss launch timing', date: '2026-09-16' }),
      task({ id: 's', title: 'Prep', subtasks: [{ title: 'launch checklist' }], date: '2026-09-16' }),
    ];
    const out = buildSpotlightResults({ query: 'launch', tasks, now: NOW });
    const byId = Object.fromEntries(out.map(r => [r.task.id, r.match.field]));
    expect(byId).toEqual({ t: 'title', g: 'title', n: 'notes', s: 'subtask' });
  });

  it('labels each source and skips native-merged scheduled tasks', () => {
    const out = buildSpotlightResults({
      query: 'q',
      tasks: [task({ id: 'sched', title: 'q', date: '2026-09-16' }), task({ id: 'nat', title: 'q', date: '2026-09-16', _native: true })],
      nativeTasks: [task({ id: 'ev', title: 'q', date: '2026-09-17' })],
      unscheduledTasks: [task({ id: 'in', title: 'q' }), task({ id: 'ar', title: 'q', archived: true })],
      recurringTasks: [task({ id: 'rec', title: 'q' })],
      recycleBin: [task({ id: 'del', title: 'q' })],
      now: NOW,
    });
    expect(out.map(r => [r.task.id, r.source, r.sourceLabel])).toEqual(expect.arrayContaining([
      ['sched', 'scheduled', 'Scheduled'],
      ['ev', 'event', 'Calendar'],
      ['in', 'inbox', 'Inbox'],
      ['ar', 'archived', 'Completed'],
      ['rec', 'recurring', 'Recurring'],
      ['del', 'deleted', 'Deleted'],
    ]));
    expect(out.find(r => r.task.id === 'nat')).toBeUndefined();
  });

  it('drops scheduled tasks older than two years and other users\' tasks', () => {
    const out = buildSpotlightResults({
      query: 'old',
      tasks: [task({ id: 'ancient', title: 'old', date: '2024-09-15' }), task({ id: 'recent', title: 'old', date: '2024-09-17' })],
      unscheduledTasks: [task({ id: 'theirs', title: 'old', assignedTo: 'other' })],
      isVisibleForUser: t => t.assignedTo !== 'other',
      now: NOW,
    });
    expect(out.map(r => r.task.id)).toEqual(['recent']);
  });

  it('groups by date and orders groups today → this week → future → no date → past → deleted → archived', () => {
    const out = buildSpotlightResults({
      query: 'x',
      tasks: [
        task({ id: 'past', title: 'x', date: '2026-09-01' }),
        task({ id: 'future', title: 'x', date: '2026-12-01' }),
        task({ id: 'week', title: 'x', date: '2026-09-20' }),
        task({ id: 'today', title: 'x', date: '2026-09-16' }),
      ],
      unscheduledTasks: [task({ id: 'nodate', title: 'x' }), task({ id: 'arch', title: 'x', archived: true })],
      recycleBin: [task({ id: 'del', title: 'x' })],
      now: NOW,
    });
    expect(out.map(r => r.group)).toEqual(['today', 'thisweek', 'future', 'nodate', 'past', 'deleted', 'archived']);
  });

  it('caps the list', () => {
    const tasks = Array.from({ length: SPOTLIGHT_MAX_RESULTS + 10 }, (_, i) => task({ id: `t${i}`, title: 'many', date: '2026-09-16' }));
    expect(buildSpotlightResults({ query: 'many', tasks, now: NOW })).toHaveLength(SPOTLIGHT_MAX_RESULTS);
  });

  describe('daily notes', () => {
    const dailyNotes = {
      '2026-09-10': { text: '## Quick Notes\n- Called the dentist about the crown\n## Thoughts\n', lastModified: 't' },
      '2026-09-16': { text: 'Crown fitting went fine', lastModified: 't' },
      '2026-09-12': { text: 'crown', lastModified: 't', deleted: true },
      '2026-09-13': { text: '', lastModified: 't' },
    };

    it('finds text in the body of a daily note and carries the matching line', () => {
      const out = buildSpotlightResults({ query: 'crown', dailyNotes, now: NOW });
      expect(out.map(r => [r.date, r.source, r.match.field])).toEqual([
        ['2026-09-16', 'dailynote', 'dailynote'],
        ['2026-09-10', 'dailynote', 'dailynote'],
      ]);
      const older = out.find(r => r.date === '2026-09-10');
      expect(older.match.text).toBe('Called the dentist about the crown');
      expect(older.task.title).toBe('Called the dentist about the crown');
      expect(older.task.id).toBe('dailynote-2026-09-10');
      expect(older.group).toBe('past');
    });

    it('never matches a deleted tombstone or an empty note', () => {
      expect(searchDailyNotes({ '2026-09-12': { text: 'crown', deleted: true } }, 'crown')).toEqual([]);
      expect(searchDailyNotes({ '2026-09-13': { text: '' } }, '')).toEqual([]);
      expect(searchDailyNotes({ '2026-09-13': { text: '' } }, 'crown')).toEqual([]);
    });

    it('is case-insensitive', () => {
      expect(searchDailyNotes({ '2026-09-16': { text: 'Crown fitting' } }, 'crown')).toHaveLength(1);
    });

    it('does not apply the scheduled-task lookback window to notes', () => {
      const out = buildSpotlightResults({ query: 'archive', dailyNotes: { '2019-01-01': { text: 'archive this' } }, now: NOW });
      expect(out.map(r => r.date)).toEqual(['2019-01-01']);
    });

    it('is skipped entirely when the caller passes no notes (Obsidian-enabled vaults)', () => {
      expect(buildSpotlightResults({ query: 'crown', dailyNotes: null, now: NOW })).toEqual([]);
      expect(buildSpotlightResults({ query: 'crown', now: NOW })).toEqual([]);
    });

    it('ranks a note below a task hit in the same group', () => {
      const out = buildSpotlightResults({
        query: 'crown',
        tasks: [task({ id: 't', title: 'Crown fitting', date: '2026-09-16' })],
        unscheduledTasks: [task({ id: 'n', title: 'Dentist', notes: 'crown', deadline: '2026-09-16' })],
        dailyNotes: { '2026-09-16': { text: 'crown' } },
        now: NOW,
      });
      expect(out.map(r => r.task.id)).toEqual(['t', 'n', 'dailynote-2026-09-16']);
    });
  });
});

describe('dailyNoteTitle', () => {
  it('prefers the first body line over a template heading', () => {
    expect(dailyNoteTitle('## Quick Notes\n- [ ] buy milk\n## Thoughts', '2026-09-16')).toBe('buy milk');
  });
  it('falls back to the first heading, then the date', () => {
    expect(dailyNoteTitle('## Only a heading', '2026-09-16')).toBe('Only a heading');
    expect(dailyNoteTitle('  \n\n', '2026-09-16')).toBe('2026-09-16');
    expect(dailyNoteTitle(undefined, '2026-09-16')).toBe('2026-09-16');
  });
  it('strips quote and numbered-list markers and truncates long lines', () => {
    expect(dailyNoteTitle('> quoted', 'd')).toBe('quoted');
    expect(dailyNoteTitle('1. first', 'd')).toBe('first');
    const long = 'a'.repeat(120);
    expect(dailyNoteTitle(long, 'd')).toHaveLength(80);
    expect(dailyNoteTitle(long, 'd').endsWith('…')).toBe(true);
  });
});
