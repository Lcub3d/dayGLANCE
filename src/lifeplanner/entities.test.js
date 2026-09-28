import { describe, it, expect } from 'vitest';
import { validateDocument } from './model.js';
import { createLifeNode, flattenLifeSources, withNotebookOrder, projectNotebookNodes, projectNativeNodes, patchFromNative,
  lifeKey, validateLifeValue, lifeDescendants, lifeHierarchyCycles, visibleLifeNodes } from './entities.js';
import { sources } from './entities.fixtures.js';
import { networkNodeId } from './supportNetwork.js';
import { lifeNodesGraph } from '../jobu/lifeNodeStore.js';
describe('canonical planning entities', () => {
  it.each([null,'wish','vision','goal','project'])('uses exactly the same shape for type %s', type => {
    const value = createLifeNode({ id:lifeKey('node','中文 " quoted'),type });
    expect(Object.keys(value)).toEqual(['version','id','type','title','description','completed','starred','parentIds','position','onCanvas','bindings','details']);
    expect(value.onCanvas).toBe(type !== null); expect(() => validateLifeValue('lifeNode', value)).not.toThrow();
  });
  it('flattens nested stages and a native goal into one durable identity', () => {
    const input = sources(), nodes = withNotebookOrder(flattenLifeSources(input), input.document);
    expect(nodes).toHaveLength(5); expect(nodes.map(n=>n.type).sort()).toEqual(['goal','goal','project','vision','wish']);
    const linked = nodes.find(n => n.bindings.goalId === 'g');
    expect(linked.id).toBe(lifeKey('stage','w','v','z-first'));
    expect(linked.details.goal.custom).toEqual({unchanged:42});
    expect(linked.parentIds).toEqual([lifeKey('vision','w','v')]);
    expect(nodes.find(n=>n.bindings.projectId==='p').parentIds).toEqual([linked.id]);
    expect(nodes.some(n=>n.details.wish?.visions || n.details.vision?.steps)).toBe(false);
    expect(projectNativeNodes(nodes, 'goal')).toEqual(input.goals);
    expect(projectNativeNodes(nodes, 'project')).toEqual(input.projects);
  });
  it('round-trips notebook stage order, metric values and horizons', () => {
    const input = sources(), nodes = withNotebookOrder(flattenLifeSources(input), input.document);
    const doc = projectNotebookNodes(nodes, { ...input.document, wishOrder:['w'] });
    expect(doc.wishes).toEqual(input.document.wishes); expect(()=>validateDocument(doc)).not.toThrow();
  });
  it('keeps native IDs, payload and network identity when classified differently', () => {
    const input = sources(), nodes = flattenLifeSources(input), linked = nodes.find(n => n.bindings.goalId === 'g');
    const before = networkNodeId(lifeNodesGraph([linked]).nodes[0]);
    linked.type = 'wish'; linked.title = 'A new direction';
    expect(projectNativeNodes([linked],'goal')[0]).toMatchObject({id:'g',title:'A new direction',custom:{unchanged:42}});
    expect(networkNodeId(lifeNodesGraph([linked]).nodes[0])).toBe(before);
  });
  it('does not replace a measured legacy vision title with unparseable common text', () => {
    const input = sources(), nodes = withNotebookOrder(flattenLifeSources(input), input.document);
    nodes.find(n=>n.type==='vision').title = 'Explore the world';
    const doc = projectNotebookNodes(nodes, input.document);
    expect(doc.wishes[0].visions[0].title).toBe(input.document.wishes[0].visions[0].title);
    expect(()=>validateDocument(doc)).not.toThrow();
  });
  it('keeps archived statuses and unknown native metadata, and updates completion explicitly', () => {
    const n = createLifeNode({id:'n',type:'project',bindings:{projectId:'p'}, details:{project:{id:'p',title:'P',status:'archived',opaque:{x:1}}}});
    expect(projectNativeNodes([n],'project')[0].status).toBe('archived');
    const patched = patchFromNative(n,'project',{id:'p',title:'Renamed',status:'completed',opaque:{x:2}});
    expect(patched.completed).toBe(true); expect(patched.id).toBe('n'); expect(patched.details.project.opaque.x).toBe(2);
  });
  it.each([{type:'task'},{parentIds:['n']},{position:{x:Infinity,y:10}},{position:{x:2,y:NaN}},{details:{wish:{visions:[]}}},{details:{vision:{steps:[]}}}])('rejects malformed shapes %j', patch => {
    expect(()=>validateLifeValue('lifeNode',{...createLifeNode({id:'n'}),...patch})).toThrow('format');
  });
  it('supports multiple parents and same-type descendants without cloning a shared node', () => {
    const nodes = [{id:'a',parentIds:[]},{id:'b',parentIds:['a']},{id:'c',parentIds:['a']},{id:'d',parentIds:['b','c']}];
    expect([...lifeDescendants(nodes,'a')]).toHaveLength(4); expect(lifeHierarchyCycles(nodes)).toEqual([]);
    expect(lifeDescendants(nodes,'b')).toEqual(new Set(['b','d']));
    nodes[0].parentIds = ['d']; expect(lifeHierarchyCycles(nodes).length).toBeGreaterThan(0);
  });
  it('preserves native permission filtering even after type changes',()=>{
    const a=createLifeNode({id:'a',type:'wish',bindings:{goalId:'hidden'}}),b=createLifeNode({id:'b',type:'vision'});
    expect(visibleLifeNodes([a,b],[],[])).toEqual([b]);
    expect(visibleLifeNodes([a,b],undefined,undefined)).toEqual([a,b]);
  });
  it('preserves every legacy stage when two stages reference the same goal', () => {
    const input = sources(); input.document.wishes[0].visions[0].steps[1].goalId = 'g';
    const nodes = withNotebookOrder(flattenLifeSources(input),input.document);
    expect(nodes.filter(n=>n.details.stage)).toHaveLength(2); expect(nodes.filter(n=>n.bindings.goalId==='g')).toHaveLength(1);
    expect(projectNotebookNodes(nodes,input.document).wishes).toEqual(input.document.wishes);
  });
});
