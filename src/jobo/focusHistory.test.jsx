import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DoFocusHistory from '../components/jobo/DoFocusHistory.jsx';
import {
  focusSessionLabel,
  formatFocusMinute,
  selectDoFocusHistory,
  selectDoFocusHistorySummary,
} from './focusHistory.js';

const RECORD = {
  id: 'do:task-1:2026-09-27',
  taskId: 'task-1',
  date: '2026-09-27',
};

const t = (key, options = {}) => ({
  'jobo.view.focusHistory': 'Focus sessions',
  'jobo.view.focusHistoryCount': `${options.count} focus sessions`,
  'jobo.view.closeFocusHistory': 'Close focus history',
  'jobo.view.focusTimeUnavailable': 'Time unavailable',
  'jobo.view.minutesShort': 'min',
  'jobo.view.focusLegacyTotal': `${options.minutes}min`,
  'jobo.view.focusLegacyNotice': 'Older records do not include specific session times.',
  'jobo.view.focusSessionHint': 'Time ranges may include breaks or pauses.',
}[key] || key);

describe('focusHistory selector', () => {
  it('matches ordinary task sessions across calendar dates', () => {
    const sessions = selectDoFocusHistory({
      record: RECORD,
      focusSessions: [
        { id: 's1', taskId: 'task-1', date: '2026-09-27', start: 540, end: 565 },
        { id: 's2', taskId: 'task-1', date: '2026-09-28', start: 600, end: 625 },
        { id: 's3', taskId: 'other', date: '2026-09-27', start: 540, end: 565 },
      ],
    });
    expect(sessions.map(session => session.id)).toEqual(['s1', 's2']);
  });

  it('uses the captured plan date before the live task date for recurring identity', () => {
    const sessions = selectDoFocusHistory({
      record: {
        ...RECORD,
        id: 'do:series:completion',
        taskId: 'series',
        date: '2026-09-30',
        planSnapshot: { date: '2026-09-28' },
      },
      task: {
        id: 'recurring-series-2026-09-30',
        recurringTemplateId: 'series',
        date: '2026-09-30',
      },
      focusSessions: [
        { id: 'snapshot-date', taskId: 'series', occurrenceDate: '2026-09-28', start: 540, end: 565 },
        { id: 'live-task-date', taskId: 'series', occurrenceDate: '2026-09-30', start: 540, end: 565 },
        { id: 'record-date', taskId: 'series', occurrenceDate: '2026-09-30', start: 540, end: 565 },
      ],
    });
    expect(sessions.map(session => session.id)).toEqual(['snapshot-date']);
  });

  it('matches a recurring full instance id exactly', () => {
    const sessions = selectDoFocusHistory({
      record: { ...RECORD, id: 'do:series:2026-09-28', taskId: 'series', date: '2026-09-28' },
      task: { id: 'recurring-series-2026-09-28', recurringTemplateId: 'series', date: '2026-09-28' },
      focusSessions: [
        { id: 'old', taskId: 'recurring-series-2026-09-27', date: '2026-09-27', start: 540, end: 565 },
        { id: 'current', taskId: 'recurring-series-2026-09-28', date: '2026-09-28', start: 600, end: 625 },
      ],
    });
    expect(sessions.map(session => session.id)).toEqual(['current']);
  });

  it('requires explicit occurrence identity for a bare recurring template id', () => {
    const target = {
      record: { ...RECORD, id: 'do:series:2026-09-28', taskId: 'series', date: '2026-09-28' },
      task: { id: 'recurring-series-2026-09-28', recurringTemplateId: 'series', date: '2026-09-28' },
    };
    expect(selectDoFocusHistory({
      ...target,
      focusLog: {
        '2026-09-28': { spans: [{ id: 'date-key-only', taskIds: ['series'], start: 600, end: 625 }] },
      },
    })).toEqual([]);
    expect(selectDoFocusHistory({
      ...target,
      focusSessions: [{ id: 'explicit', taskId: 'series', occurrenceDate: '2026-09-28', start: 600, end: 625 }],
    }).map(session => session.id)).toEqual(['explicit']);
  });

  it('accepts a span carrying the explicit task id list used by Focus Mode', () => {
    const sessions = selectDoFocusHistory({
      record: { id: 'do:task-1:2026-09-27', taskId: 'task-1', date: '2026-09-27' },
      focusLog: {
        '2026-09-27': {
          spans: [{ id: 'span-1', taskIds: ['task-1', 'other'], start: 540, end: 565 }],
        },
      },
    });
    expect(sessions.map(session => session.taskId)).toEqual(['task-1']);
  });

  it('accepts an exact Do record id and ignores its session date', () => {
    const sessions = selectDoFocusHistory({
      record: RECORD,
      focusSessions: [{ id: 's1', recordId: RECORD.id, date: '2026-10-01', start: 540, end: 565 }],
    });
    expect(sessions).toHaveLength(1);
  });

  it('does not attribute aggregate day sessions or title-only rows to a Do', () => {
    const sessions = selectDoFocusHistory({
      record: RECORD,
      task: { id: 'task-1', title: 'Write the report', date: RECORD.date, focusMinutes: 25 },
      focusLog: {
        [RECORD.date]: {
          sessions: 3,
          spans: [{ start: 540, end: 565 }],
        },
      },
      focusSessions: [{ title: 'Write the report', date: RECORD.date, start: 540, end: 565 }],
    });
    expect(sessions).toEqual([]);
  });

  it('reads explicit rows nested under the existing date-indexed log shape', () => {
    const sessions = selectDoFocusHistory({
      record: RECORD,
      focusLog: {
        [RECORD.date]: {
          sessions: [{ taskId: 'task-1', start: 540, end: 565 }],
        },
      },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].date).toBe(RECORD.date);
  });

  it('extracts the task allocation from a multi-task Focus span', () => {
    const sessions = selectDoFocusHistory({
      record: RECORD,
      focusLog: {
        [RECORD.date]: {
          spans: [{ taskIds: ['task-1', 'other'], taskMinutes: { 'task-1': 12.5, other: 12.5 }, start: 540, end: 570 }],
        },
      },
    });
    expect(sessions[0].taskMinutes).toBe(12.5);
  });

  it('uses startedAt and endedAt for real local times, including midnight wrap', () => {
    const sessions = selectDoFocusHistory({
      record: RECORD,
      focusSessions: [{
        id: 'timestamp',
        taskId: 'task-1',
        startedAt: '2026-09-27T23:55:00+08:00',
        endedAt: '2026-09-28T00:10:00+08:00',
      }],
    });
    expect(sessions).toHaveLength(1);
    expect(focusSessionLabel(sessions[0], value => value)).toBe('23:55–00:10');
    expect(sessions[0].date).toBe('2026-09-27');
  });

  it('rejects impossible dates and reversed intervals', () => {
    const sessions = selectDoFocusHistory({
      record: RECORD,
      focusSessions: [
        { id: 'bad-date', taskId: 'task-1', date: '2026-02-30', start: 540, end: 565 },
        { id: 'backwards', taskId: 'task-1', date: RECORD.date, start: 565, end: 540 },
        { id: 'bad-time', taskId: 'task-1', date: RECORD.date, start: '25:00', end: '26:00' },
      ],
    });
    expect(sessions).toEqual([]);
  });

  it('returns legacy task minutes without inventing a session count', () => {
    expect(selectDoFocusHistorySummary({ record: RECORD, task: { id: 'task-1', focusMinutes: 25 } }))
      .toMatchObject({ legacyMinutes: 25, precise: false, sessions: [] });
  });
});

describe('DoFocusHistory', () => {
  it('renders a compact alarm/count trigger and readable dated session times', () => {
    const html = renderToStaticMarkup(
      <DoFocusHistory
        record={RECORD}
        focusSessions={[{ id: 's1', taskId: 'task-1', date: RECORD.date, start: 540, end: 565, taskMinutes: { 'task-1': 25 } }]}
        formatTime={(value) => value}
        t={t}
        darkMode
        defaultOpen
      />,
    );
    expect(html).toContain('data-jobo-focus-history="true"');
    expect(html).toContain('data-jobo-focus-count="true">1</span>');
    expect(html).toContain('aria-label="1 focus sessions"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('class="jobo-s5-focus-history-popover jobo-s5-dark"');
    expect(html).toContain('2026-09-27');
    expect(html).toContain('09:00–09:25');
    expect(html).toContain('25min');
    expect(html).toContain('Time ranges may include breaks or pauses.');
  });

  it('shows legacy total minutes and explains that exact times are unavailable', () => {
    const html = renderToStaticMarkup(
      <DoFocusHistory
        record={RECORD}
        task={{ id: 'task-1', focusMinutes: 25 }}
        focusLog={{ [RECORD.date]: { sessions: 1, spans: [{ start: 540, end: 565 }] } }}
        t={t}
        defaultOpen
      />,
    );
    expect(html).toContain('data-jobo-focus-count="true">25min</span>');
    expect(html).toContain('Older records do not include specific session times.');
    expect(html).not.toContain('data-jobo-focus-count="true">1</span>');
  });
});

describe('focus time formatting', () => {
  it('wraps minutes at midnight without changing the stored value', () => {
    expect(formatFocusMinute(1500)).toBe('01:00');
    expect(focusSessionLabel({ startMinute: 1380, endMinute: 1500 }, value => value)).toBe('23:00–01:00');
  });
});
