import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Follow the existing hook capture harness (useTodoistSync.test.js): state
// survives explicit re-renders, effects are not mounted.
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
// No AI provider and no native STT: the Web Speech API is the only path left —
// the browser/PWA tier. (The desktop app never reaches it: native speech takes
// priority, see native.electronSpeech.test.js.)
vi.mock('../native.js', () => ({
  nativeStartRecording: () => null,
  nativeStopRecording: () => null,
  triggerHaptic: () => {},
  nativeSupportsSpeech: () => false,
  nativeStartSpeech: () => 'ok',
  nativeStopSpeech: () => {},
  nativeCancelSpeech: () => {},
}));

const { default: useVoiceInput } = await import('./useVoiceInput.js');

// The recognition object the browser hands back: it constructs and start()s
// happily even where the vendor's service cannot be reached — the failure only
// ever arrives later, through onerror.
let recognition;
class FakeSpeechRecognition {
  constructor() { recognition = this; this.started = false; }
  start() { this.started = true; }
  stop() {}
  abort() {}
}

const SETTERS = [
  'setTasks', 'setUnscheduledTasks', 'setRecurringTasks', 'setShowVoiceInput',
  'setVoiceTranscript', 'setVoiceIsRecording', 'setVoiceIsTranscribing',
  'setVoiceParsedTasks', 'setVoiceParsedEdits', 'setVoiceIsParsing',
  'setVoiceParseError', 'setVoiceEditingParsed', 'setVoiceManualMode',
  'setVoiceMicError',
];

let seen;
// Named use* to satisfy rules-of-hooks, matching useTodoistSync.test.js:
// one call is one render of the hook.
const useTestVoice = (aiConfig = { enabled: false, provider: 'openai', apiKey: '' }) => {
  stateCursor = 0;
  refCursor = 0;
  seen = {};
  const deps = {
    aiConfig,
    allTags: [], colors: [{ class: 'bg-blue-500' }],
    tasks: [], unscheduledTasks: [],
    isVisibleForUser: () => true,
    pushUndo: () => {}, moveToRecycleBin: () => {},
    showVoiceInput: true,
    voiceCanRecord: false,
    voiceTranscript: '', voiceIsRecording: false, voiceIsTranscribing: false,
    voiceParsedTasks: null, voiceParsedEdits: null,
    voiceEditingParsed: null, voiceManualMode: false,
    voiceRecorderRef: refs[0] || (refs[0] = { current: null }),
    voiceAudioChunksRef: refs[1] || (refs[1] = { current: [] }),
    voiceAutoStartRef: refs[2] || (refs[2] = { current: false }),
    voiceAllTagsRef: refs[3] || (refs[3] = { current: [] }),
    voiceBuildTaskContextRef: refs[4] || (refs[4] = { current: () => '' }),
    voiceResolveTaskMatchRef: refs[5] || (refs[5] = { current: () => null }),
  };
  for (const name of SETTERS) deps[name] = v => { seen[name] = v; };
  refCursor = 6;
  return useVoiceInput(deps);
};

const failWith = (error) => recognition.onerror({ error });

beforeEach(() => {
  states = [];
  refs = [];
  recognition = undefined;
  globalThis.window = {
    SpeechRecognition: FakeSpeechRecognition,
    navigator: { onLine: true, language: 'en-US' },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: globalThis.window.navigator, configurable: true, writable: true,
  });
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.navigator;
});

describe('Web Speech tier — an unreachable recognition service', () => {
  it('offers the microphone where the interface exists', () => {
    expect(useTestVoice().voiceHasTranscription).toBe(true);
  });

  // The browser reports 'network' AFTER start() succeeded. Leaving the user on
  // the microphone screen means every further press fails identically.
  it('drops the user into typing with the reason, instead of a dead microphone', () => {
    const hook = useTestVoice();
    hook.voiceStartRecording();
    expect(recognition.started).toBe(true);

    failWith('network');

    expect(seen.setVoiceManualMode).toBe(true);
    expect(seen.setVoiceMicError).toBe('error');
    expect(seen.setVoiceParseError).toMatch(/speech recognition service/i);
    expect(seen.setVoiceIsRecording).toBe(false);
  });

  // No verdict is remembered: a transient outage must not cost a microphone
  // that works, and the next open offers it again.
  it('keeps offering the microphone afterwards — nothing is persisted', () => {
    useTestVoice().voiceStartRecording();
    failWith('network');
    expect(useTestVoice().voiceHasTranscription).toBe(true);
  });

  it('leaves permission failures on the microphone screen with their own message', () => {
    useTestVoice().voiceStartRecording();
    failWith('not-allowed');
    expect(seen.setVoiceParseError).toMatch(/microphone access denied/i);
    expect(seen.setVoiceManualMode).toBeUndefined();
  });

  it('ignores the routine aborted/no-speech endings entirely', () => {
    useTestVoice().voiceStartRecording();
    for (const error of ['aborted', 'no-speech']) {
      seen = {};
      failWith(error);
      expect(seen.setVoiceParseError).toBeUndefined();
      expect(seen.setVoiceMicError).toBeUndefined();
    }
  });
});

// The other half of the toggle: not just WHAT parses, but WHERE the audio goes.
// With a transcribing provider on and the toggle off, recording must take the
// platform-speech route (here Web Speech), never MediaRecorder → Whisper.
describe('the Settings › AI voice toggle routes the recording path', () => {
  const whisperCapable = (voiceTaskInput) =>
    ({ enabled: true, provider: 'openai', apiKey: 'k', model: 'whisper-1', features: { voiceTaskInput } });

  it('toggle off: platform speech, not AI transcription', () => {
    useTestVoice(whisperCapable(false)).voiceStartRecording();
    expect(recognition?.started).toBe(true);
  });

  it('toggle on: AI transcription, so no platform recogniser is constructed', () => {
    useTestVoice(whisperCapable(true)).voiceStartRecording();
    expect(recognition).toBeUndefined();
  });
});
