import { describe, it, expect } from 'vitest';
import { extractTags, tagsIn, stripTags, stripWikilinksAndTags } from './taskUtils.js';

// Drive-by from the Phase 4 investigation: extractTags now accepts
// Obsidian's full tag alphabet, so nested and hyphenated tags survive
// instead of truncating at the first `/` or `-`.
describe('extractTags', () => {
  it('extracts simple tags, lowercased, letter-start required', () => {
    expect(extractTags('Do thing #Work and #home_2')).toEqual(['work', 'home_2']);
    expect(extractTags('no tags here')).toEqual([]);
    expect(extractTags('#123 numeric start ignored')).toEqual([]);
  });

  it('nested and hyphenated tags come through whole', () => {
    expect(extractTags('Deep work #work/deep')).toEqual(['work/deep']);
    expect(extractTags('Errand #to-do')).toEqual(['to-do']);
    expect(extractTags('#a/b/c nested twice')).toEqual(['a/b/c']);
  });

  it('the #obsidian display tag still extracts as before', () => {
    expect(extractTags('Buy milk #obsidian')).toEqual(['obsidian']);
  });
});

// A fragment inside a web address looks like a tag (…/guide#setup) but is
// part of the address. MUTATION: drop the address alternative from
// TAG_OR_ADDRESS and every expectation below fails.
describe('a web address is never read as tags', () => {
  it('extractTags skips a bare URL and a Markdown link target', () => {
    expect(extractTags('Read https://example.com/guide#setup #Docs')).toEqual(['docs']);
    expect(extractTags('[Spec](https://example.com/spec#section-2) #work')).toEqual(['work']);
    expect(extractTags('http://x.io/#a')).toEqual([]);
  });

  it('tagsIn keeps case; stripTags leaves the address whole', () => {
    expect(tagsIn('https://example.com/#Top #Deep/Work')).toEqual(['Deep/Work']);
    expect(stripTags('Read https://example.com/guide#setup #docs now')).toBe('Read https://example.com/guide#setup  now');
    expect(stripWikilinksAndTags('Read https://example.com/guide#setup #docs')).toBe('Read https://example.com/guide#setup');
  });

  it('text that only resembles an address is still tagged as before', () => {
    expect(extractTags('word#tag and example.com#frag')).toEqual(['tag', 'frag']);
  });
});
