import { describe, expect, it } from 'vitest';
import { buildLifeMap, filterLifeMap, layoutLifeMap, emptyMapView, MAP_VIEW_KEY, readMapView, readMapTombstones, writeMapView, MAP_WIDTH, MAP_HEIGHT } from './lifeMap.js';
import { provenanceForStep, stableGoalId } from './hierarchy.js';
const key = (type, ...ids) => JSON.stringify([type, ...ids.map(String)]);
function fixture() {
  const step = { id: 's1', value: 1, amount: 1, unit: 'year', projectId: 'p1', goalId: 'life-goal-s1' };
  const vision = { id: 'v1', title: 'Publish 2 books', current: 0, amount: 3, unit: 'year', startDate: '2026-09-21', completed: false, steps: [step] };
  const wish = { id: 'w1', title: 'Write lasting work', category: 'creation', starred: true, completed: false, visions: [vision] };
  return { document: { wishes: [wish] }, goals: [{ id: 'life-goal-s1', title: 'Publish my first book', ...provenanceForStep(wish, vision, step) }],
    projects: [{ id: 'p1', title: 'First manuscript', goalId: 'life-goal-s1' }], tasks: [{ id: 't1', projectId: 'p1', title: 'Write chapter 1', completed: true }],
    unscheduledTasks: [{ id: 't2', projectId: 'p1', title: 'Review outline' }], recurringTasks: [] };
}
const link = (graph, source, target) => graph.edges.find(e => e.source === source && e.target === target);
function freeze(o) { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } return o; }

describe('Life Map projects the existing model without mutating it', () => {
  it('represents each of the five layers and reuses materialised goal identities', () => {
    const f = fixture(), g = buildLifeMap(freeze(f));
    expect(g.nodes.map(n => n.kind)).toEqual(['root','wish','vision','goal','project','task','task']);
    expect(g.nodes.find(n => n.kind === 'goal')).toMatchObject({ id: key('goal','life-goal-s1'), title: 'Publish my first book', planned: false, stepId: 's1' });
    expect(g.nodes.filter(n => n.kind === 'goal')).toHaveLength(1);
    expect(link(g,key('wish','w1'),key('vision','w1','v1'))).toBeTruthy();
    expect(link(g,key('vision','w1','v1'),key('goal','life-goal-s1'))).toBeTruthy();
    expect(link(g,key('goal','life-goal-s1'),key('project','p1'))).toBeTruthy();
    expect(link(g,key('project','p1'),key('task','t1'))).toBeTruthy();
  });
  it('leaves an unmaterialised milestone planned rather than creating a native goal', () => {
    const f=fixture();f.goals=[];f.projects=[];f.document.wishes[0].visions[0].steps[0].projectId=null;
    const before=JSON.stringify(f), g=buildLifeMap(f);
    expect(g.nodes.find(n=>n.kind==='goal')).toMatchObject({nativeId:null,planned:true,title:'Publish 1 books'});
    expect(JSON.stringify(f)).toBe(before);
  });
  it('preserves scheduled and inbox origins and independent completion', () => {
    const g=buildLifeMap(fixture());
    expect(g.nodes.find(n=>n.id===key('task','t1'))).toMatchObject({taskList:'tasks',completed:true});
    expect(g.nodes.find(n=>n.id===key('task','t2'))).toMatchObject({taskList:'unscheduledTasks',completed:false});
    expect(g.nodes.filter(n=>['wish','vision','goal','project'].includes(n.kind)).every(n=>!n.completed)).toBe(true);
  });
  it('deduplicates a native task in scheduled and inbox collections, but not a recurring template', () => {
    const f=fixture();f.unscheduledTasks.push({...f.tasks[0]});f.recurringTasks.push({...f.tasks[0]});
    const g=buildLifeMap(f);
    expect(g.nodes.filter(n=>n.nativeId==='t1')).toHaveLength(2);
    expect(g.nodes.find(n=>n.id===key('template','t1')).recurring).toBe(true);
  });
  it('does not include recycle-bin rows, routines or example tasks', () => {
    const f=fixture();f.recycleBin=[{id:'binned'}];f.todayRoutines=[{id:'routine'}];f.tasks.push({id:'example',isExample:true});
    expect(buildLifeMap(f).nodes.some(n=>['binned','routine','example'].includes(n.nativeId))).toBe(false);
  });
  it('excludes deleted native entities without resurrecting them', () => {
    const f=fixture();f.deletedProjectIds={p1:'deleted'};const g=buildLifeMap(f);
    expect(g.nodes.some(n=>n.id===key('project','p1'))).toBe(false);
    expect(g.nodes.find(n=>n.missing)).toMatchObject({id:key('missing-project','p1')});
    expect(g.nodes.find(n=>n.missing).nativeId).toBeUndefined();
  });
  it('represents broken links as unavailable references, not fake project data', () => {
    const f=fixture();f.projects=[];const g=buildLifeMap(f);
    expect(g.nodes.find(n=>n.missing).title).toBe('');expect(g.edges.some(e=>e.relation==='missing')).toBe(true);
  });
  it('marks conflicting stage links and retains the actual native goal relation', () => {
    const f=fixture();f.goals.push({id:'native',title:'Actual goal'});f.projects[0].goalId='native';const g=buildLifeMap(f);
    expect(link(g,key('goal','life-goal-s1'),key('project','p1')).relation).toBe('conflict');
    expect(link(g,key('goal','native'),key('project','p1')).relation).toBe('child');
    expect(f.projects[0].goalId).toBe('native');
  });
  it('does not claim an unrelated goal that happens to use a reserved ID', () => {
    const f=fixture();f.goals[0]={id:'life-goal-s1',title:'Foreign',source_app:'foreign'};const g=buildLifeMap(f);
    const stage=g.nodes.find(n=>n.stepId==='s1'&&n.kind==='goal');expect(stage.planned).toBe(true);expect(stage.nativeId).toBeNull();
    expect(link(g,'unlinked',key('goal','life-goal-s1'))).toBeTruthy();
  });
  it('adds other native projects assigned to the same goal, without repeating the goal', () => {
    const f=fixture();f.projects.push({id:'p2',title:'Another project',goalId:'life-goal-s1'});const g=buildLifeMap(f);
    expect(link(g,key('goal','life-goal-s1'),key('project','p2'))).toBeTruthy();
    expect(g.nodes.filter(n=>n.nativeId==='life-goal-s1')).toHaveLength(1);
  });
  it('groups standalone native data rather than inventing wishes', () => {
    const f=fixture();f.goals.push({id:5,title:'Standalone'});f.projects.push({id:6,goalId:'5',title:'Native project'});f.tasks.push({id:7,projectId:'6',title:'Native task'});const g=buildLifeMap(f);
    expect(link(g,'unlinked',key('goal',5))).toBeTruthy();expect(link(g,key('goal',5),key('project',6))).toBeTruthy();expect(link(g,key('project',6),key('task',7))).toBeTruthy();
    expect(g.nodes.filter(n=>n.kind==='wish')).toHaveLength(1);
  });
  it('shared projects have one visual identity and multiple links', () => {
    const f=fixture();f.document.wishes[0].visions[0].steps.push({...f.document.wishes[0].visions[0].steps[0],id:'s2'});const g=buildLifeMap(f);
    expect(g.nodes.filter(n=>n.id===key('project','p1'))).toHaveLength(1);expect(g.edges.filter(e=>e.target===key('project','p1'))).toHaveLength(2);
  });
  it('IDs are stable after titles change or wishes reorder', () => {
    const f=fixture();const before=buildLifeMap(f).nodes.map(n=>n.id);f.document.wishes[0].title='New title';f.tasks.reverse();f.document.wishes.reverse();
    expect(buildLifeMap(f).nodes.map(n=>n.id).sort()).toEqual(before.sort());
  });
  it('supports a completely empty document', () => {
    expect(buildLifeMap().nodes.map(n=>n.kind)).toEqual(['root']);expect(buildLifeMap().edges).toEqual([]);
  });
});

describe('Life Map navigation and deterministic layout', () => {
  it.each([1,2,3,4,5])('limits the visible depth to %s without removing data',level=>{
    const g=buildLifeMap(fixture()), before=JSON.stringify(g), visible=filterLifeMap(g,{level});
    expect(visible.nodes.length).toBe(level===5?7:level+1);expect(JSON.stringify(g)).toBe(before);
  });
  it('collapses descendants and restores them when expanded',()=>{
    const g=buildLifeMap(fixture());expect(filterLifeMap(g,{collapsed:[key('vision','w1','v1')]}).nodes).toHaveLength(3);
    expect(filterLifeMap(g).nodes).toHaveLength(7);
  });
  it('searches through collapsed branches and lower levels with ancestor context',()=>{
    const g=buildLifeMap(fixture()), v=filterLifeMap(g,{query:'chapter',level:1,collapsed:[key('wish','w1')]});
    expect(v.matchCount).toBe(1);expect(v.nodes).toHaveLength(6);expect(v.nodes.some(n=>n.title==='Write chapter 1')).toBe(true);
  });
  it('an unmatched search has an empty presentation, not an empty document',()=>{
    const g=buildLifeMap(fixture());expect(filterLifeMap(g,{query:'absent'}).nodes).toHaveLength(1);expect(g.nodes).toHaveLength(7);
  });
  it('unlinked native items are opt-in',()=>{
    const f=fixture();f.unscheduledTasks.push({id:'unlinked',title:'Do later'});const g=buildLifeMap(f);
    expect(filterLifeMap(g).nodes.some(n=>n.nativeId==='unlinked')).toBe(false);
    expect(filterLifeMap(g,{showUnlinked:true}).nodes.some(n=>n.nativeId==='unlinked')).toBe(true);
  });
  it('focuses the chosen wish and excludes other wishes and unlinked items',()=>{
    const f=fixture();f.document.wishes.push({id:'w2',title:'Second',visions:[]});const g=buildLifeMap(f);
    expect(filterLifeMap(g,{wishId:'w2',showUnlinked:true}).nodes.map(n=>n.id)).toEqual(['root',key('wish','w2')]);
  });
  it('lays out siblings without overlap and preserves node identity',()=>{
    const g=filterLifeMap(buildLifeMap(fixture()));const placed=layoutLifeMap(g);
    expect(layoutLifeMap(g)).toEqual(placed);
    const leaves=placed.filter(n=>n.data.kind==='task');expect(Math.abs(leaves[0].position.y-leaves[1].position.y)).toBeGreaterThan(MAP_HEIGHT);
    expect(placed.every(n=>Number.isFinite(n.position.x)&&Number.isFinite(n.position.y))).toBe(true);
  });
  it('manual positions affect presentation only and invalid coordinates are ignored',()=>{
    const g=filterLifeMap(buildLifeMap(fixture()));const a=layoutLifeMap(g,{[key('wish','w1')]:{x:22,y:35},[key('task','t1')]:{x:NaN,y:10}});
    expect(a.find(n=>n.id===key('wish','w1')).position).toEqual({x:22,y:35});expect(a.every(n=>Number.isFinite(n.position.x))).toBe(true);
  });
  it('handles a large tree with finite layout and no recursion overflow',()=>{
    const f=fixture();f.tasks=Array.from({length:2500},(_,i)=>({id:`t${i}`,title:`Task ${i}`,projectId:'p1'}));
    const g=filterLifeMap(buildLifeMap(f));expect(layoutLifeMap(g)).toHaveLength(2505);
  });
});

describe('map layout storage is separate, bounded and fail-safe',()=>{
  function storage(raw=null) {const data=new Map([[MAP_VIEW_KEY,raw],['day-planner-tasks','untouched']]);return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
  it('does not write when reading an absent layout',()=>{const s=storage();expect(readMapView(s)).toEqual({value:emptyMapView(),error:null});expect(s.data.get(MAP_VIEW_KEY)).toBeNull();});
  it.each(['no JSON','null','[]','{"version":2}','{"version":1,"positions":[],"collapsed":[]}'])('fails closed on %s',raw=>{const s=storage(raw);expect(readMapView(s).error).toBe('viewReadError');expect(s.data.get(MAP_VIEW_KEY)).toBe(raw);});
  it('prunes orphan positions and never touches the business document',()=>{const s=storage();expect(writeMapView(s,{positions:{valid:{x:0,y:1},old:{x:1,y:1}},collapsed:['valid','old','valid']},['valid'])).toBe(true);expect(readMapView(s).value).toEqual({version:1,positions:{valid:{x:0,y:1}},collapsed:['valid']});expect(s.data.get('day-planner-tasks')).toBe('untouched');});
  it('caps metadata size and validates finite coordinates',()=>{const s=storage();const positions=Object.fromEntries(Array.from({length:3000},(_,i)=>[`n${i}`,{x:i,y:i}]));writeMapView(s,{positions,collapsed:Object.keys(positions)},Object.keys(positions));expect(Object.keys(readMapView(s).value.positions)).toHaveLength(2000);});
  it('reports failed writes rather than claiming persistence',()=>{const s={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('quota')}};expect(readMapView(s).error).toBeTruthy();expect(writeMapView(s,emptyMapView(),[])).toBe(false);});
});


describe('native deletion-state reads', () => {
  it('passes the two native tombstone maps through without writes', () => {
    const getItem = key => key.includes('goal') ? '{"g":123}' : '{"p":456}';
    expect(readMapTombstones({ getItem })).toEqual({ deletedGoalIds: { g: 123 }, deletedProjectIds: { p: 456 }, error: null });
  });
  it('fails closed for invalid native deletion metadata', () => {
    expect(readMapTombstones({ getItem: () => 'false' }).error).toBe('nativeReadError');
    expect(readMapTombstones({ getItem: () => { throw Error('blocked'); } }).error).toBe('nativeReadError');
  });
});
