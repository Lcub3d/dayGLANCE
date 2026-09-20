import { describe, it, expect } from 'vitest';
import {
  encodeCommand,
  parseEventLine,
  splitLines,
  rendererEventFrom,
  helperCandidates,
  isSpeechSupported,
  HELPER_NAME,
} from './speechProtocol.js';

// The helper is a separate Swift process the tests cannot run. What they CAN
// pin is the contract on each side of the pipe: every command we send is a
// frame it parses, every frame it emits maps onto the renderer's existing
// window.__speechEvent handling, and nothing unexpected on stdout can take the
// session down.

describe('encodeCommand', () => {
  it.each(['supports', 'start', 'stop', 'cancel', 'quit'] as const)('frames %s as one JSON line', (cmd) => {
    const wire = encodeCommand({ cmd });
    expect(wire.endsWith('\n')).toBe(true);
    expect(JSON.parse(wire)).toEqual({ cmd });
    // One frame per line: a newline inside the payload would split it.
    expect(wire.slice(0, -1)).not.toContain('\n');
  });
});

describe('parseEventLine', () => {
  it('reads every event the helper emits', () => {
    expect(parseEventLine('{"status":"ready"}')).toEqual({ status: 'ready' });
    expect(parseEventLine('{"status":"supports","value":true}')).toEqual({ status: 'supports', value: true });
    expect(parseEventLine('{"status":"supports","value":false}')).toEqual({ status: 'supports', value: false });
    expect(parseEventLine('{"status":"partial","text":"call mom"}')).toEqual({ status: 'partial', text: 'call mom' });
    expect(parseEventLine('{"status":"final","text":"call mom tomorrow"}')).toEqual({ status: 'final', text: 'call mom tomorrow' });
    expect(parseEventLine('{"status":"error","message":"no microphone found"}')).toEqual({ status: 'error', message: 'no microphone found' });
  });

  it('tolerates surrounding whitespace and an empty final transcript', () => {
    expect(parseEventLine('  {"status":"final","text":""}  \r')).toEqual({ status: 'final', text: '' });
  });

  it('never throws on garbage — a framework log line must not end the session', () => {
    for (const junk of ['', '   ', 'not json', '42', 'null', '[]', '{"status":"nope"}', '{"status":"partial"}', '{"text":"orphan"}']) {
      expect(parseEventLine(junk)).toBeNull();
    }
  });

  it('reports an error with no message as unknown rather than an empty string', () => {
    expect(parseEventLine('{"status":"error"}')).toEqual({ status: 'error', message: 'unknown' });
    expect(parseEventLine('{"status":"error","message":""}')).toEqual({ status: 'error', message: 'unknown' });
  });

  it('coerces a non-boolean supports value to false, never to true', () => {
    expect(parseEventLine('{"status":"supports","value":"true"}')).toEqual({ status: 'supports', value: false });
    expect(parseEventLine('{"status":"supports"}')).toEqual({ status: 'supports', value: false });
  });
});

describe('splitLines', () => {
  it('returns complete lines and carries the unterminated tail forward', () => {
    expect(splitLines('a\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' });
  });

  it('yields no tail when the chunk ends on a newline', () => {
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], rest: '' });
  });

  it('reassembles a frame split across two reads', () => {
    const first = splitLines('{"status":"par');
    expect(first.lines).toEqual([]);
    const second = splitLines(first.rest + 'tial","text":"hi"}\n');
    expect(second.lines.map(parseEventLine)).toEqual([{ status: 'partial', text: 'hi' }]);
    expect(second.rest).toBe('');
  });

  it('handles an empty chunk', () => {
    expect(splitLines('')).toEqual({ lines: [], rest: '' });
  });
});

describe('rendererEventFrom', () => {
  // The renderer already handles exactly these three from the mobile bridges
  // (useVoiceInput's window.__speechEvent effect). Nothing else may reach it.
  it('passes partial, final and error through in the mobile shape', () => {
    expect(rendererEventFrom({ status: 'partial', text: 'a' })).toEqual({ status: 'partial', text: 'a' });
    expect(rendererEventFrom({ status: 'final', text: 'a b' })).toEqual({ status: 'final', text: 'a b' });
    expect(rendererEventFrom({ status: 'error', message: 'm' })).toEqual({ status: 'error', message: 'm' });
  });

  it('keeps the helper-only frames in the main process', () => {
    expect(rendererEventFrom({ status: 'ready' })).toBeNull();
    expect(rendererEventFrom({ status: 'supports', value: true })).toBeNull();
  });
});

describe('helperCandidates', () => {
  const join = (...p: string[]) => p.join('/');

  it('looks under Contents/Resources/speech-helper in a packaged build', () => {
    expect(helperCandidates({ isPackaged: true, resourcesPath: '/App/Contents/Resources', devRoot: '/repo', join }))
      .toEqual([`/App/Contents/Resources/speech-helper/${HELPER_NAME}`]);
  });

  it('looks at the local build output in dev', () => {
    expect(helperCandidates({ isPackaged: false, resourcesPath: '/unused', devRoot: '/repo', join }))
      .toEqual([`/repo/electron/native/speech-helper/build/${HELPER_NAME}`]);
  });
});

describe('isSpeechSupported', () => {
  it('requires macOS AND a shipped helper', () => {
    expect(isSpeechSupported('darwin', true)).toBe(true);
    expect(isSpeechSupported('darwin', false)).toBe(false);
    expect(isSpeechSupported('win32', true)).toBe(false);
    expect(isSpeechSupported('linux', true)).toBe(false);
  });
});
