// The wire protocol between the Electron main process and the on-device speech
// helper (electron/native/speech-helper), and the resolution of where that
// helper lives. Pure functions, no Electron imports, so the whole thing is unit
// tested without a runtime; electron/speech.ts is the thin plumbing over it.
//
// Helper I/O is newline-delimited JSON in both directions. The events it emits
// are the DayGlanceNative speech contract the mobile bridges already implement:
//   { status: 'partial' | 'final', text }  and  { status: 'error', message }
// plus two helper-only frames ('ready', 'supports') that never reach the renderer.

export type SpeechCommand = { cmd: 'supports' | 'start' | 'stop' | 'cancel' | 'quit' };

export type HelperEvent =
  | { status: 'ready' }
  | { status: 'supports'; value: boolean }
  | { status: 'partial'; text: string }
  | { status: 'final'; text: string }
  | { status: 'error'; message: string };

/** What the renderer's window.__speechEvent receives — the mobile contract. */
export type RendererSpeechEvent =
  | { status: 'partial'; text: string }
  | { status: 'final'; text: string }
  | { status: 'error'; message: string };

export function encodeCommand(command: SpeechCommand): string {
  return JSON.stringify({ cmd: command.cmd }) + '\n';
}

/**
 * Parses one line of helper stdout. Anything that is not a well-formed event
 * yields null rather than throwing: a stray log line from a framework must not
 * take the session down, and a malformed frame is not something the renderer
 * can act on anyway.
 */
export function parseEventLine(line: string): HelperEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try { obj = JSON.parse(trimmed); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  switch (rec.status) {
    case 'ready':
      return { status: 'ready' };
    case 'supports':
      return { status: 'supports', value: rec.value === true };
    case 'partial':
    case 'final':
      return typeof rec.text === 'string' ? { status: rec.status, text: rec.text } : null;
    case 'error':
      return { status: 'error', message: typeof rec.message === 'string' && rec.message ? rec.message : 'unknown' };
    default:
      return null;
  }
}

/**
 * Splits a stdout chunk into complete lines, carrying the unterminated tail
 * forward. A pipe delivers bytes, not frames: one read may hold two events, or
 * half of one.
 */
export function splitLines(buffered: string): { lines: string[]; rest: string } {
  const parts = buffered.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

/** Helper-only frames stay in the main process; the rest is the renderer's. */
export function rendererEventFrom(event: HelperEvent): RendererSpeechEvent | null {
  switch (event.status) {
    case 'partial':
    case 'final':
      return { status: event.status, text: event.text };
    case 'error':
      return { status: 'error', message: event.message };
    default:
      return null;
  }
}

export const HELPER_NAME = 'dayglance-speech-helper';

/**
 * Where to look for the helper binary, in order: bundled under
 * Contents/Resources/speech-helper in packaged builds (electron-builder
 * extraResources), or the local build output in dev. Mirrors the calendar
 * helper's resolution exactly.
 */
export function helperCandidates(opts: {
  isPackaged: boolean;
  resourcesPath: string;
  devRoot: string;
  join: (...parts: string[]) => string;
}): string[] {
  const { isPackaged, resourcesPath, devRoot, join } = opts;
  return isPackaged
    ? [join(resourcesPath, 'speech-helper', HELPER_NAME)]
    : [join(devRoot, 'electron', 'native', 'speech-helper', 'build', HELPER_NAME)];
}

/** macOS only, and only when the helper actually shipped. */
export function isSpeechSupported(platform: string, helperExists: boolean): boolean {
  return platform === 'darwin' && helperExists;
}
