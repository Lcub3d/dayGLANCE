import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderTitle, renderTitleWithoutTags, renderTitleWithoutWikilinks, renderTitleWithNoteLinks } from './textFormatting.jsx';
import { splitTitleLinks, stripMarkdownLinks, stripWikilinks, stripWikilinksAndTags } from './taskUtils.js';

// A web link in a title used to print raw: "[dayGLANCE#1840](https://…)" on
// every card. Surfaces that can show a link now show one; surfaces that
// cannot (tooltips, notifications, widgets, AI context) show its label.

const html = (node) => renderToStaticMarkup(<div>{node}</div>);
const PR = 'https://github.com/krelltunez/dayGLANCE/pull/1840';

describe('splitTitleLinks', () => {
  it('splits Markdown links and bare URLs out of the text', () => {
    expect(splitTitleLinks(`Review [dayGLANCE#1840](${PR}) then https://example.com/ ok`)).toEqual([
      { text: 'Review ' },
      { href: PR, label: 'dayGLANCE#1840' },
      { text: ' then ' },
      { href: 'https://example.com/', label: 'example.com' },
      { text: ' ok' },
    ]);
  });

  // MUTATION: widen the scheme and a title from any source becomes a live
  // script or file link.
  it('admits http(s) only', () => {
    for (const title of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](file:///etc/passwd)', 'javascript:alert(1)']) {
      expect(splitTitleLinks(title).some((part) => part.href)).toBe(false);
      expect(html(renderTitle(title))).not.toContain('<a');
    }
  });
});

describe('titles without a link surface', () => {
  it('stripWikilinks reads a Markdown link as its label and keeps a bare URL', () => {
    expect(stripMarkdownLinks(`Fix [the bug](${PR}) now`)).toBe('Fix the bug now');
    expect(stripWikilinks(`[dayGLANCE#1840](${PR}) [[Notes]]`)).toBe('dayGLANCE#1840');
    expect(stripWikilinks('Read https://example.com/a')).toBe('Read https://example.com/a');
    expect(stripWikilinksAndTags(`Ship [it](${PR}) #work`)).toBe('Ship it');
  });

  it('a title with no link renders exactly as before', () => {
    expect(renderTitleWithoutTags('Plan trip [[Trip notes]] #travel')).toBe('Plan trip');
    expect(renderTitleWithoutWikilinks('Plan trip [[Trip notes]] #travel')).toBe('Plan trip #travel');
    expect(html(renderTitle('Plain #tag'))).toBe('<div>Plain <span class="text-xs italic opacity-75">#tag</span></div>');
  });
});

describe('titles render their links', () => {
  it('as a new-tab link with no opener, labelled, in a card that loses no text', () => {
    const out = html(renderTitleWithoutTags(`Review [dayGLANCE#1840](${PR}) today #work`));
    expect(out).toContain(`<a href="${PR}" target="_blank" rel="noopener noreferrer" draggable="false"`);
    expect(out).toContain('>dayGLANCE#1840</a>');
    expect(out).toMatch(/Review <a /);
    expect(out).toMatch(/<\/a> today/);
    expect(out).not.toContain('#work');
    expect(out).not.toContain('](');
  });

  // MUTATION: strip tags before splitting out links and the fragment goes.
  it('keeps a URL fragment that looks like a tag', () => {
    const out = html(renderTitleWithoutTags('Read https://example.com/guide#setup #docs'));
    expect(out).toContain('href="https://example.com/guide#setup"');
    expect(out).not.toContain('#docs');
  });

  it('renderTitle keeps its tag styling around a link', () => {
    const out = html(renderTitle(`[Spec](${PR}) #work`));
    expect(out).toContain('>Spec</a>');
    expect(out).toContain('<span class="text-xs italic opacity-75">#work</span>');
  });

  it('the imported-event title keeps its tags and links its URL', () => {
    const out = html(renderTitleWithoutWikilinks('Standup https://meet.example.com/abc #team'));
    expect(out).toContain('href="https://meet.example.com/abc"');
    expect(out).toContain('#team');
  });

  it('the NOW banner links both kinds and lets the web link out of the drag region', () => {
    const out = html(renderTitleWithNoteLinks(`[Spec](${PR}) and [[Trip notes]]`, () => {}));
    expect(out).toContain('>Spec</a>');
    expect(out).toMatch(/<a[^>]*-webkit-app-region:no-drag/);
    expect(out).toContain('Trip notes');
  });
});
