import { describe, it, expect, vi, afterEach } from 'vitest';
import { PROVIDER_MODELS, parseModelList, fetchProviderModels } from './ai.js';

// The 2026-10-03 field report: every built-in Gemini id had been retired by
// Google, and nothing in the app could recover without a code change.
describe('the built-in model lists', () => {
  it('carry no retired or preview Gemini ids, and the default is a stable one', () => {
    for (const m of PROVIDER_MODELS.gemini) {
      expect(m.id).not.toMatch(/preview|gemini-2\.0|gemini-1\./);
    }
    expect(PROVIDER_MODELS.gemini.find((m) => m.recommended).id).toBe('gemini-2.5-flash');
    expect(PROVIDER_MODELS.openrouter.some((m) => m.id.includes('gemini-2.0'))).toBe(false);
  });
});

describe('parseModelList (the live list, per provider shape)', () => {
  it('gemini: strips the models/ prefix, keeps only generateContent-capable models, labels with the display name', () => {
    const out = parseModelList('gemini', { models: [
      { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-pro' },
    ] });
    expect(out).toEqual([
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (gemini-3.8-flash)' },
    ]);
  });
  it('openai-shaped and ollama shapes, de-duplicated and sorted; junk ignored', () => {
    expect(parseModelList('openai', { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o' }, { id: 'gpt-4.1-mini' }, { nope: 1 }] }))
      .toEqual([{ id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' }, { id: 'gpt-4o', label: 'gpt-4o' }]);
    expect(parseModelList('ollama', { models: [{ name: 'llama3.2' }] })).toEqual([{ id: 'llama3.2', label: 'llama3.2' }]);
    expect(parseModelList('gemini', null)).toEqual([]);
  });
});

describe('fetchProviderModels', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('asks Gemini with the key in the header and surfaces the provider error message', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] }) };
    }));
    const models = await fetchProviderModels({ provider: 'gemini', apiKey: 'k' });
    expect(models.map((m) => m.id)).toEqual(['gemini-3.8-flash']);
    expect(calls[0].url).toContain('generativelanguage.googleapis.com/v1beta/models');
    expect(calls[0].init.headers['x-goog-api-key']).toBe('k');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) })));
    await expect(fetchProviderModels({ provider: 'gemini', apiKey: 'bad' })).rejects.toThrow('API key not valid');
    await expect(fetchProviderModels({ provider: 'anthropic', apiKey: 'k' })).rejects.toThrow(/No model list/);
  });
});
