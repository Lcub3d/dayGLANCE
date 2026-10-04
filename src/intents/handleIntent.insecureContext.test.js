// #1968: a chore sent from lastGLANCE to a dayGLANCE served over plain HTTP on
// a LAN address logged "Cannot read properties of undefined (reading 'digest')".
// Browsers expose `crypto.subtle` only in secure contexts, and the inbound
// create path hashes twice: `createKey` (@glance-apps/intents) then
// `deterministicTaskId`. This walks the user's exact event through the real
// handler under a crypto object with no `subtle`, as that browser presents it,
// and checks that the shim main.jsx installs makes it land as the SAME task id
// a secure-context device derives, so the two never diverge over sync.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { installSubtleDigestShim } from '../utils/sha256.js';
import { handleIntent } from './handleIntent.js';

// The event from the issue, verbatim.
const EVENT = {
  schema_version: 1,
  event_id: '20261004T101346Z-47e96d',
  emitted_at: '2026-10-04T10:13:46.686Z',
  emitted_by: 'app.lastglance',
  action: 'create',
  payload: {
    title: 'mop',
    due: '2026-10-04',
    all_day: true,
    source_app: 'app.lastglance',
    source_entity_id: '1ef5d326-aa60-41b1-ba76-d942b9f45ca1',
  },
};

function makeCapture() {
  const state = { tasks: [], unscheduledTasks: [], recurringTasks: [], projects: [] };
  return {
    get tasks() { return state.tasks; },
    get unscheduledTasks() { return state.unscheduledTasks; },
    get recurringTasks() { return state.recurringTasks; },
    get projects() { return state.projects; },
    setTasks: fn => { state.tasks = fn(state.tasks); },
    setUnscheduledTasks: fn => { state.unscheduledTasks = fn(state.unscheduledTasks); },
    setRecurringTasks: fn => { state.recurringTasks = fn(state.recurringTasks); },
    get _tasks() { return state.tasks; },
  };
}

async function receive() {
  const ctx = makeCapture();
  const result = await handleIntent(EVENT.action, EVENT.payload, { ...ctx, eventId: EVENT.event_id });
  return { result, tasks: ctx._tasks };
}

// What an insecure-context browser hands the page: getRandomValues and the
// randomUUID polyfill from main.jsx, but no `subtle` at all.
function insecureCrypto() {
  return {
    getRandomValues: (arr) => webcrypto.getRandomValues(arr),
    randomUUID: () => webcrypto.randomUUID(),
  };
}

describe('inbound create from lastGLANCE in an insecure context (#1968)', () => {
  let secureId;

  beforeEach(async () => {
    const { result } = await receive();
    expect(result.success).toBe(true);
    secureId = result.task_id;
    expect(secureId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reproduces the reported error when crypto.subtle is absent and nothing shims it', async () => {
    vi.stubGlobal('crypto', insecureCrypto());
    await expect(receive()).rejects.toThrow(/reading 'digest'/);
  });

  it('with the shim main.jsx installs, the chore lands with the id a secure device derives', async () => {
    const fake = insecureCrypto();
    vi.stubGlobal('crypto', fake);
    expect(installSubtleDigestShim(fake)).toBe(true);

    const { result, tasks } = await receive();
    expect(result.success).toBe(true);
    expect(result.error).toBe('');
    expect(result.task_id).toBe(secureId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: secureId,
      title: 'mop',
      date: '2026-10-04',
      source_app: 'app.lastglance',
      source_entity_id: '1ef5d326-aa60-41b1-ba76-d942b9f45ca1',
    });
    // The intent key (hashed by @glance-apps/intents through the shim) is the
    // dedupe handle; a second delivery must find the first copy, not add one.
    const again = await handleIntent(EVENT.action, EVENT.payload, {
      tasks, unscheduledTasks: [], recurringTasks: [], projects: [],
      setTasks: fn => { fn(tasks); }, setUnscheduledTasks: fn => fn([]), setRecurringTasks: fn => fn([]),
      eventId: EVENT.event_id,
    });
    expect(again.success).toBe(true);
    expect(again.task_id).toBe(secureId);
  });
});
