import { describe, expect, it, vi } from 'vitest';
import { createPlanningPreferences, readPlanningPreferences, PLANNING_KEYS, LIFE_DOCUMENT_KEY } from './preferences.js';

function fixture(entries = {}) {
  const data = new Map(Object.entries(entries));
  const storage = { getItem: vi.fn(k => data.get(k) ?? null), setItem: vi.fn((k, v) => data.set(k, v)) };
  const target = new EventTarget();
  const store = createPlanningPreferences({ storage, target });
  const event = key => { const e = new Event('storage'); Object.defineProperty(e, 'key', { value: key }); target.dispatchEvent(e); };
  return { data, storage, target, store, event };
}

describe('Life Planner opt-in choices', () => {
  it('starts simple without writing a setting or constructing a planner document', () => {
    const {store, storage} = fixture();
    expect(store.get()).toEqual({joboEnabled:false, lifeplannerEnabled:false, error:null});
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each([[false,false], [true,false], [false,true], [true,true]])('persists independent Jobo=%s and Life Planner=%s', (jobo, life) => {
    const f=fixture({[LIFE_DOCUMENT_KEY]:'untouched', 'day-planner-tasks':'private tasks', 'day-planner-projects':'private projects'});
    f.store.set('joboEnabled', jobo); f.store.set('lifeplannerEnabled', life);
    expect(readPlanningPreferences(f.storage)).toEqual({joboEnabled:jobo, lifeplannerEnabled:life, error:null});
    expect(f.data.get(LIFE_DOCUMENT_KEY)).toBe('untouched');
    expect(f.data.get('day-planner-tasks')).toBe('private tasks');
    expect(f.data.get('day-planner-projects')).toBe('private projects');
    expect([...f.data.keys()].filter(k=>!Object.values(PLANNING_KEYS).includes(k))).toHaveLength(3);
  });
  it('uses the existing native Jobo key rather than a second flag', () => {
    expect(fixture({[PLANNING_KEYS.joboEnabled]:'true'}).store.get().joboEnabled).toBe(true);
    expect(PLANNING_KEYS.joboEnabled).toBe('day-planner-jobo-enabled');
  });
  it('preserves valid JSON booleans with whitespace from native settings backups', () => {
    expect(fixture({[PLANNING_KEYS.joboEnabled]:' true\n', [PLANNING_KEYS.lifeplannerEnabled]:'\ttrue '}).store.get()).toMatchObject({joboEnabled:true,lifeplannerEnabled:true});
  });
  it('preserves discoverability of existing planner data, including recovery data', () => {
    expect(fixture({[LIFE_DOCUMENT_KEY]:'broken but recoverable'}).store.get().lifeplannerEnabled).toBe(true);
  });
  it('honors an explicit off even when a planner document exists', () => {
    expect(fixture({[LIFE_DOCUMENT_KEY]:'{}',[PLANNING_KEYS.lifeplannerEnabled]:'false'}).store.get().lifeplannerEnabled).toBe(false);
  });
  it.each(['null','"true"','1','{}','garbled'])('treats non-boolean stored choices as off: %s', raw => {
    expect(fixture({[PLANNING_KEYS.joboEnabled]:raw,[PLANNING_KEYS.lifeplannerEnabled]:raw}).store.get()).toMatchObject({joboEnabled:false,lifeplannerEnabled:false});
  });
  it('does not throw or write when reads are blocked', () => {
    const storage={getItem:()=>{throw Error('denied');},setItem:vi.fn()};
    expect(readPlanningPreferences(storage).error).toBe('read');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('keeps the switch unchanged when persistence fails and supports a single retry', () => {
    const f=fixture(); const write=f.storage.setItem;
    f.storage.setItem=()=>{throw Error('quota');};
    expect(f.store.set('lifeplannerEnabled',true)).toBe(false);
    expect(f.store.get()).toEqual({joboEnabled:false,lifeplannerEnabled:false,error:'save'});
    expect(f.data.size).toBe(0);
    f.storage.setItem=write;
    expect(f.store.set('lifeplannerEnabled',true)).toBe(true);
    expect(f.store.get().error).toBeNull();expect(f.data.size).toBe(1);
  });
  it('notifies only after persistence and keeps stable snapshots on redundant events', () => {
    const f=fixture(), listener=vi.fn(()=>expect(f.data.get(PLANNING_KEYS.joboEnabled)).toBe('true'));
    const stop=f.store.subscribe(listener);f.store.set('joboEnabled',true);
    expect(listener).toHaveBeenCalledTimes(1);
    const saved=f.store.get();f.event(PLANNING_KEYS.joboEnabled);
    expect(f.store.get()).toBe(saved);expect(listener).toHaveBeenCalledTimes(1);stop();
  });
  it('observes external changes, removals and clear without rewriting keys', () => {
    const f=fixture(); const stop=f.store.subscribe(()=>{});
    f.data.set(PLANNING_KEYS.joboEnabled,'true'); f.event(PLANNING_KEYS.joboEnabled);
    expect(f.store.get().joboEnabled).toBe(true);
    f.data.clear();f.event(null);expect(f.store.get().joboEnabled).toBe(false);
    expect(f.storage.setItem).not.toHaveBeenCalled();stop();
  });
  it('ignores unrelated events and detaches its event listener', () => {
    const f=fixture();const listener=vi.fn(); const stop=f.store.subscribe(listener);
    f.data.set(PLANNING_KEYS.joboEnabled,'true');f.event('some-other-key');expect(listener).not.toHaveBeenCalled();
    stop();f.event(PLANNING_KEYS.joboEnabled);expect(listener).not.toHaveBeenCalled();
  });
  it('supports native React-style functional setters against the latest disk value', () => {
    const f=fixture();f.data.set(PLANNING_KEYS.joboEnabled,'true');f.store.set('joboEnabled', x=>!x);
    expect(f.store.get().joboEnabled).toBe(false);
  });
  it('has no switchable baseline and rejects unknown keys/non-booleans', () => {
    const f=fixture();expect(()=>f.store.set('daily',false)).toThrow();
    expect(()=>f.store.set('joboEnabled','yes')).toThrow(TypeError);expect(f.data.size).toBe(0);
  });
});
