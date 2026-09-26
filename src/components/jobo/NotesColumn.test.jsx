import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NotesColumn from './NotesColumn.jsx';

const t = (key) => key;
const ctx = { borderClass: 'border-slate-200', dailyNotes: {} };
const tasks = [
  { id: 'with-note', title: 'A task with notes #work', notes: 'keep this text', color: 'bg-red-500' },
  { id: 'without-note', title: 'A task without notes', notes: '', color: 'bg-blue-500' },
  { id: 'readonly', title: 'Imported note', notes: 'read only', color: 'bg-green-500', imported: true },
];

function render(props = {}) {
  return renderToStaticMarkup(<NotesColumn
    tasks={tasks}
    date="2026-09-26"
    ctx={ctx}
    t={t}
    onFocus={() => {}}
    {...props}
  />);
}

function sectionOpeningTag(html, link) {
  return html.match(new RegExp(`<section[^>]*data-jobo-note-link="${link}"[^>]*>`))?.[0] || '';
}

describe('NotesColumn visibility contract', () => {
  it('keeps empty task note tiles mounted while hiding them by default', () => {
    const html = render();

    expect(html).toContain('data-jobo-note-link="with-note"');
    expect(html).toContain('data-jobo-note-link="without-note"');
    expect(sectionOpeningTag(html, 'with-note')).not.toContain('hidden');
    expect(sectionOpeningTag(html, 'without-note')).toContain('hidden');
  });

  it('allows the parent to show an empty note tile without changing task data', () => {
    const html = render({ isTaskNoteVisible: (task) => task.id === 'without-note' });

    expect(sectionOpeningTag(html, 'without-note')).not.toContain('hidden');
    expect(html).toContain('data-jobo-note-link="without-note"');
    expect(html).toContain('placeholder="jobo.view.notePlaceholder"');
  });

  it('renders task notes before the daily note and preserves task colors', () => {
    const html = render({ isTaskNoteVisible: () => true });

    expect(html.indexOf('data-jobo-note-link="with-note"')).toBeLessThan(html.indexOf('data-jobo-note-link="daily:2026-09-26"'));
    expect(html).toContain('bg-red-500 text-white');
    expect(html).toContain('class="jobo-s5-note-resizer"');
    expect(html).toContain('aria-valuemin="80"');
    expect(html).toContain('aria-valuemax="1000"');
  });

  it('uses live Plan order for the task tiles while keeping daily last', () => {
    const html = render({
      isTaskNoteVisible: () => true,
      planItems: [
        { id: 'plan-without', noteKey: 'without-note', historical: false, startMinute: 480, plan: { date: '2026-09-26' } },
        { id: 'plan-with', noteKey: 'with-note', historical: false, startMinute: 600, plan: { date: '2026-09-26' } },
      ],
    });

    expect(html.indexOf('data-jobo-note-link="without-note"')).toBeLessThan(html.indexOf('data-jobo-note-link="with-note"'));
    expect(html.indexOf('data-jobo-note-link="with-note"')).toBeLessThan(html.indexOf('data-jobo-note-link="daily:2026-09-26"'));
  });

  it('places independent Do notes after task notes and before the daily note by start minute', () => {
    const html = render({
      isTaskNoteVisible: () => true,
      independentDos: [
        { id: 'do-late', startMinute: 720, record: { id: 'do-late', title: 'Late Do', notes: 'late' } },
        { id: 'do-early', startMinute: 480, record: { id: 'do-early', title: 'Early Do', notes: 'early' } },
      ],
    });

    expect(html.indexOf('data-jobo-note-link="with-note"')).toBeLessThan(html.indexOf('data-jobo-note-link="do:do-early"'));
    expect(html.indexOf('data-jobo-note-link="do:do-early"')).toBeLessThan(html.indexOf('data-jobo-note-link="do:do-late"'));
    expect(html.indexOf('data-jobo-note-link="do:do-late"')).toBeLessThan(html.indexOf('data-jobo-note-link="daily:2026-09-26"'));
  });

  it('uses direct textareas and a small hide button without the old edit form controls', () => {
    const html = render({ isTaskNoteVisible: () => true });

    expect(html.match(/<textarea/g)?.length).toBe(3);
    expect(html).toContain('class="jobo-s5-note-hide"');
    expect(html).toContain('class="jobo-s5-hover-actions"');
    expect(html).toContain('class="jobo-s5-note-delete"');
    expect(html).toContain('title="jobo.view.deleteNote"');
    expect(html).not.toContain('common.edit');
    expect(html).not.toContain('common.save');
    expect(html).not.toContain('common.cancel');
    expect(html).not.toContain('jobo-s5-note-size');
  });

  it('keeps imported tasks mounted but read only', () => {
    const html = render({ isTaskNoteVisible: () => true });
    const readonly = html.match(/<section[^>]*data-jobo-note-link="readonly"[\s\S]*?<\/section>/)?.[0] || '';

    expect(html).toContain('data-jobo-note-link="readonly"');
    expect(html).toContain('read only');
    expect(readonly).not.toContain('<textarea');
    expect(readonly).toMatch(/class="jobo-s5-note-delete"[^>]*disabled=""/);
  });

  it('hides the whole column while retaining its mounted tiles', () => {
    const html = render({ visible: false });

    expect(html).toContain('<aside hidden=""');
    expect(html).toContain('data-jobo-note-link="with-note"');
    expect(html).toContain('data-jobo-note-link="without-note"');
    expect(html).toContain('data-jobo-note-link="daily:2026-09-26"');
  });
});
