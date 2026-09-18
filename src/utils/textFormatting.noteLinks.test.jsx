import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderTitleWithNoteLinks } from './textFormatting.jsx';
import { splitTitleNoteLinks } from './taskUtils.js';

// The NOW banner in the macOS title bar used to print the running task's title
// raw, [[wikilink]] and all. It now keeps the link as a link: the note opens
// in Obsidian from the one surface that cannot host the notes panel.

describe('splitTitleNoteLinks', () => {
  it('keeps the text runs and turns each wikilink into a note link', () => {
    expect(splitTitleNoteLinks('Plan trip [[Trip notes]] #travel')).toEqual([
      { text: 'Plan trip ' },
      { note: 'Trip notes', label: 'Trip notes' },
      { text: ' #travel' },
    ]);
  });

  it('labels a path-shaped target by its note name and hands the handler the full target', () => {
    expect(splitTitleNoteLinks('Prepare [[Projects/dayGLANCE/NEXT- Prepare]] #obsidian')).toEqual([
      { text: 'Prepare ' },
      { note: 'Projects/dayGLANCE/NEXT- Prepare', label: 'NEXT- Prepare' },
      { text: ' #obsidian' },
    ]);
  });

  it('shows the alias when the link carries one, and drops a heading from the label only', () => {
    expect(splitTitleNoteLinks('Read [[Books/Dune|the book]]')).toEqual([
      { text: 'Read ' },
      { note: 'Books/Dune', label: 'the book' },
    ]);
    expect(splitTitleNoteLinks('[[Meeting notes#Agenda]] first')).toEqual([
      { note: 'Meeting notes#Agenda', label: 'Meeting notes' },
      { text: ' first' },
    ]);
  });

  it('a title without wikilinks is one text run; an empty title is nothing', () => {
    expect(splitTitleNoteLinks('Plain task #tag')).toEqual([{ text: 'Plain task #tag' }]);
    expect(splitTitleNoteLinks('')).toEqual([]);
    expect(splitTitleNoteLinks(undefined)).toEqual([]);
  });
});

describe('renderTitleWithNoteLinks', () => {
  const html = (title) => renderToStaticMarkup(
    <span>{renderTitleWithNoteLinks(title, () => {}, { openLabel: (name) => `Open “${name}” in Obsidian` })}</span>,
  );

  it('renders the wikilink as a no-drag button with the open book and the note name', () => {
    const out = html('Plan trip [[Projects/Trip notes]] #travel');
    expect(out).not.toContain('[[');
    expect(out).toContain('<button type="button"');
    expect(out).toContain('-webkit-app-region:no-drag');
    expect(out).toContain('lucide-book-open');
    expect(out).toContain('<span>Trip notes</span>');
    expect(out).toContain('aria-label="Open “Projects/Trip notes” in Obsidian"');
  });

  it('styles the hashtags around the link the way renderTitle does', () => {
    const out = html('Plan trip [[Trip notes]] #travel');
    expect(out).toContain('<span class="text-xs italic opacity-75">#travel</span>');
    expect(out).toContain('Plan trip ');
  });

  it('a plain title renders no button', () => {
    expect(html('Plain task')).toBe('<span>Plain task</span>');
  });
});
