import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { languages } from './locales.js';

// A key written twice in one object of a locale bundle is not an error to
// JSON.parse: it keeps the LAST value. A new string added under a name that
// already exists (a second "fromCalendar" inside "task", say) silently
// replaces the original everywhere it is used, and every other locale test
// still passes, because they all read the parsed object. That nearly shipped
// while adding the event-notes strings (#1891). JSON.parse cannot see the
// duplicate, so this reads the raw text.

/**
 * Every key that appears twice in one object of `text`, a JSON document:
 * its dotted path and the lines of both copies. Throws on malformed JSON,
 * naming the line, rather than reporting no duplicates in text it did not read.
 */
export function findDuplicateKeys(text) {
  let i = 0;
  let line = 1;
  const duplicates = [];
  const fail = (what) => { throw new Error(`line ${line}: ${what}`); };
  const space = () => {
    for (; i < text.length; i += 1) {
      const c = text[i];
      if (c === '\n') line += 1;
      else if (c !== ' ' && c !== '\t' && c !== '\r') return;
    }
  };
  const string = () => {
    if (text[i] !== '"') fail('expected a string');
    const start = i;
    for (i += 1; i < text.length; i += 1) {
      const c = text[i];
      if (c === '\\') i += 1;
      else if (c === '\n') fail('unterminated string');
      else if (c === '"') { i += 1; return JSON.parse(text.slice(start, i)); }
    }
    return fail('unterminated string');
  };
  const value = (path) => {
    space();
    const c = text[i];
    if (c === '{') return object(path);
    if (c === '[') return array(path);
    if (c === '"') return string();
    const literal = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 40));
    if (!literal) fail('expected a value');
    i += literal[0].length;
    return undefined;
  };
  const object = (path) => {
    i += 1;
    const seen = new Map();
    space();
    if (text[i] === '}') { i += 1; return; }
    for (;;) {
      space();
      const keyLine = line;
      const key = string();
      space();
      if (text[i] !== ':') fail(`expected ":" after "${key}"`);
      i += 1;
      const keyPath = [...path, key];
      if (seen.has(key)) duplicates.push({ path: keyPath.join('.'), lines: [seen.get(key), keyLine] });
      else seen.set(key, keyLine);
      value(keyPath);
      space();
      if (text[i] === ',') { i += 1; continue; }
      if (text[i] === '}') { i += 1; return; }
      fail('expected "," or "}"');
    }
  };
  const array = (path) => {
    i += 1;
    space();
    if (text[i] === ']') { i += 1; return; }
    for (let index = 0; ; index += 1) {
      value([...path, String(index)]);
      space();
      if (text[i] === ',') { i += 1; continue; }
      if (text[i] === ']') { i += 1; return; }
      fail('expected "," or "]"');
    }
  };
  value([]);
  space();
  if (i < text.length) fail('unexpected text after the document');
  return duplicates;
}

describe('findDuplicateKeys', () => {
  it('reports a key written twice in one object, with its path and both lines', () => {
    const text = '{\n  "task": {\n    "fromCalendar": "From {{calendar}}",\n    "notes": "Notes",\n    "fromCalendar": "From the calendar"\n  }\n}\n';
    expect(findDuplicateKeys(text)).toEqual([{ path: 'task.fromCalendar', lines: [3, 5] }]);
  });
  it('allows the same key in different objects', () => {
    expect(findDuplicateKeys('{"a": {"title": "A"}, "b": {"title": "B"}}')).toEqual([]);
  });
  it('is not fooled by quotes, braces or colons inside strings', () => {
    expect(findDuplicateKeys('{"a": "say \\"b\\": {x}", "b": "1"}')).toEqual([]);
  });
  it('compares keys as JSON reads them, escapes decoded', () => {
    expect(findDuplicateKeys('{"caf\\u00e9": 1, "café": 2}')).toEqual([{ path: 'café', lines: [1, 1] }]);
  });
  it('looks inside objects in arrays', () => {
    expect(findDuplicateKeys('{"list": [{"x": 1, "x": 2}]}')).toEqual([{ path: 'list.0.x', lines: [1, 1] }]);
  });
  it('refuses malformed JSON rather than calling it clean', () => {
    expect(() => findDuplicateKeys('{"a": 1,\n "b" 2}')).toThrow(/line 2/);
    expect(() => findDuplicateKeys('{"a": 1} trailing')).toThrow(/unexpected text/);
  });
});

describe('locale bundles', () => {
  // MUTATION: add a second "notes" inside "task" in any bundle and this fails,
  // naming the language, the key and both lines.
  it.each(languages)('%s writes no key twice in one object', (lng) => {
    const raw = readFileSync(join(process.cwd(), 'public', 'locales', lng, 'translation.json'), 'utf8');
    const duplicates = findDuplicateKeys(raw);
    expect(duplicates, duplicates.map(({ path, lines }) => `${lng}: ${path} on lines ${lines.join(' and ')}`).join('\n')).toEqual([]);
  });
});
