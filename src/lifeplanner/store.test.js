import { describe, expect, it, vi } from 'vitest';
import { createPlannerStore, STORAGE_KEY, BACKUP_FORMAT } from './store.js';
import { createWish, defaultDocument, updateWish } from './model.js';
import { collectDeviceSettings, applyDeviceSettings } from '../utils/deviceSettings.js';
const fixture=()=>{
  const data=new Map();
  const storage={getItem:vi.fn(k=>data.get(k)??null),setItem:vi.fn((k,v)=>data.set(k,v)),key:i=>[...data.keys()][i],get length(){return data.size;}};
  const create=opts=>createPlannerStore({storage,defaults:['Be honest'],now:()=> '2026-09-20T12:00:00.000Z',...opts});
  return {data,storage,create};
};
const append=(id='wish')=>d=>({...d,wishes:[...d.wishes,createWish('Read more','learning',id)]});

describe('Life Planner durable prototype store',()=>{
  it('is lazy: opening never writes default principles or demo wishes',()=>{
    const {create,storage}=fixture();const s=create();
    expect(s.get().wishes).toEqual([]);expect(s.get().principles[0].text).toBe('Be honest');expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('publishes only after a durable write; reopens the same state',async()=>{
    const {create,storage}=fixture();const s=create();const observer=vi.fn(()=>expect(storage.getItem(STORAGE_KEY)).not.toBeNull());s.subscribe(observer);
    await s.commit(append());expect(observer).toHaveBeenCalledOnce();expect(create().get()).toEqual(s.get());expect(s.get().revision).toBe(1);
  });
  it('does not report success or lose the draft after quota failure; retry is unique',async()=>{
    const {create,storage}=fixture();const s=create();const original=s.get();
    storage.setItem.mockImplementationOnce(()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
    await expect(s.commit(append())).rejects.toThrow('storageWrite');expect(s.get()).toBe(original);
    await s.commit(append());expect(s.get().wishes).toHaveLength(1);
  });
  it('serializes rapid actions rather than dropping an addition',async()=>{
    const {create}=fixture();const s=create();await Promise.all([s.commit(append('a')),s.commit(append('b')),s.commit(append('c'))]);
    expect(s.get().wishes.map(w=>w.id)).toEqual(['a','b','c']);expect(s.get().revision).toBe(3);
  });
  it('uses Web Locks when supplied',async()=>{
    const {create}=fixture();const locks={request:vi.fn((_,fn)=>fn())};const s=create({locks});await s.commit(append());
    expect(locks.request).toHaveBeenCalledWith(STORAGE_KEY,expect.any(Function));
  });
  it('rereads storage and preserves unrelated writes from a second instance',async()=>{
    const {create}=fixture();const a=create(),b=create();await a.commit(append('a'));await b.commit(append('b'));
    expect(b.get().wishes.map(w=>w.id)).toEqual(['a','b']);
  });
  it('protects exact revision imports after another tab writes',async()=>{
    const {create}=fixture();const a=create(),b=create();const backup=a.backup();await b.commit(append());
    await expect(a.restore(backup,0)).rejects.toThrow('conflict');expect(a.get().wishes).toHaveLength(1);
  });
  it('protects an item from a stale checkbox handler',async()=>{
    const {create}=fixture();const a=create();await a.commit(append());const w=a.get().wishes[0];
    const b=create();await b.commit(d=>updateWish(d,w.id,{title:'Changed'},w));
    await expect(a.commit(d=>updateWish(d,w.id,{completed:true},w))).rejects.toThrow('conflict');
    expect(a.get().wishes[0]).toMatchObject({title:'Changed',completed:false});
  });
  it.each(['{broken','{"version":2,"revision":0,"wishes":[],"principles":[]}','[]'])('fails closed on corrupt or newer storage (%s)',async raw=>{
    const {create,data,storage}=fixture();data.set(STORAGE_KEY,raw);const s=create();
    expect(s.error()).toBe('storageRead');await expect(s.commit(append())).rejects.toThrow('storageRead');
    expect(data.get(STORAGE_KEY)).toBe(raw);expect(storage.setItem).not.toHaveBeenCalled();expect(s.rawBackup()).toBe(raw);
  });
  it('handles blocked storage without replacing anything',async()=>{
    const {create,storage}=fixture();storage.getItem.mockImplementation(()=>{throw new Error('blocked');});const s=create();
    expect(s.error()).toBe('storageRead');await expect(s.commit(append())).rejects.toThrow('storageRead');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('listens only while mounted and reads cross-tab removal',async()=>{
    const {create,data}=fixture();const target=new EventTarget();const s=create({target});let count=0;const off=s.subscribe(()=>count++);
    data.set(STORAGE_KEY,JSON.stringify({...defaultDocument(),wishes:[createWish('x','other','x')]}));
    const event=new Event('storage');Object.defineProperty(event,'key',{value:STORAGE_KEY});target.dispatchEvent(event);
    expect(s.get().wishes).toHaveLength(1);expect(count).toBe(1);off();target.dispatchEvent(event);expect(count).toBe(1);
  });
  it('exports and restores only its document, leaving native stores untouched',async()=>{
    const {create,data}=fixture();data.set('day-planner-tasks','tasks');data.set('day-planner-projects','projects');
    const a=create();await a.commit(append());const exported=a.backup();expect(JSON.parse(exported).format).toBe(BACKUP_FORMAT);
    await a.commit(d=>({...d,wishes:[]}));await a.restore(exported,a.get().revision);
    expect(a.get().wishes).toHaveLength(1);expect(data.get('day-planner-tasks')).toBe('tasks');expect(data.get('day-planner-projects')).toBe('projects');
  });
  it.each(['{}','{bad','{"format":"other","version":1}'])('rejects invalid imports (%s)',async raw=>{
    const {create}=fixture();const a=create();const before=a.get();await expect(a.restore(raw,0)).rejects.toThrow('format');expect(a.get()).toBe(before);
  });
  it('rejects oversized imports before parsing',async()=>{
    const {create}=fixture();await expect(create().restore(' '.repeat(750001),0)).rejects.toThrow('size');
  });
  it('preserves explicit limit validation rather than calling it a quota failure',async()=>{
    const {create}=fixture();await expect(create().commit(()=>{throw new Error('limit');})).rejects.toThrow('limit');
  });
  it('participates in existing device-local folder backup without a second payload schema',async()=>{
    const {create,storage}=fixture();const a=create();await a.commit(append());const captured=collectDeviceSettings(storage);
    expect(captured[STORAGE_KEY]).toBe(storage.getItem(STORAGE_KEY));
    const other=fixture();applyDeviceSettings(captured,other.storage);expect(other.create().get()).toEqual(a.get());
  });
  it('cannot write after disposal',async()=>{
    const {create}=fixture();const a=create();a.dispose();await expect(a.commit(append())).rejects.toThrow('missing');
  });
});
