import { describe, it, expect } from 'vitest';
import { normalizeVoiceParseResult, VoiceParseShapeError, describeShape } from './voiceParseResult.js';

const task = (title) => ({ title, tags: [], date: null, time: null, duration: 30, priority: 0 });
const edit = (taskMatch) => ({ action: 'complete', taskMatch });

describe('normalizeVoiceParseResult', () => {
  it('passes the documented shape through', () => {
    const r = normalizeVoiceParseResult({ newTasks: [task('a')], edits: [edit('b')] });
    expect(r.newTasks).toEqual([task('a')]);
    expect(r.edits).toEqual([edit('b')]);
  });

  it('fills a missing half of the documented shape with []', () => {
    expect(normalizeVoiceParseResult({ newTasks: [task('a')] })).toEqual({ newTasks: [task('a')], edits: [] });
    expect(normalizeVoiceParseResult({ edits: [edit('b')] })).toEqual({ newTasks: [], edits: [edit('b')] });
  });

  // The distinction the bug erased: a correct answer that is empty is a fact
  // about the transcript, not a failure. It must NOT throw.
  it('accepts a genuinely empty answer of the right shape as "nothing to do"', () => {
    expect(normalizeVoiceParseResult({ newTasks: [], edits: [] })).toEqual({ newTasks: [], edits: [] });
  });

  it('honours the legacy bare-array shape', () => {
    expect(normalizeVoiceParseResult([task('a'), task('b')])).toEqual({ newTasks: [task('a'), task('b')], edits: [] });
  });

  it('accepts the common "tasks" drift', () => {
    expect(normalizeVoiceParseResult({ tasks: [task('a')] })).toEqual({ newTasks: [task('a')], edits: [] });
  });

  it('wraps a single bare task or edit', () => {
    expect(normalizeVoiceParseResult(task('solo'))).toEqual({ newTasks: [task('solo')], edits: [] });
    expect(normalizeVoiceParseResult(edit('solo'))).toEqual({ newTasks: [], edits: [edit('solo')] });
  });

  it('drops entries that are not tasks or edits rather than applying them blind', () => {
    const r = normalizeVoiceParseResult({ newTasks: [task('a'), 'junk', null, { notes: 'no title' }], edits: [edit('b'), { action: 'complete' }] });
    expect(r.newTasks).toEqual([task('a')]);
    expect(r.edits).toEqual([edit('b')]);
  });

  // The report, exactly: these used to become {newTasks: [], edits: []} with no
  // error, indistinguishable from "you said nothing task-like".
  it.each([
    ['an empty object', {}],
    ['null', null],
    ['a string', 'call mom tomorrow'],
    ['a number', 42],
    ['an unrelated object', { ok: true, result: 'done' }],
    ['a prose answer wrapped in an object', { answer: 'Sure! I created the task.' }],
  ])('throws VOICE_PARSE_SHAPE for %s, so the pipeline falls back visibly', (_label, value) => {
    expect(() => normalizeVoiceParseResult(value)).toThrow(VoiceParseShapeError);
    try { normalizeVoiceParseResult(value); } catch (e) {
      expect(e.code).toBe('VOICE_PARSE_SHAPE');
      expect(e.received).toBe(describeShape(value));
    }
  });
});

describe('describeShape', () => {
  it('names the shape compactly and never leaks values', () => {
    expect(describeShape(null)).toBe('null');
    expect(describeShape([1, 2])).toBe('array of 2');
    expect(describeShape('secret text')).toBe('string');
    expect(describeShape({})).toBe('empty object');
    expect(describeShape({ apiKey: 'sk-…', b: 1 })).toBe('object with keys apiKey, b');
  });
});
