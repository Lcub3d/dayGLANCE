import { describe, expect, it } from 'vitest';
import { extractWikilinks, stripWikilinks, stripWikilinksAndTags, wikilinkLabel } from './taskUtils.js';
import { renderTitle, renderTitleWithoutTags, splitChipTitleTag } from './textFormatting.jsx';

// The one strip rule. Every surface that cannot show a link as a link goes
// through stripWikilinks (or its tag-dropping sibling), and a title that is
// nothing but a link keeps the note's name instead of going blank.

describe('stripWikilinks', () => {
  it('drops the links and keeps the words and tags around them', () => {
    expect(stripWikilinks('Plan trip [[Trip notes]] #travel')).toBe('Plan trip #travel');
    expect(stripWikilinks('Prepare [[Projects/dayGLANCE/NEXT- Prepare]] #obsidian')).toBe('Prepare #obsidian');
    expect(stripWikilinks('  spaced   out  ')).toBe('spaced out');
  });

  it('a title that is only a link reads as the note name', () => {
    expect(stripWikilinks('[[Project brief]]')).toBe('Project brief');
    expect(stripWikilinks('[[Projects/Client/Project brief]]')).toBe('Project brief');
    expect(stripWikilinks('[[Projects/Dune|the book]]')).toBe('the book');
    expect(stripWikilinks('[[Meeting notes#Agenda]]')).toBe('Meeting notes');
  });

  it('a link and tags keeps the note name in the link\'s place', () => {
    expect(stripWikilinks('[[Project brief]] #work #obsidian')).toBe('Project brief #work #obsidian');
  });

  it('tolerates a missing title', () => {
    expect(stripWikilinks(undefined)).toBe('');
    expect(stripWikilinks(null)).toBe('');
  });
});

describe('stripWikilinksAndTags', () => {
  it('drops both, and still names the note when nothing else is left', () => {
    expect(stripWikilinksAndTags('Plan trip [[Trip notes]] #travel')).toBe('Plan trip');
    expect(stripWikilinksAndTags('[[Project brief]] #work')).toBe('Project brief');
    expect(stripWikilinksAndTags('Nested #work/deep task')).toBe('Nested task');
  });
});

describe('wikilinkLabel and extractWikilinks', () => {
  it('label prefers the alias, then the basename', () => {
    expect(wikilinkLabel('A/B/C', undefined)).toBe('C');
    expect(wikilinkLabel('A/B/C', ' alias ')).toBe('alias');
    expect(wikilinkLabel('Note#Heading', '')).toBe('Note');
  });
  it('extractWikilinks still reports the target with its heading, alias dropped', () => {
    expect(extractWikilinks('x [[A/B#H|alias]] y [[C]]')).toEqual(['A/B#H', 'C']);
    expect(extractWikilinks(undefined)).toEqual([]);
  });
});

describe('the display readers follow the same rule', () => {
  it('renderTitle names the note when the title is only a link', () => {
    expect(renderTitle('[[Project brief]]')).toEqual(['Project brief']);
    expect(renderTitle('Plan trip [[Trip notes]] ')).toEqual(['Plan trip  ']);
  });
  it('renderTitleWithoutTags and splitChipTitleTag do too', () => {
    expect(renderTitleWithoutTags('[[Project brief]] #work')).toBe('Project brief');
    expect(splitChipTitleTag('[[Project brief]] #work')).toEqual(['Project brief', '#work']);
  });
});
