import { describe, expect, it, vi } from 'vitest';
import { createSwot, createVision, createWish, defaultDocument, updateWish, validateDocument } from './model.js';
import { acceptSwotSuggestion, editableSwot, parseSwotSuggestions, saveStrategyVision, saveSwot, swotPrompts } from './swot.js';
import { createPlannerStore, STORAGE_KEY } from './store.js';

function fixture() {
  const doc = { ...defaultDocument(['Keep learning']), wishes: [createWish('Write and share', 'creation', 'wish')] };
  const draft = createSwot();
  draft.factors.s = 'I write every week';
  draft.factors.o = 'A local writing group';
  draft.strategies.so = [{ id: 'strategy', text: 'Publish 2 books' }];
  return { doc, draft };
}

describe('per-wish SWOT storage and conversion', () => {
  it('opens old documents without migration writes or invented analysis', () => {
    const { doc } = fixture();
    expect(validateDocument(doc)).toBe(doc);
    const draft = editableSwot();
    expect(draft.strategies.so).toHaveLength(1);
    expect(draft.strategies.so[0].text).toBe('');
    expect(doc.wishes[0].swot).toBeUndefined();
  });
  it('preserves unrelated edits while saving analysis and omits blank writing rows', () => {
    const { doc, draft } = fixture();
    draft.strategies.wo = [{ id: 'empty', text: '  ' }];
    const next = saveSwot(updateWish(doc, 'wish', { title: 'A newer title' }), 'wish', draft);
    expect(next.wishes[0]).toMatchObject({ title: 'A newer title', swot: { factors: { s: 'I write every week' }, strategies: { wo: [] } } });
    expect(next.principles).toEqual(doc.principles);
    expect(doc.wishes[0].swot).toBeUndefined();
    expect(validateDocument(next)).toBe(next);
  });
  it('protects newer analysis and a deleted wish from stale forms', () => {
    const { doc, draft } = fixture();
    const saved = saveSwot(doc, 'wish', draft);
    expect(() => saveSwot(saved, 'wish', draft)).toThrow('conflict');
    expect(() => saveSwot({ ...doc, wishes: [] }, 'wish', draft)).toThrow('missing');
  });
  it('promotes a strategy atomically and rejects duplicate creation from a second tab', () => {
    const { doc, draft } = fixture();
    const saved = saveSwot(doc, 'wish', draft);
    const source = { ...draft.strategies.so[0], group: 'so' };
    const vision = createVision(source.text, '2026-09-21', 'vision');
    const next = saveStrategyVision(saved, 'wish', vision, null, source);
    expect(next.wishes[0].visions).toHaveLength(1);
    expect(next.wishes[0].visions[0]).toMatchObject({ title: 'Publish 2 books', amount: 5, unit: 'year' });
    expect(next.wishes[0].swot.strategies.so[0].visionId).toBe('vision');
    expect(() => saveStrategyVision(next, 'wish', { ...vision, id: 'duplicate' }, null, source)).toThrow('conflict');
    expect(validateDocument(next)).toBe(next);
  });
  it('updates the linked vision, and permits a replacement after that vision is removed', () => {
    const { doc, draft } = fixture();
    let saved = saveSwot(doc, 'wish', draft);
    let source = { ...draft.strategies.so[0], group: 'so' };
    const vision = createVision(source.text, '2026-09-21', 'vision');
    saved = saveStrategyVision(saved, 'wish', vision, null, source);
    source = { ...source, visionId: 'vision' };
    saved = saveStrategyVision(saved, 'wish', { ...vision, title: 'Publish 3 books' }, vision, source);
    expect(saved.wishes[0].visions).toHaveLength(1);
    saved = updateWish(saved, 'wish', { visions: [] });
    saved = saveStrategyVision(saved, 'wish', { ...vision, id: 'replacement' }, null, source);
    expect(saved.wishes[0].swot.strategies.so[0].visionId).toBe('replacement');
  });
  it('does not link an invalid vision or a strategy edited in another tab', () => {
    const { doc, draft } = fixture();
    const saved = saveSwot(doc, 'wish', draft);
    const source = { ...draft.strategies.so[0], group: 'so' };
    expect(() => saveStrategyVision(saved, 'wish', createVision('Not measurable'), null, source)).toThrow('measure');
    expect(() => saveStrategyVision(saved, 'wish', createVision('Write 2 books'), null, { ...source, text: 'Stale' })).toThrow('conflict');
    expect(saved.wishes[0].visions).toEqual([]);
    expect(saved.wishes[0].swot.strategies.so[0].visionId).toBeUndefined();
  });
  it.each(['version', 'oversized', 'duplicate', 'reference'])('rejects malformed analysis (%s) without accepting a corrupt document', variant => {
    const { doc, draft } = fixture();
    if (variant === 'version') draft.version = 2;
    if (variant === 'oversized') draft.factors.t = 'x'.repeat(4001);
    if (variant === 'duplicate') draft.strategies.wt = [...draft.strategies.so];
    if (variant === 'reference') draft.strategies.so[0].visionId = '<invalid>';
    doc.wishes[0].swot = draft;
    expect(() => validateDocument(doc)).toThrow('format');
  });
  it('survives reload, backup and restore; quota failures preserve the prior saved analysis', async () => {
    const { doc, draft } = fixture();
    const data = new Map([[STORAGE_KEY, JSON.stringify(doc)]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: vi.fn((key, value) => data.set(key, value)) };
    const store = createPlannerStore({ storage });
    await store.commit(current => saveSwot(current, 'wish', draft));
    const before = store.get();
    expect(createPlannerStore({ storage }).get()).toEqual(before);
    const backup = store.backup();
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(store.commit(current => saveSwot(current, 'wish', { ...draft, factors: { ...draft.factors, w: 'New text' } }, before.wishes[0].swot))).rejects.toThrow('storageWrite');
    expect(store.get()).toBe(before);
    await store.restore(backup, before.revision);
    expect(store.get().wishes[0].swot).toEqual(draft);
  });
});

describe('optional AI SWOT suggestions', () => {
  it('keeps suggestions separate and appends only explicitly accepted lines', () => {
    const { draft } = fixture();
    const result = parseSwotSuggestions({ strategies: { so: ['Share 1 article', 'Share 1 article'], wo: [], st: [], wt: [] } });
    expect(result.so).toEqual(['Share 1 article']);
    const next = acceptSwotSuggestion(draft, 'so', result.so[0]);
    expect(next.strategies.so.map(row => row.text)).toEqual(['Publish 2 books', 'Share 1 article']);
    expect(next.factors).toEqual(draft.factors);
    expect(draft.strategies.so).toHaveLength(1);
    expect(acceptSwotSuggestion(next, 'so', result.so[0])).toBe(next);
  });
  it.each([null, {}, { strategies: { so: [42], wo: [], st: [], wt: [] } }, { strategies: { so: [], wo: [], st: [], wt: [] } }])('rejects invalid AI output', result => {
    expect(() => parseSwotSuggestions(result)).toThrow('aiResponse');
  });
  it('sends only this wish and its written analysis, with an explicit output language', () => {
    const { doc, draft } = fixture();
    const prompts = swotPrompts({ ...doc.wishes[0], privateExtra: 'never transmit' }, draft, 'zh-CN');
    expect(prompts.system).toContain('zh-CN');
    expect(JSON.parse(prompts.user).factors).toEqual(draft.factors);
    expect(prompts.user).not.toContain('never transmit');
  });
});
