import { describe, it, expect } from 'vitest';
import { splitTitle } from './title.js';

describe('splitTitle', () => {
  it('segments text, tags and wikilinks', () => {
    expect(splitTitle('Plan [[Trip notes|Trip]] #Travel')).toEqual([
      { type: 'text', text: 'Plan ' },
      { type: 'link', text: 'Trip', target: 'Trip notes' },
      { type: 'text', text: ' ' },
      { type: 'tag', text: '#Travel', tag: 'travel' },
    ]);
  });

  // MUTATION: drop the address alternative from TOKEN and #setup becomes a tag.
  it('keeps a web address as text, fragment included', () => {
    expect(splitTitle('Read https://example.com/guide#setup #docs')).toEqual([
      { type: 'text', text: 'Read https://example.com/guide#setup ' },
      { type: 'tag', text: '#docs', tag: 'docs' },
    ]);
  });
});
