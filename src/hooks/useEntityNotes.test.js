import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noteTextHash } from '@glance-apps/obsidian-format';

// The hook run the way React runs it: state persists across renders, effects
// run after a render whose dependencies changed (cleanup first), and an
// unmount runs every cleanup.
const react = vi.hoisted(() => ({ slots: [], cursor: 0, pending: [], dirty: false }));
vi.mock('react', () => ({
  useState: (initial) => {
    const i = react.cursor++;
    const slot = react.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [slot.value, (v) => { slot.value = typeof v === 'function' ? v(slot.value) : v; react.dirty = true; }];
  },
  useRef: (initial) => {
    const i = react.cursor++;
    return react.slots[i] ??= { current: initial };
  },
  useEffect: (effect, deps) => {
    const i = react.cursor++;
    const slot = react.slots[i] ??= { effect: true };
    if (!slot.deps || !deps || deps.some((d, n) => d !== slot.deps[n])) {
      react.pending.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      slot.deps = deps;
    }
  },
}));
const sync = vi.hoisted(() => ({ value: {} }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => sync.value }));
import useEntityNotes from './useEntityNotes.js';

const runHook = useEntityNotes;
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

function mount(args) {
  react.slots = []; react.pending = [];
  let result;
  const render = () => {
    let turns = 0;
    do {
      if (++turns > 20) throw new Error('render loop');
      react.dirty = false; react.cursor = 0;
      result = runHook(args);
      const effects = react.pending.splice(0);
      for (const run of effects) run();
    } while (react.dirty);
  };
  render();
  return {
    get state() { return result; },
    render,
    act: async (fn) => { fn?.(result); await flushPromises(); render(); },
    unmount: () => { for (const slot of react.slots) if (slot?.effect) slot.cleanup?.(); },
  };
}

const LINKED = { id: 'g1', description: '', obsidianNotePath: 'Goals/Run.md' };

beforeEach(() => { sync.value = {}; });

describe('useEntityNotes — a record description', () => {
  it('saves the trimmed text through saveRecord, and only when it changed', async () => {
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: { id: 'g1', description: 'Old' }, saveRecord });
    expect(h.state.editing).toBe(false); // existing notes open as the preview
    await h.act((s) => s.save());
    expect(saveRecord).not.toHaveBeenCalled();
    await h.act((s) => s.setNotes('  New **bold**  '));
    await h.act((s) => s.save());
    expect(saveRecord).toHaveBeenCalledWith('New **bold**');
  });

  it('opens an empty box as the editor, unless asked for the quiet prompt', () => {
    expect(mount({ kind: 'project', entity: { id: 'p1' }, saveRecord: vi.fn() }).state.editing).toBe(true);
    expect(mount({ kind: 'goal', entity: { id: 'g1' }, saveRecord: vi.fn(), editWhenEmpty: false }).state.editing).toBe(false);
  });

  it('flushes unsaved text when it unmounts', async () => {
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: { id: 'g1', description: '' }, saveRecord });
    await h.act((s) => s.setNotes('typed, never blurred'));
    h.unmount();
    expect(saveRecord).toHaveBeenCalledWith('typed, never blurred');
  });
});

describe('useEntityNotes — a linked note\'s description section', () => {
  const vaultSync = (over = {}) => ({
    loadNoteDescription: vi.fn(async () => ({ text: 'From the vault', base: noteTextHash('From the vault') })),
    saveNoteDescription: vi.fn(async () => ({ ok: true })),
    ...over,
  });

  it('loads the section into the box and writes it back with its base, never to the record', async () => {
    sync.value = vaultSync();
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord, editWhenEmpty: false });
    expect(h.state.vaultNotes).toBe(true);
    await h.act();
    expect(sync.value.loadNoteDescription).toHaveBeenCalledWith('Goals/Run.md');
    expect(h.state.notes).toBe('From the vault');
    expect(h.state.editing).toBe(false);

    await h.act((s) => s.setNotes('Edited'));
    await h.act((s) => s.save());
    expect(sync.value.saveNoteDescription).toHaveBeenCalledWith('goal', 'g1', 'Goals/Run.md', 'Edited', { base: noteTextHash('From the vault') });
    expect(saveRecord).not.toHaveBeenCalled();
    expect(h.state.vault.text).toBe('Edited');
  });

  it('keeps the unsaved text below a section that moved in Obsidian, and says so', async () => {
    sync.value = vaultSync({ saveNoteDescription: vi.fn(async () => ({ refused: true, text: 'Changed in Obsidian' })) });
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord: vi.fn() });
    await h.act();
    await h.act((s) => s.setNotes('Mine'));
    await h.act((s) => s.save());
    expect(h.state.notes).toBe('Changed in Obsidian\n\nMine');
    expect(h.state.vault.conflict).toBe(true);
    expect(h.state.editing).toBe(true);
  });

  it('says where the notes live when the note is missing, and writes nothing', async () => {
    sync.value = vaultSync({ loadNoteDescription: vi.fn(async () => ({ notFound: true })) });
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord: vi.fn() });
    await h.act();
    expect(h.state.vault).toMatchObject({ unavailable: true, error: 'not_found' });
    await h.act((s) => s.save());
    h.unmount();
    expect(sync.value.saveNoteDescription).not.toHaveBeenCalled();
  });

  it('flushes to the note, not the record, when it unmounts', async () => {
    sync.value = vaultSync();
    const saveRecord = vi.fn();
    const h = mount({ kind: 'goal', entity: LINKED, saveRecord });
    await h.act();
    await h.act((s) => s.setNotes('Unsaved'));
    h.unmount();
    expect(sync.value.saveNoteDescription).toHaveBeenCalledWith('goal', 'g1', 'Goals/Run.md', 'Unsaved');
    expect(saveRecord).not.toHaveBeenCalled();
  });
});
