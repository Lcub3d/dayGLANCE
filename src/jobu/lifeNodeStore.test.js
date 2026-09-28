import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createJoboStore } from '../jobo/store.js';
import { createJobuData, materializeJobu, mergeJobuRecords } from './data.js';
import { createDurablePlannerStore } from './plannerStore.js';
import { migrateLifeNodes, readLifeNodes, saveLifeNode, patchLifeNode, deleteLifeNode, placeLifeNodes, connectLifeNodes,
  replaceNativeLifeNodes, notebookFromLifeNodes, lifeNodesGraph, backupLifeSources, LIFE_SOURCE_BACKUP, restorePlanningRevision, mayApplyLegacyLifeSnapshot } from './lifeNodeStore.js';
import { sources } from '../lifeplanner/entities.fixtures.js';
import { createLifeNode, LIFE_NODE_SCHEMA, lifeKey, projectNativeNodes } from '../lifeplanner/entities.js';
import { defaultDocument, createWish, createVision, updateWish } from '../lifeplanner/model.js';
import { STORAGE_KEY } from '../lifeplanner/store.js';
import { lanePosition } from '../lifeplanner/board.js';
import { networkNodes } from '../lifeplanner/supportNetwork.js';
import { mergeSyncData } from '../mergeSync.js';
import { shredState, applyRemoteEntity, applyRemoteDelete } from '../sync/dbAdapter.js';
function memoryStorage(input={document:defaultDocument(),goals:[],projects:[]}) {
  const entries = new Map([[STORAGE_KEY,JSON.stringify(input.document)],['day-planner-goals',JSON.stringify(input.goals)],['day-planner-projects',JSON.stringify(input.projects)]]);
  return { entries,getItem:key=>entries.get(key)??null, setItem:(key,value)=>entries.set(key,value) };
}
function fixture(prefix='r') {
  let raw=[],i=0,queue=Promise.resolve();
  const disk={fail:false,read:async()=>({ok:true,value:structuredClone(raw)}),writable:async()=>true,update:fn=>{
    const work=queue.then(()=>{ if(disk.fail)return {ok:false,error:'quota'};
      try{raw=structuredClone(fn(raw));return{ok:true,value:structuredClone(raw)};}catch(error){return{ok:false,error:error.message};}
    });queue=work.catch(()=>{});return work;
  }};
  return {disk,data:createJobuData({store:disk,uuid:()=>`${prefix}-${++i}`,now:()=> '2026-09-28T00:00:00.000Z'})};
}
const row=(data,id)=>readLifeNodes(data.get().records).heads.get(id);
const expected=data=>new Map(readLifeNodes(data.get().records).rows.map(r=>[r.entityId,r.id]));
async function setup(input) { const f=fixture();await f.data.load();const storage=memoryStorage(input);await migrateLifeNodes(f.data,{storage});return {...f,storage}; }

describe('unified Life Map durable owner',()=>{
  it('does not consume legacy snapshots while the current journal is unknown',()=>{
    expect(mayApplyLegacyLifeSnapshot(undefined,undefined)).toBe(false);
    expect(mayApplyLegacyLifeSnapshot([],undefined)).toBe(true);
  });
  it('ignores native snapshots once either the store or incoming payload contains the schema',async()=>{
    const {data}=await setup(sources()), records=data.get().records;
    expect(mayApplyLegacyLifeSnapshot(records,undefined)).toBe(false);
    expect(mayApplyLegacyLifeSnapshot([],records)).toBe(false);
    expect(mayApplyLegacyLifeSnapshot([], [{broken:true}])).toBe(false);
    data.dispose();
  });
  it('migrates atomically once, leaves source bytes unchanged and materializes all four types',async()=>{
    const input=sources(), {data,storage}=await setup(input), original=[...storage.entries];
    const first=data.get().records, state=readLifeNodes(first);
    expect(state.ready).toBe(true);expect(state.nodes).toHaveLength(5);expect(state.nodes.every(n=>n.version===1)).toBe(true);
    await migrateLifeNodes(data,{storage});expect(data.get().records).toEqual(first);expect([...storage.entries]).toEqual(original);
    expect(projectNativeNodes(state.nodes,'goal')).toEqual(input.goals);data.dispose();
  });
  it('preserves an exact one-time local recovery snapshot, including malformed originals',()=>{
    const storage=memoryStorage();storage.setItem('day-planner-goals','{corrupt');backupLifeSources(storage);
    storage.setItem('day-planner-goals','[]');backupLifeSources(storage);
    expect(JSON.parse(storage.getItem(LIFE_SOURCE_BACKUP)).sources['day-planner-goals']).toBe('{corrupt');
  });
  it.each([['day-planner-goals','{}'],['day-planner-projects','[{"id":"p"},{"id":"p"}]'],[STORAGE_KEY,'{broken'],['day-planner-deleted-goal-ids','[]']])('refuses corrupt source %s with no partial publication',async(key,value)=>{
    const {data}=fixture();await data.load();const storage=memoryStorage(sources());storage.setItem(key,value);
    await expect(migrateLifeNodes(data,{storage})).rejects.toThrow();expect(data.get().records).toEqual([]);expect(storage.getItem(key)).toBe(value);data.dispose();
  });
  it('uses existing personal wish revisions rather than stale notebook cache',async()=>{
    const {data}=fixture();await data.load();const input=sources();
    await data.save('lifeWish:w','lifeWish',input.document.wishes[0]);
    await data.save('lifeOrder','lifeOrder',{wishes:['w'],principles:[]});
    await migrateLifeNodes(data,{storage:memoryStorage()});
    expect(readLifeNodes(data.get().records).nodes[0].title).toBe(input.document.wishes[0].title);
    expect(materializeJobu(data.get().records).get('lifeWish:w').deleted).toBe(true);
    expect(data.get().records.filter(r=>r.entityId==='lifeWish:w')).toHaveLength(2);data.dispose();
  });
  it('never recreates a tombstoned native source row',async()=>{
    const {data}=fixture();await data.load();const input=sources(), storage=memoryStorage(input);
    storage.setItem('day-planner-deleted-goal-ids',JSON.stringify({g:'2026-09-27'}));
    await migrateLifeNodes(data,{storage});expect(projectNativeNodes(readLifeNodes(data.get().records).nodes,'goal')).toEqual([]);data.dispose();
  });
  it('converts a node through all types without moving its task or support identities',async()=>{
    const {data}=await setup(sources()), id=lifeKey('project','p'), task={id:'task',projectId:'p',title:'Native task'};
    const before=networkNodes(lifeNodesGraph(readLifeNodes(data.get().records).nodes,{tasks:[task]})).map(n=>n.id);
    for(const type of ['wish','vision','goal',null,'project']) await patchLifeNode(data,id,{type,position:lanePosition(type),onCanvas:true},row(data,id).id);
    expect(row(data,id).value.bindings.projectId).toBe('p');expect(row(data,id).value.details.project.custom).toEqual([1,2]);
    const graph=lifeNodesGraph(readLifeNodes(data.get().records).nodes,{tasks:[task]});
    expect(graph.edges.some(e=>e.source===id&&e.target===lifeKey('task','task'))).toBe(true);
    expect(networkNodes(graph).map(n=>n.id)).toEqual(before);expect(task.projectId).toBe('p');data.dispose();
  });
  it('spreads and reclassifies untyped nodes atomically; a stale batch changes nothing',async()=>{
    const {data}=await setup();await saveLifeNode(data,createLifeNode({id:'a'}),null);await saveLifeNode(data,createLifeNode({id:'b'}),null);
    const a=row(data,'a'),b=row(data,'b');
    await placeLifeNodes(data,[{id:'a',expectedHead:a.id,position:lanePosition(null)},{id:'b',expectedHead:b.id,position:lanePosition(null,1)}]);
    expect(row(data,'a').value).toMatchObject({type:null,onCanvas:true});
    const current=data.get().records;
    await expect(placeLifeNodes(data,[{id:'a',expectedHead:row(data,'a').id,position:lanePosition('wish')},{id:'b',expectedHead:b.id,position:lanePosition('vision')}])).rejects.toThrow('conflict');
    expect(data.get().records).toEqual(current);
    await placeLifeNodes(data,[{id:'a',expectedHead:row(data,'a').id,position:lanePosition('project'),type:'project'}]);
    expect(projectNativeNodes(readLifeNodes(data.get().records).nodes,'project')).toHaveLength(1);data.dispose();
  });
  it('rejects duplicate placement commands atomically instead of creating competing revisions',async()=>{
    const {data}=await setup();await saveLifeNode(data,createLifeNode({id:'a'}),null);
    const before=data.get().records, head=row(data,'a').id;
    await expect(placeLifeNodes(data,[{id:'a',expectedHead:head,position:lanePosition('wish'),type:'wish'},
      {id:'a',expectedHead:head,position:lanePosition('goal'),type:'goal'}])).rejects.toThrow('conflict');
    expect(data.get().records).toEqual(before);data.dispose();
  });
  it('allows same-type hierarchies and multiple parents, but rejects self/cyclic/stale edges',async()=>{
    const {data}=await setup();for(const id of ['a','b','c']) await saveLifeNode(data,createLifeNode({id,type:'wish'}),null);
    await connectLifeNodes(data,'a','b',row(data,'b').id,row(data,'a').id);
    await connectLifeNodes(data,'c','b',row(data,'b').id,row(data,'c').id);
    expect(row(data,'b').value.parentIds).toEqual(['a','c']);
    await expect(connectLifeNodes(data,'b','a',row(data,'a').id,row(data,'b').id)).rejects.toThrow('lifeCycle');
    expect(data.get().error).toBeNull();
    await expect(connectLifeNodes(data,'a','a',row(data,'a').id,row(data,'a').id)).rejects.toThrow('format');
    await expect(connectLifeNodes(data,'a','c',row(data,'c').id,'stale')).rejects.toThrow('conflict');data.dispose();
  });
  it('deletes only the selected node, keeps orphan descendants and history, blocks stale resurrection',async()=>{
    const {data}=await setup();await saveLifeNode(data,createLifeNode({id:'a'}),null);await saveLifeNode(data,createLifeNode({id:'b',parentIds:['a']}),null);
    const a=row(data,'a');await deleteLifeNode(data,a);
    expect(row(data,'b').value.parentIds).toEqual(['a']);await patchLifeNode(data,'b',{title:'Orphan remains editable'},row(data,'b').id);
    await expect(patchLifeNode(data,'a',{title:'old editor'},a.id)).rejects.toThrow('conflict');
    expect(data.get().records.filter(r=>r.entityId==='a')).toHaveLength(2);data.dispose();
  });
  it('does not publish failed migrations, drag, create or text edits',async()=>{
    const {data,disk}=fixture();await data.load();disk.fail=true;
    await expect(migrateLifeNodes(data,{storage:memoryStorage(sources())})).rejects.toThrow();expect(data.get().records).toEqual([]);
    disk.fail=false;await migrateLifeNodes(data,{storage:memoryStorage()});await saveLifeNode(data,createLifeNode({id:'a'}),null);
    const before=data.get().records;disk.fail=true;
    await expect(patchLifeNode(data,'a',{title:'retry draft',type:'vision'},row(data,'a').id)).rejects.toThrow();expect(data.get().records).toEqual(before);
    disk.fail=false;await patchLifeNode(data,'a',{title:'retry draft',type:'vision'},row(data,'a').id);expect(row(data,'a').value.title).toBe('retry draft');data.dispose();
  });
  it('writes native editors through the journal and retains lane/layout/custom hierarchy',async()=>{
    const {data}=await setup(sources()), g=readLifeNodes(data.get().records).nodes.find(n=>n.bindings.goalId==='g');
    await patchLifeNode(data,g.id,{type:'wish',position:{x:48,y:240}},row(data,g.id).id);
    await replaceNativeLifeNodes(data,'goal',list=>list.map(v=>({...v,title:'Native edit',custom:{unchanged:100}})),expected(data));
    expect(row(data,g.id).value).toMatchObject({type:'wish',position:{x:48,y:240},title:'Native edit',details:{goal:{custom:{unchanged:100}}}});
    expect(projectNativeNodes(readLifeNodes(data.get().records).nodes,'goal')[0].title).toBe('Native edit');data.dispose();
  });
  it('keeps unrelated newer edits but rejects stale same-node native writes',async()=>{
    const {data}=await setup(sources()), old=expected(data), id=lifeKey('project','p');
    await patchLifeNode(data,id,{title:'New canvas title'},row(data,id).id);
    await replaceNativeLifeNodes(data,'goal',list=>list.map(v=>({...v,title:'Independent'})),old);
    await expect(replaceNativeLifeNodes(data,'project',list=>list.map(v=>({...v,title:'Overwrite'})),old)).rejects.toThrow('conflict');data.dispose();
  });
  it('materializes a planned stage without replacing its canonical or support ID',async()=>{
    const {data}=await setup(sources()), id=lifeKey('stage','w','v','a-second');
    await replaceNativeLifeNodes(data,'goal',list=>[...list,{id:'new-goal',title:'Stage native',status:'active',lifeplanner:{wishId:'w',visionId:'v',stepId:'a-second'}}],expected(data));
    expect(row(data,id).value.bindings.goalId).toBe('new-goal');expect(readLifeNodes(data.get().records).nodes).toHaveLength(5);data.dispose();
  });
  it('rejects two native goals claiming one stage in one batch',async()=>{
    const {data}=await setup(sources()), before=data.get().records;
    await expect(replaceNativeLifeNodes(data,'goal',list=>[...list,...['new1','new2'].map(id=>({id,title:id,lifeplanner:{wishId:'w',visionId:'v',stepId:'a-second'}}))],expected(data))).rejects.toThrow('conflict');
    expect(data.get().records).toEqual(before);data.dispose();
  });
  it('adapts notebook edits without overwriting canvas type and descendants',async()=>{
    const {data,storage}=await setup(sources()), adapter=createDurablePlannerStore(data,{storage});await adapter.load();
    const id=lifeKey('wish','w');await patchLifeNode(data,id,{type:'vision',title:'Canvas wish'},row(data,id).id);
    const before=adapter.get();await adapter.commit(doc=>updateWish(doc,'w',{starred:true}),before.revision);
    expect(row(data,id).value).toMatchObject({type:'vision',title:'Canvas wish',starred:true});
    expect(row(data,lifeKey('stage','w','v','z-first')).value.bindings.goalId).toBe('g');
    expect(data.get().records.filter(r=>r.kind==='lifeWish'&&!r.deleted)).toHaveLength(0);data.dispose();
  });
  it('preserves existing native goals/projects if their notebook wish is removed',async()=>{
    const {data,storage}=await setup(sources()), adapter=createDurablePlannerStore(data,{storage});await adapter.load();
    await adapter.commit(doc=>({...doc,wishes:[]}),adapter.get().revision);
    expect(projectNativeNodes(readLifeNodes(data.get().records).nodes,'goal').map(n=>n.id)).toEqual(['g']);
    expect(projectNativeNodes(readLifeNodes(data.get().records).nodes,'project').map(n=>n.id)).toEqual(['p']);
    expect(notebookFromLifeNodes(data.get().records).wishes).toEqual([]);data.dispose();
  });
  it('creates new notebook wishes and visions using only flat lifeNode records',async()=>{
    const {data,storage}=await setup(), adapter=createDurablePlannerStore(data,{storage});await adapter.load();
    const w=createWish('New wish','career','w2');w.visions=[createVision('Learn 2 languages','2026-09-28','v2')];
    await adapter.commit(doc=>({...doc,wishes:[w]}),adapter.get().revision);
    expect(readLifeNodes(data.get().records).nodes.map(n=>n.type).sort()).toEqual(['vision','wish']);
    expect(adapter.get().wishes).toEqual([w]);data.dispose();
  });
  it('walks unified edits through file/vault sync, export, restore, deletion and reload',async()=>{
    const {data:a}=await setup(sources()), {data:b}=fixture('b');await b.load();
    const id=lifeKey('project','p'), beforeTask={id:'t',projectId:'p',title:'Task'};
    await patchLifeNode(a,id,{type:'vision',position:{x:368,y:144}},row(a,id).id);
    const merged=mergeSyncData({tasks:[beforeTask],jobuRecords:a.get().records},{tasks:[beforeTask]}).data;
    const remote={};for(const {entity} of shredState(merged)) if(entity._kind==='jobuRecords')applyRemoteEntity(remote,entity);
    const count=remote.jobuRecords.length;applyRemoteDelete(remote,`jobuRecords:${row(a,id).id}`);expect(remote.jobuRecords).toHaveLength(count);
    await b.applyRemote(remote.jobuRecords);await b.load();expect(row(b,id).value).toEqual(row(a,id).value);
    const backup=JSON.parse(b.export());await deleteLifeNode(b,row(b,id));await b.restore(backup.records);
    expect(row(b,id).deleted).toBe(true);expect(merged.tasks).toEqual([beforeTask]);a.dispose();b.dispose();
  });
  it('retains concurrent versions and converges independent of delivery order',async()=>{
    const {data:a}=await setup(), {data:b}=fixture('b');await b.load();await saveLifeNode(a,createLifeNode({id:'a'}),null);await b.restore(a.get().records);
    const opened=row(a,'a').id;await patchLifeNode(a,'a',{title:'A'},opened);await patchLifeNode(b,'a',{title:'B'},opened);
    const merged=mergeJobuRecords(a.get().records,b.get().records), reverse=mergeJobuRecords(b.get().records,a.get().records);
    expect(merged).toEqual(reverse);expect(merged.filter(r=>r.entityId==='a')).toHaveLength(3);
    a.dispose();b.dispose();
  });
  it('serializes two real IndexedDB controllers and detects stale edits inside transaction',async()=>{
    const idb=new IDBFactory();const db=await new Promise((resolve,reject)=>{const r=idb.open('life',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const a=createJobuData({store:createJoboStore({open:async()=>db})}),b=createJobuData({store:createJoboStore({open:async()=>db})});
    await Promise.all([a.load(),b.load()]);await migrateLifeNodes(a,{storage:memoryStorage()});await b.load();
    await Promise.all(['a','b'].map((id,i)=>saveLifeNode(i?b:a,createLifeNode({id}),null)));await a.load();await b.load();
    const r=row(a,'a');await patchLifeNode(a,'a',{type:'vision'},r.id);await expect(patchLifeNode(b,'a',{title:'old'},r.id)).rejects.toThrow('conflict');
    expect(readLifeNodes(a.get().records).nodes).toHaveLength(2);a.dispose();b.dispose();db.close();
  });
  it('routes history restoration through hierarchy guards and retires the old writable wish shape',async()=>{
    const {data}=await setup(sources());
    await expect(restorePlanningRevision(data,{entityId:'lifeWish:w',kind:'lifeWish',value:sources().document.wishes[0],deleted:false})).rejects.toThrow('lifeLegacyRevision');
    expect(data.get().error).toBeNull();const id=lifeKey('project','p'),old=row(data,id);
    await patchLifeNode(data,id,{title:'Changed',type:'wish'},old.id);
    await restorePlanningRevision(data,old);expect(row(data,id).value.type).toBe('project');expect(row(data,id).id).not.toBe(old.id);
    data.dispose();
  });
  it('rejects marker deletion/future node formats on ordinary writes',async()=>{
    const {data}=await setup();await expect(data.save('n','lifeNode',{...createLifeNode({id:'n'}),version:99})).rejects.toThrow('format');
    await expect(data.save(LIFE_NODE_SCHEMA,'lifeNodeSchema',row(data,LIFE_NODE_SCHEMA).value,{deleted:true})).rejects.toThrow('format');
    expect(readLifeNodes(data.get().records).ready).toBe(true);expect(row(data,LIFE_NODE_SCHEMA).value.format).toBe('jobu-life-nodes');data.dispose();
  });
  it('requires a valid recovery snapshot before any migration can publish', async () => {
    const {data} = fixture(); await data.load();
    const storage = memoryStorage(sources());
    storage.setItem(LIFE_SOURCE_BACKUP, '{incomplete');
    await expect(migrateLifeNodes(data, {storage})).rejects.toThrow();
    expect(data.get().records).toEqual([]);
    expect(storage.getItem('day-planner-goals')).toBe(JSON.stringify(sources().goals));
    expect(storage.getItem(LIFE_SOURCE_BACKUP)).toBe('{incomplete'); data.dispose();
  });
  it('blocks direct migration when writing the recovery copy fails, then retries intact', async () => {
    const {data} = fixture(); await data.load(); const storage = memoryStorage(sources());
    const write = storage.setItem; storage.setItem = () => { throw Error('quota'); };
    await expect(migrateLifeNodes(data, {storage})).rejects.toThrow();
    expect(data.get().records).toEqual([]);
    storage.setItem = write; await migrateLifeNodes(data, {storage});
    expect(readLifeNodes(data.get().records).nodes).toHaveLength(5);
    expect(JSON.parse(storage.getItem(LIFE_SOURCE_BACKUP)).sources['day-planner-goals']).toBe(JSON.stringify(sources().goals));
    data.dispose();
  });
  it('does not let a repeated handoff replace an already bound native goal ID', async () => {
    const {data} = await setup(sources()), before = data.get().records;
    await expect(replaceNativeLifeNodes(data, 'goal', list => [...list, {
      id:'other-goal', title:'Another handoff', status:'active',
      lifeplanner:{wishId:'w',visionId:'v',stepId:'z-first'},
    }], expected(data))).rejects.toThrow('conflict');
    expect(data.get().records).toEqual(before);
    expect(projectNativeNodes(readLifeNodes(before).nodes,'goal').map(g=>g.id)).toEqual(['g']); data.dispose();
  });
  it('validates the final graph of a multi-project edit, not each old graph separately', async () => {
    const {data} = await setup();
    for (const id of ['a','b']) await saveLifeNode(data, createLifeNode({ id, type:'project',
      bindings:{projectId:`p-${id}`,goalId:`g-${id}`},
      details:{project:{id:`p-${id}`,title:id},goal:{id:`g-${id}`,title:id}},
    }), null);
    const before = data.get().records;
    await expect(replaceNativeLifeNodes(data, 'project', list => list.map(p => ({...p,
      goalId:p.id === 'p-a' ? 'g-b' : 'g-a',
    })), expected(data))).rejects.toThrow('lifeCycle');
    expect(data.get().records).toEqual(before); data.dispose();
  });
  it('does not allow new cycles inside nodes already downstream of a remote cycle', async () => {
    const {data} = await setup();
    for (const id of ['a','b','c']) await saveLifeNode(data, createLifeNode({id}), null);
    // Independently valid edits can meet in sync as a cycle. Keep all history,
    // allow non-structural repairs, but never add another cyclic relationship.
    await data.save('a','lifeNode',{...row(data,'a').value,parentIds:['b']});
    await data.save('b','lifeNode',{...row(data,'b').value,parentIds:['a']});
    await data.save('c','lifeNode',{...row(data,'c').value,parentIds:['b']});
    await patchLifeNode(data,'a',{title:'Still editable'},row(data,'a').id);
    const before=data.get().records;
    await expect(patchLifeNode(data,'a',{parentIds:['b','c']},row(data,'a').id)).rejects.toThrow('lifeCycle');
    expect(data.get().records).toEqual(before);
    await patchLifeNode(data,'a',{parentIds:[]},row(data,'a').id); data.dispose();
  });

});
