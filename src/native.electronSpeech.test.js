import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The desktop speech adapter: window.electronAPI.speech (async IPC from the
// preload) presented as the synchronous DayGlanceNative contract the hook
// already consumes. These walk the actual module, with a fake preload surface,
// so the seam between the two is what is tested — not a re-statement of it.

let api;
let events;
const fakeElectronAPI = ({ supported = true } = {}) => {
  events = [];
  api = {
    supported,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    // The preload returns an unsubscribe; capture the callback to drive events.
    onEvent: vi.fn((cb) => { api._cb = cb; return () => { api._cb = null; }; }),
    _cb: null,
  };
  return { isElectron: true, speech: api };
};

const load = async () => {
  vi.resetModules(); // the adapter wires onEvent once per module instance
  return await import('./native.js');
};

beforeEach(() => {
  globalThis.window = {};
});

afterEach(() => {
  delete globalThis.window;
});

describe('desktop speech adapter', () => {
  it('is absent outside Electron, so the mobile and web paths are untouched', async () => {
    const native = await load();
    expect(native.speechBridge()).toBeNull();
    expect(native.nativeSupportsSpeech()).toBe(false);
    expect(native.nativeStartSpeech()).toBeNull();
  });

  it('reports support from the preload constant, in the mobile string form', async () => {
    globalThis.window.electronAPI = fakeElectronAPI({ supported: true });
    const native = await load();
    expect(native.speechBridge().supportsSpeechRecognition()).toBe('true');
    expect(native.nativeSupportsSpeech()).toBe(true);
  });

  it('reports no support when the helper did not ship (Windows, Linux, dev without helpers)', async () => {
    globalThis.window.electronAPI = fakeElectronAPI({ supported: false });
    const native = await load();
    expect(native.nativeSupportsSpeech()).toBe(false);
  });

  it('start answers ok immediately and sends the IPC, as iOS does before authorisation', async () => {
    globalThis.window.electronAPI = fakeElectronAPI();
    const native = await load();
    expect(native.nativeStartSpeech()).toBe('ok');
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it('stop and cancel forward to the preload', async () => {
    globalThis.window.electronAPI = fakeElectronAPI();
    const native = await load();
    native.nativeStopSpeech();
    native.nativeCancelSpeech();
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });

  // The contract's delivery half: events must reach the SAME global the mobile
  // bridges call, since that is what useVoiceInput listens on.
  it('forwards partial, final and error events to window.__speechEvent', async () => {
    globalThis.window.electronAPI = fakeElectronAPI();
    const native = await load();
    native.nativeStartSpeech();
    const received = [];
    globalThis.window.__speechEvent = (ev) => received.push(ev);

    api._cb({ status: 'partial', text: 'call' });
    api._cb({ status: 'final', text: 'call mom' });
    api._cb({ status: 'error', message: 'no microphone found' });

    expect(received).toEqual([
      { status: 'partial', text: 'call' },
      { status: 'final', text: 'call mom' },
      { status: 'error', message: 'no microphone found' },
    ]);
  });

  it('subscribes to IPC events exactly once, however many times the bridge is looked up', async () => {
    globalThis.window.electronAPI = fakeElectronAPI();
    const native = await load();
    native.nativeSupportsSpeech();
    native.nativeStartSpeech();
    native.nativeStopSpeech();
    native.speechBridge();
    expect(api.onEvent).toHaveBeenCalledTimes(1);
  });

  it('drops events while no listener is installed — the modal is closed — without throwing', async () => {
    globalThis.window.electronAPI = fakeElectronAPI();
    const native = await load();
    native.nativeStartSpeech();
    delete globalThis.window.__speechEvent;
    expect(() => api._cb({ status: 'final', text: 'late' })).not.toThrow();
  });

  it('prefers the mobile WebView bridge when both somehow exist', async () => {
    // Belt and braces: an Android WebView that ALSO had electronAPI must keep
    // its own bridge, whose start() runs real authorisation.
    globalThis.window.electronAPI = fakeElectronAPI();
    globalThis.window.DayGlanceNative = {
      supportsSpeechRecognition: () => 'true',
      startSpeechRecognition: () => 'ok',
    };
    const native = await load();
    native.nativeStartSpeech();
    expect(api.start).not.toHaveBeenCalled();
  });
});
