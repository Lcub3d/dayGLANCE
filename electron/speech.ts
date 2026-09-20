import { ipcMain, app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  encodeCommand,
  parseEventLine,
  splitLines,
  rendererEventFrom,
  helperCandidates,
  isSpeechSupported,
  type RendererSpeechEvent,
  type SpeechCommand,
} from './speechProtocol.js';

// ── macOS on-device speech recognition ─────────────────────────────────────────
//
// Voice input without an AI provider, for the desktop build. A signed Swift
// helper (electron/native/speech-helper) wraps SFSpeechRecognizer and is driven
// over stdin/stdout; this module is the plumbing between it and the renderer,
// which sees the same DayGlanceNative speech contract Android and iOS implement
// (src/native.js adapts the IPC surface below to it).
//
// Why not Chromium's SpeechRecognition: it streams audio to the browser vendor's
// cloud service, which Electron builds cannot reach — `new webkitSpeechRecognition()
// .start()` in the packaged app fails with `network` before any app code runs.
// Apple's recogniser needs no key and prefers the on-device model.
//
// Lifecycle: one helper process per app session, spawned on the first start and
// reused; killed on quit. The helper itself exits on stdin EOF, so a crashed
// main process cannot orphan it. Everything no-ops on non-macOS platforms and
// when the helper binary is missing (Windows/Linux Electron, dev builds that
// skipped `npm run build:helpers`), so the renderer simply sees no native speech
// and falls back to typing.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function helperPath(): string | null {
  const candidates = helperCandidates({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    devRoot: path.join(__dirname, '..'),
    join: path.join,
  });
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function supported(): boolean {
  return isSpeechSupported(process.platform, helperPath() !== null);
}

let child: ChildProcessWithoutNullStreams | null = null;
let stdoutRest = '';
// The renderer that asked for the current session. Events go to it alone; a
// second window starting recognition takes the session over.
let activeSender: Electron.WebContents | null = null;

function deliver(event: RendererSpeechEvent): void {
  const target = activeSender;
  if (target && !target.isDestroyed()) target.send('speech:event', event);
  // final and error both end the session from the renderer's point of view.
  if (event.status !== 'partial') activeSender = null;
}

function ensureHelper(): ChildProcessWithoutNullStreams | null {
  if (child && child.exitCode === null && !child.killed) return child;
  const bin = helperPath();
  if (!bin) return null;

  const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  child = proc;
  stdoutRest = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    const { lines, rest } = splitLines(stdoutRest + chunk);
    stdoutRest = rest;
    for (const line of lines) {
      const event = parseEventLine(line);
      if (!event) continue;
      const forRenderer = rendererEventFrom(event);
      if (forRenderer) deliver(forRenderer);
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', () => { /* framework chatter; never the renderer's concern */ });
  // A write after the helper has died surfaces as EPIPE on stdin. Without a
  // listener that is an unhandled stream error in the MAIN process; with one,
  // the exit handler below reports it to the renderer as a session error.
  proc.stdin.on('error', () => { /* handled via exit */ });
  proc.on('error', () => {
    if (child === proc) child = null;
    deliver({ status: 'error', message: 'speech helper could not be started' });
  });
  proc.on('exit', () => {
    if (child === proc) child = null;
    // Dying mid-session is an error the renderer must hear about, or it stays
    // on "Recording…" forever. A quiet exit between sessions is nothing.
    if (activeSender) deliver({ status: 'error', message: 'speech helper exited' });
  });
  return proc;
}

function send(command: SpeechCommand): boolean {
  const proc = ensureHelper();
  if (!proc) return false;
  try {
    proc.stdin.write(encodeCommand(command));
    return true;
  } catch {
    return false;
  }
}

export function registerSpeechHandlers(): void {
  // Synchronous on purpose: the preload reads it once at startup and exposes a
  // constant, so the renderer never pays an IPC round-trip per render.
  ipcMain.on('speech:supports', (event) => {
    event.returnValue = supported();
  });

  ipcMain.on('speech:start', (event) => {
    if (!supported()) {
      event.sender.send('speech:event', { status: 'error', message: 'speech recognition not available' });
      return;
    }
    activeSender = event.sender;
    if (!send({ cmd: 'start' })) {
      deliver({ status: 'error', message: 'speech helper could not be started' });
    }
  });

  ipcMain.on('speech:stop', () => {
    send({ cmd: 'stop' });
  });

  ipcMain.on('speech:cancel', () => {
    send({ cmd: 'cancel' });
    // No final event follows a cancel, by contract.
    activeSender = null;
  });

  app.on('will-quit', () => {
    const proc = child;
    if (!proc) return;
    try { proc.stdin.write(encodeCommand({ cmd: 'quit' })); } catch { /* already gone */ }
    try { proc.kill(); } catch { /* already gone */ }
    child = null;
  });
}
