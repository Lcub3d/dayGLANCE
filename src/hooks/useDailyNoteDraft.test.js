import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Daily Notes modal and the JOBO sidebar both edit a daily note through
// this hook, so its vault rules are pinned here: read fresh first, write only
// a change to what was read, never write before the read resolved.

const runtime = vi.hoisted(() => ({ slots: [], deps: [], cleanups: [], cursor: 0, effect: 0, queue: [] }));
vi.mock('react', () => ({
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = typeof value === 'function' ? value() : value;
    return [runtime.slots[i], (next) => { runtime.slots[i] = typeof next === 'function' ? next(runtime.slots[i]) : next; }];
  },
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect(effect, deps) {
    const i = runtime.effect++;
    const prev = runtime.deps[i];
    const changed = !prev || !deps || deps.some((d, k) => d !== prev[k]);
    if (changed) { runtime.deps[i] = deps; runtime.queue.push([i, effect]); }
  },
}));
vi.mock('@glance-apps/obsidian-format', () => ({ renderNoteTemplateSubset: (template) => template }));
const { default: useDailyNoteDraft } = await import('./useDailyNoteDraft.js');

function mount(props) {
  runtime.slots = []; runtime.deps = []; runtime.cleanups = []; runtime.queue = [];
  let state;
  const render = () => {
    runtime.cursor = 0; runtime.effect = 0; runtime.queue = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    state = useDailyNoteDraft(props);
    for (const [i, effect] of runtime.queue) {
      runtime.cleanups[i]?.();
      runtime.cleanups[i] = effect() || undefined;
    }
    return state;
  };
  render();
  return {
    get state() { return state; },
    render,
    unmount: () => runtime.cleanups.forEach((cleanup) => cleanup?.()),
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { runtime.slots = []; });

describe('editing a daily note', () => {
  it('without a vault: saves a change, and nothing for an untouched note', () => {
    const onSave = vi.fn();
    const h = mount({ dateStr: '2026-09-29', note: { text: 'Standup at 10' }, onSave });
    h.state.persist('Standup at 10');
    expect(onSave).not.toHaveBeenCalled();
    h.state.persist('Standup at 10:30');
    expect(onSave).toHaveBeenCalledWith('2026-09-29', 'Standup at 10:30');
    h.state.persist('Standup at 10:30');
    expect(onSave).toHaveBeenCalledTimes(1);   // the baseline moved with the write
  });

  // MUTATION: drop the fresh read and an editor that sat open writes its
  // older copy over what changed in the vault meanwhile.
  it('with a vault: starts from the vault text, not the app copy', async () => {
    const onSave = vi.fn();
    const loadFresh = vi.fn(async () => ({ text: 'Edited in Obsidian' }));
    const h = mount({ dateStr: '2026-09-29', note: { text: 'Old app copy' }, onSave, loadFresh });
    expect(h.state.loading).toBe(true);
    await settle();
    h.render();
    expect(loadFresh).toHaveBeenCalledWith('2026-09-29');
    expect(h.state.loading).toBe(false);
    expect(h.state.text).toBe('Edited in Obsidian');
    h.state.persist('Edited in Obsidian');
    expect(onSave).not.toHaveBeenCalled();
  });

  // MUTATION: drop the freshLoaded guard and closing during the read writes
  // the stale initial state over the vault.
  it('writes nothing on unmount before the vault read resolved', () => {
    const onSave = vi.fn();
    const h = mount({ dateStr: '2026-09-29', note: { text: 'Old app copy' }, onSave, loadFresh: () => new Promise(() => {}) });
    h.state.setText('typed during loading');
    h.render();
    h.unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves an unsaved change on unmount, once', async () => {
    const onSave = vi.fn();
    const h = mount({ dateStr: '2026-09-29', note: { text: 'a' }, onSave });
    h.state.setText('b');
    h.render();
    h.unmount();
    expect(onSave).toHaveBeenCalledWith('2026-09-29', 'b');
    // A caller that saved on its way out marks it, and unmount does not
    // write a second time.
    const onClose = vi.fn();
    const closed = mount({ dateStr: '2026-09-29', note: { text: 'a' }, onSave: onClose });
    closed.state.setText('b');
    closed.render();
    closed.state.savedOnCloseRef.current = true;
    closed.state.persist('b');
    closed.state.setText('c');
    closed.render();
    closed.unmount();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never writes an untouched template as the note', () => {
    const onSave = vi.fn();
    const h = mount({ dateStr: '2026-09-29', note: undefined, onSave, template: '## Plan\n' });
    h.render();
    expect(h.state.text).toBe('## Plan\n');
    h.unmount();
    expect(onSave).not.toHaveBeenCalled();
  });
});
