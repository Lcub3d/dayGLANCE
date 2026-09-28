import { afterEach, describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createJoboStore } from '../jobo/store.js';
import { createJobuData, materializeJobu, mergeJobuRecords, validateJobuRecords } from './data.js';
import { saveLabel, setTaskLabel, savePersonalFilter, organizerState } from './organizerStore.js';
import { labelId, labelTaskEntity, sourceLabels, buildLabelIndex } from './labels.js';
import { taskDisplayTitle } from './quickAdd.js';
import { compileJobuFilter, quoteFilterName } from './filters.js';
import { mergeSyncData } from '../mergeSync.js';
import { shredState, applyRemoteEntity, applyRemoteDelete } from '../sync/dbAdapter.js';
const close=[];afterEach(()=>close.splice(0).forEach(fn=>fn()));
function memory(){let state=[];let tail=Promise.resolve();const disk={fail:false,read:async()=>({ok:true,value:structuredClone(state)}),writable:async()=>true,update:fn=>{const result=tail.then(()=>{try{if(disk.fail)return {ok:false,error:'quota'};state=structuredClone(fn(state));return {ok:true,value:structuredClone(state)};}catch(e){return {ok:false,error:e.message};}});tail=result.then(()=>{});return result;}};return disk;}
function controller(store=memory(),prefix='a'){let n=0;const data=createJobuData({store,now:()=> '2026-09-29T01:00:00Z',uuid:()=>`${prefix}${++n}`});close.push(()=>data.dispose());return data;}
const val=(name)=>({name,color:'blue',isFavorite:false});
const head=(d,id)=>materializeJobu(d.get().records).get(id);
const index=(d,tasks)=>organizerState(d.get().records,tasks).labels;
describe('Visible labels without native task-schema rewrites',()=>{
 it('unifies native tags and existing source labels; preserves wikilinks and nested tag display',()=>{
  const task={id:'a',title:'Read [[Book#Heading|notes]] #work/deep',todoist:{labels:['进行','spaces & punctuation*']}};
  expect(sourceLabels(task)).toEqual(['work/deep','进行','spaces & punctuation*']);
  expect(taskDisplayTitle(task)).toBe('Read [[Book#Heading|notes]]');
 });
 it('creates a label with no tasks, assigns it, and filters the same committed projection',async()=>{
  const d=controller();await d.load();await saveLabel(d,val('进行'));
  const task={id:'t',title:'Unchanged',date:'2026-09-28',completedAt:'original'},original=structuredClone(task);
  let labels=index(d,[task]);await setTaskLabel(d,task,labels.definitions.get(labelId('进行')),true,null);
  labels=index(d,[task]);expect(labels.namesFor(task)).toEqual(['进行']);
  expect(compileJobuFilter('@进行',{getLabels:labels.namesFor}).test(task)).toBe(true);
  expect(task).toEqual(original);
 });
 it('supports arbitrary names, renames memberships without editing native or Todoist rows, and masks deletion',async()=>{
  const d=controller();await d.load();const task={id:'t',title:'Text #work',todoist:{labels:['来源 label']}};
  const before=structuredClone(task);const original=index(d,[task]).definitions.get(labelId('来源 label'));
  await saveLabel(d,{...original,name:'New & name*'},{sourceNames:sourceLabels(task)});
  expect(index(d,[task]).namesFor(task)).toEqual(['work','New & name*']);
  const query='%'+quoteFilterName('New & name*');expect(compileJobuFilter(query,{getLabels:index(d,[task]).namesFor}).test(task)).toBe(true);
  expect(compileJobuFilter('%"来源 label"',{getLabels:index(d,[task]).namesFor}).test(task)).toBe(false);
  let row=head(d,original.id);await saveLabel(d,row.value,{expectedHead:row.id,deleted:true});
  expect(index(d,[task]).namesFor(task)).toEqual(['work']);row=head(d,original.id);
  await saveLabel(d,row.value,{expectedHead:row.id});expect(index(d,[task]).namesFor(task)).toContain('New & name*');expect(task).toEqual(before);
 });
 it('rejects name collisions including discovered and reserved historical names',async()=>{
  const d=controller();await d.load();const tasks=[{id:'a',title:'#work #home'}];let label=index(d,tasks).definitions.get(labelId('work'));
  await expect(saveLabel(d,{...label,name:'home'},{sourceNames:sourceLabels(tasks[0])})).rejects.toThrow('labelDuplicate');
  await saveLabel(d,label);label=index(d,tasks).definitions.get(label.id);await saveLabel(d,{...label,name:'office'},{expectedHead:label.head});
  await expect(saveLabel(d,{...val('work'),id:'jobu-label:another'})).rejects.toThrow('labelDuplicate');
 });
 it('rejects stale discovered labels when a concurrent rename already owns the name',async()=>{
  const disk=memory(),a=controller(disk,'a'),b=controller(disk,'b');await a.load();await b.load();
  const task={id:'t',title:'#new'},discovered=index(a,[task]).definitions.get(labelId('new'));
  await saveLabel(b,val('old'));const label=index(b,[]).definitions.get(labelId('old'));
  await saveLabel(b,{...label,name:'new'},{expectedHead:label.head});
  await expect(setTaskLabel(a,task,discovered,true,null)).rejects.toThrow('conflict');
  await a.load();expect(index(a,[task]).definitions.size).toBe(1);expect(head(a,labelTaskEntity(task))).toBeUndefined();
 });
 it('source-label removal stays removed after source refresh; series IDs are stable',async()=>{
  const d=controller();await d.load();const first={id:'recurring-r-2026-09-28',recurringTemplateId:'r',title:'#进行'};
  const label=index(d,[first]).definitions.get(labelId('进行'));
  await setTaskLabel(d,first,label,false,null);
  const next={...first,id:'recurring-r-2026-09-29',date:'2026-09-29'};
  expect(index(d,[next]).namesFor(next)).toEqual([]);expect(labelTaskEntity(first)).toBe(labelTaskEntity(next));
 });
 it('keeps label membership for a task outside the catalog population without mutating the index',()=>{
  const labels=buildLabelIndex(new Map(),[]),before=labels.definitions.size;
  expect(labels.namesFor({id:'later',title:'#new'})).toEqual(['new']);expect(labels.definitions.size).toBe(before);
 });
 it('exposes concurrent imported alias collisions instead of dropping a revision',async()=>{
  const d=controller();await d.load();await saveLabel(d,val('a'));await saveLabel(d,val('b'));
  const rows=d.get().records.map(r=>({...r,value:{...r.value,aliases:['overlap']}}));
  const state=organizerState(rows,[{id:'t',title:'#overlap'}]);expect(state.labels.conflicts).toEqual(['overlap']);expect(state.labels.definitions.size).toBe(2);
 });
 it('stale definition or assignment edits reject; quota errors publish nothing and can retry',async()=>{
  const disk=memory(),a=controller(disk,'a'),b=controller(disk,'b');await a.load();await b.load();await saveLabel(a,val('x'));await b.load();
  const task={id:'t',title:''},label=index(a,[task]).definitions.get(labelId('x'));
  disk.fail=true;await expect(setTaskLabel(a,task,label,true,null)).rejects.toThrow('quota');expect(index(a,[task]).namesFor(task)).toEqual([]);
  disk.fail=false;await setTaskLabel(a,task,label,true,null);await expect(setTaskLabel(b,task,label,false,null)).rejects.toThrow('conflict');
  await saveLabel(a,{...label,name:'y'},{expectedHead:label.head});await expect(saveLabel(b,{...label,name:'stale'},{expectedHead:label.head})).rejects.toThrow('conflict');
 });
 it('reuses other taskMeta data instead of replacing it',async()=>{
  const d=controller();await d.load();const task={id:'t',title:'#x'},entity=labelTaskEntity(task);
  await d.save(entity,'taskMeta',{note:'retained'});await setTaskLabel(d,task,index(d,[task]).definitions.get(labelId('x')),false,head(d,entity).id);
  expect(head(d,entity).value.note).toBe('retained');
 });
 it('rejects malformed additions/removals and catalog rows',async()=>{
  const d=controller();await d.load();await saveLabel(d,val('x'));const r=d.get().records[0];
  expect(()=>validateJobuRecords([{...r,value:{...r.value,color:'invalid'}}])).toThrow();
  expect(()=>validateJobuRecords([{...r,deleted:true,value:{...r.value,aliases:null}}])).toThrow();
  expect(()=>validateJobuRecords([{...r,entityId:'task-meta',kind:'taskMeta',value:{labels:{add:['a'],remove:[]}}}])).toThrow();
 });
});
describe('Filters and labels use existing safe storage and transports',()=>{
 it('edits/deletes personal filters with explicit stale-head checks',async()=>{
  const d=controller();await d.load();await savePersonalFilter(d,{name:'Mine',query:'p1'},{entityId:'filter:f'});
  const row=head(d,'filter:f');await savePersonalFilter(d,{...row.value,query:'today'},{entityId:row.entityId,expectedHead:row.id});
  await expect(savePersonalFilter(d,{...row.value,query:'p2'},{entityId:row.entityId,expectedHead:row.id})).rejects.toThrow('conflict');
  const next=head(d,row.entityId);await savePersonalFilter(d,next.value,{entityId:next.entityId,expectedHead:next.id,deleted:true});
  expect(organizerState(d.get().records,[]).filters).toEqual([]);expect(d.get().records).toHaveLength(3);
 });
 it('walks actual IndexedDB atomic transactions; independent label edits coexist',async()=>{
  const factory=new IDBFactory();const db=await new Promise((res,rej)=>{const r=factory.open('organizer',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});close.push(()=>db.close());
  const a=controller(createJoboStore({open:async()=>db}),'a'),b=controller(createJoboStore({open:async()=>db}),'b');await a.load();await b.load();
  await Promise.all([saveLabel(a,val('a')),saveLabel(b,val('b'))]);await a.load();expect(index(a,[]).definitions.size).toBe(2);
 });
 it('save → state → both transports → apply → reload → backup/restore retains removals and tombstones',async()=>{
  const a=controller(),b=controller(memory(),'b');await a.load();await b.load();const task={id:'t',title:'#进行'};
  await setTaskLabel(a,task,index(a,[task]).definitions.get(labelId('进行')),true,null);
  let label=index(a,[task]).definitions.get(labelId('进行'));await saveLabel(a,{...label,name:'Working'},{expectedHead:label.head});label=index(a,[task]).definitions.get(label.id);await saveLabel(a,label,{expectedHead:label.head,deleted:true});
  await savePersonalFilter(a,{name:'今日目标',query:'今天&!p4'},{entityId:'filter:sample'});
  const payload={tasks:[task],jobuRecords:a.get().records};const file=mergeSyncData(payload,{tasks:[]}).data;
  const vault={};for(const {entity} of shredState(payload).filter(e=>e.entity._kind==='jobuRecords'))applyRemoteEntity(vault,entity);
  expect(mergeJobuRecords(file.jobuRecords,vault.jobuRecords)).toEqual(a.get().records);
  applyRemoteDelete(vault,`jobuRecords:${a.get().records[0].id}`);await b.applyRemote(vault.jobuRecords);await b.load();
  expect(index(b,[task]).namesFor(task)).toEqual([]);expect(organizerState(b.get().records,[task]).filters[0].value.query).toBe('今天&!p4');
  await b.restore(JSON.parse(a.export()).records);expect(b.get().records).toEqual(a.get().records);
 });
});
