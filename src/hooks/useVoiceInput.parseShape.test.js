import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same hook capture harness as useVoiceInput.speech.test.js. This walks the
// AI-parse leg end to end — a configured provider, a transcript, and a model
// answering in a shape the prompt did not ask for. The report was "no error,
// it just says it failed to parse a task", so what is asserted is what the
// user would SEE: a notice, and tasks from the deterministic parser.

let states = [];
let stateCursor = 0;
let refs = [];
let refCursor = 0;
vi.mock('react', () => ({
  useCallback: fn => fn,
  useEffect: () => {},
  useRef: value => {
    const index = refCursor++;
    if (!refs[index]) refs[index] = { current: value };
    return refs[index];
  },
  useState: initial => {
    const index = stateCursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => {
      states[index] = typeof next === 'function' ? next(states[index]) : next;
    }];
  },
}));
vi.mock('i18next', () => ({ default: { t: (key, opts) => opts?.defaultValue ?? key } }));
vi.mock('../native.js', () => ({
  nativeStartRecording: () => null,
  nativeStopRecording: () => null,
  triggerHaptic: () => {},
  nativeSupportsSpeech: () => false,
  nativeStartSpeech: () => null,
  nativeStopSpeech: () => {},
  nativeCancelSpeech: () => {},
}));

const aiJSON = vi.fn();
vi.mock('../ai.js', async (importOriginal) => ({
  ...(await importOriginal()),
  aiJSON: (...args) => aiJSON(...args),
}));

const { default: useVoiceInput } = await import('./useVoiceInput.js');

const SETTERS = [
  'setTasks', 'setUnscheduledTasks', 'setRecurringTasks', 'setShowVoiceInput',
  'setVoiceTranscript', 'setVoiceIsRecording', 'setVoiceIsTranscribing',
  'setVoiceParsedTasks', 'setVoiceParsedEdits', 'setVoiceIsParsing',
  'setVoiceParseError', 'setVoiceEditingParsed', 'setVoiceManualMode',
  'setVoiceMicError',
];

let seen;
/** One render of the hook with a given transcript, AI parse configured. */
const useTestVoice = (voiceTranscript, extraDeps = {}) => {
  stateCursor = 0;
  refCursor = 0;
  seen = {};
  const deps = {
    // A keyed, non-transcribing provider: parsing goes to the AI, speech does not.
    aiConfig: { enabled: true, provider: 'anthropic', apiKey: 'k', model: 'm' },
    allTags: [], colors: [{ class: 'bg-blue-500' }],
    tasks: [], unscheduledTasks: [],
    isVisibleForUser: () => true,
    pushUndo: () => {}, moveToRecycleBin: () => {},
    showVoiceInput: true,
    voiceCanRecord: false,
    voiceTranscript, voiceIsRecording: false, voiceIsTranscribing: false,
    voiceParsedTasks: null, voiceParsedEdits: null,
    voiceEditingParsed: null, voiceManualMode: false,
    voiceRecorderRef: refs[0] || (refs[0] = { current: null }),
    voiceAudioChunksRef: refs[1] || (refs[1] = { current: [] }),
    voiceAutoStartRef: refs[2] || (refs[2] = { current: false }),
    voiceAllTagsRef: refs[3] || (refs[3] = { current: [] }),
    voiceBuildTaskContextRef: refs[4] || (refs[4] = { current: () => 'No tasks currently.' }),
    voiceResolveTaskMatchRef: refs[5] || (refs[5] = { current: () => null }),
    ...extraDeps,
  };
  for (const name of SETTERS) deps[name] = v => { seen[name] = v; };
  refCursor = 6;
  return useVoiceInput(deps);
};

// The modal's Parse button and the post-transcription parse share one path
// (parseTranscriptNow); voiceParseWithAI is its public entry. Named use* to
// satisfy rules-of-hooks, as the harness helpers in the sibling tests are.
// Synchronous on purpose — rules-of-hooks forbids a hook call inside an
// async function; the returned promise is what the tests await.
const useParse = (text, extraDeps) => useTestVoice(text, extraDeps).voiceParseWithAI();

beforeEach(() => {
  states = [];
  refs = [];
  aiJSON.mockReset();
  globalThis.window = { navigator: { language: 'en-US' } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.localStorage;
});

describe('AI voice parse — response shape', () => {
  // The report, exactly. Before: {} → newTasks [] → "No tasks or edits were
  // parsed from your input", and no error anywhere.
  it('an empty-object answer falls back to the deterministic parser WITH a visible notice', async () => {
    aiJSON.mockResolvedValue({});
    await useParse('call mom tomorrow at 3pm');

    expect(aiJSON).toHaveBeenCalledTimes(1);
    expect(seen.setVoiceParseError).toMatch(/format the app couldn't read/i);
    expect(seen.setVoiceParsedTasks.length).toBeGreaterThan(0);
    expect(seen.setVoiceParsedTasks[0].title).toMatch(/call mom/i);
    expect(seen.setVoiceParsedEdits).toEqual([]);
    expect(seen.setVoiceIsParsing).toBe(false);
  });

  it.each([
    ['a prose answer in an object', { answer: 'Sure, I added it.' }],
    ['null', null],
    ['a bare string', 'call mom'],
  ])('%s is treated the same way', async (_label, value) => {
    aiJSON.mockResolvedValue(value);
    await useParse('buy milk');
    expect(seen.setVoiceParseError).toMatch(/format the app couldn't read/i);
    expect(seen.setVoiceParsedTasks.length).toBeGreaterThan(0);
  });

  // The distinction the bug erased. A right-shaped answer that is empty is a
  // fact about the transcript — no notice, and the deterministic parser must
  // NOT be substituted, or "hello there" would become a task called "Hello there".
  it('a right-shaped empty answer is accepted as "nothing to do", with no notice', async () => {
    aiJSON.mockResolvedValue({ newTasks: [], edits: [] });
    await useParse('hello there');

    expect(seen.setVoiceParseError).toBe(''); // cleared by voiceParseWithAI, never set after
    expect(seen.setVoiceParsedTasks).toEqual([]);
    expect(seen.setVoiceParsedEdits).toEqual([]);
  });

  it('accepts the common "tasks" drift silently and capitalises titles', async () => {
    aiJSON.mockResolvedValue({ tasks: [{ title: 'buy milk', tags: [], date: null, time: null, duration: 15, priority: 0 }] });
    await useParse('buy milk');

    expect(seen.setVoiceParseError).toBe('');
    expect(seen.setVoiceParsedTasks).toEqual([expect.objectContaining({ title: 'Buy milk', duration: 15 })]);
  });

  it('resolves edit commands against the live task list, as before', async () => {
    // The hook installs its OWN resolver into voiceResolveTaskMatchRef on every
    // render, so the only honest way to test resolution is through real tasks.
    const report = { id: 't1', title: 'Write report', completed: false, duration: 30 };
    aiJSON.mockResolvedValue({ newTasks: [], edits: [{ action: 'complete', taskMatch: 'report' }] });
    await useParse('mark the report as done', { unscheduledTasks: [report] });

    expect(seen.setVoiceParsedEdits).toEqual([
      expect.objectContaining({ action: 'complete', resolvedTask: report, source: 'inbox' }),
    ]);
  });

  // The Settings › AI "Voice task input" toggle: off means the model is not
  // consulted at all — deterministic parse, no notice — even with a keyed,
  // enabled provider. It used to have no effect on the pipeline whatsoever.
  it('with AI on but the voice toggle off, parses deterministically and never calls the model', async () => {
    aiJSON.mockResolvedValue({ newTasks: [{ title: 'from the model' }], edits: [] });
    await useParse('call mom tomorrow at 3pm', {
      aiConfig: { enabled: true, provider: 'anthropic', apiKey: 'k', model: 'm', features: { voiceTaskInput: false } },
    });

    expect(aiJSON).not.toHaveBeenCalled();
    expect(seen.setVoiceParseError).toBe('');
    expect(seen.setVoiceParsedTasks[0].title).toMatch(/call mom/i);
    expect(seen.setVoiceParsedEdits).toEqual([]);
  });

  // Regression guard for the path that already worked: a thrown AI error keeps
  // its own message and still falls back.
  it('a failed AI call keeps its message and falls back, unchanged', async () => {
    aiJSON.mockRejectedValue(new Error('AI response did not contain valid JSON'));
    await useParse('call mom tomorrow');

    expect(seen.setVoiceParseError).toBe('AI response did not contain valid JSON');
    expect(seen.setVoiceParsedTasks[0].title).toMatch(/call mom/i);
  });
});
