import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The app shows German. aiComplete must tell the model so without any caller
// doing it, on every provider's request shape (#1789).
vi.mock('i18next', () => ({ default: { resolvedLanguage: 'de', language: 'de' } }));

import { aiComplete, aiJSON } from './ai.js';
import { languageInstruction } from './utils/aiLanguage.js';

const GERMAN = languageInstruction('de');
const SYSTEM = 'You are a friendly daily planner assistant.';

function mockFetch(reply) {
  const calls = [];
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => reply };
  });
  return calls;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { delete global.fetch; });

describe('aiComplete follows the app language', () => {
  it('appends the instruction to the system message for chat-completions providers', async () => {
    const calls = mockFetch({ choices: [{ message: { content: 'Guten Morgen.' } }] });
    const text = await aiComplete(SYSTEM, 'user text', { enabled: true, provider: 'openai', apiKey: 'k', model: 'm' });
    expect(text).toBe('Guten Morgen.');
    const system = calls[0].body.messages[0];
    expect(system.role).toBe('system');
    expect(system.content.startsWith(SYSTEM)).toBe(true);
    expect(system.content.endsWith(GERMAN)).toBe(true);
    expect(calls[0].body.messages[1].content).toBe('user text'); // the user message is untouched
  });

  it('appends it to the system field for Anthropic', async () => {
    const calls = mockFetch({ content: [{ text: 'Guten Abend.' }] });
    await aiComplete(SYSTEM, 'u', { enabled: true, provider: 'anthropic', apiKey: 'k', model: 'm' });
    expect(calls[0].body.system.endsWith(GERMAN)).toBe(true);
  });

  it('appends it to the system instruction for Gemini', async () => {
    const calls = mockFetch({ candidates: [{ content: { parts: [{ text: 'Hallo.' }] } }] });
    await aiComplete(SYSTEM, 'u', { enabled: true, provider: 'gemini', apiKey: 'k', model: 'm' });
    expect(calls[0].body.systemInstruction.parts[0].text.endsWith(GERMAN)).toBe(true);
  });

  it('appends it for Ollama, which needs no key', async () => {
    const calls = mockFetch({ message: { content: 'Servus.' } });
    await aiComplete(SYSTEM, 'u', { enabled: true, provider: 'ollama', model: 'm' });
    expect(calls[0].body.messages[0].content.endsWith(GERMAN)).toBe(true);
  });

  // The JSON prompts go through the same door, so subtask titles and
  // reschedule reasons follow the language too, while the structure is
  // protected by the instruction's second sentence.
  it('covers aiJSON through the same path', async () => {
    const calls = mockFetch({ choices: [{ message: { content: '```json\n{"subtasks":[{"title":"Gliederung schreiben","duration":30}]}\n```' } }] });
    const parsed = await aiJSON('Return ONLY valid JSON.', 'Task: "x"', { enabled: true, provider: 'openai', apiKey: 'k', model: 'm' });
    expect(parsed.subtasks[0].title).toBe('Gliederung schreiben');
    expect(calls[0].body.messages[0].content.endsWith(GERMAN)).toBe(true);
  });
});
