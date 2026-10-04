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
  it('anthropic: no Claude 3 ids, the default is the current Sonnet, and the list is fetchable like the others', () => {
    for (const m of PROVIDER_MODELS.anthropic) expect(m.id).not.toMatch(/claude-3/);
    expect(PROVIDER_MODELS.anthropic.find((m) => m.recommended).id).toBe('claude-sonnet-5-5');
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
    await expect(fetchProviderModels({ provider: 'nope', apiKey: 'k' })).rejects.toThrow(/No model list/);
  });
  it('asks Anthropic with the direct-from-browser headers, follows the page cursor, and labels with the display name', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (url.includes('after_id=')) {
        return { ok: true, json: async () => ({ data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', type: 'model' }], has_more: false }) };
      }
      return { ok: true, json: async () => ({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', type: 'model' }, { id: 'claude-opus-5-5' }], has_more: true, last_id: 'claude-opus-5-5' }) };
    }));
    const models = await fetchProviderModels({ provider: 'anthropic', apiKey: 'sk' });
    expect(models).toEqual([
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (claude-haiku-4-5)' },
      { id: 'claude-opus-5-5', label: 'claude-opus-5-5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (claude-sonnet-5-5)' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(calls[1].url).toBe('https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5');
    for (const c of calls) {
      expect(c.init.headers['x-api-key']).toBe('sk');
      expect(c.init.headers['anthropic-version']).toBe('2023-06-01');
      expect(c.init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) })));
    await expect(fetchProviderModels({ provider: 'anthropic', apiKey: 'bad' })).rejects.toThrow('invalid x-api-key');
  });
});
