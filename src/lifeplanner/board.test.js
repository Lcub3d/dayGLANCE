import { describe, it, expect } from 'vitest';
import { createLifeNode } from './entities.js';
import { lifeNodesGraph } from '../jobu/lifeNodeStore.js';
import { boardLayout, laneAt, lanePosition, alignedPosition, focusedLifeGraph } from './board.js';
describe('four-lane Life Map layout and focus',()=>{
  it.each([null,'wish','vision','goal','project'])('round trips lane %s from card center',type=>{
    expect(laneAt(lanePosition(type))).toBe(type);
    expect(laneAt(alignedPosition(type,{x:999,y:111}))).toBe(type);
  });
  it('leaves out-of-range drops unclassified by the hit test',()=>{
    expect(laneAt({x:1500,y:0})).toBeUndefined(); expect(laneAt({x:-1000,y:0})).toBeUndefined();
  });
  it('spreads inbox cards without implicitly setting their type or overlapping existing cards',()=>{
    const nodes=[createLifeNode({id:'a',position:lanePosition(null),onCanvas:true}),createLifeNode({id:'b'}),createLifeNode({id:'c'})];
    const before=structuredClone(nodes), positions=boardLayout(nodes);
    expect(new Set([...positions.values()].map(p=>p.y)).size).toBe(3); expect(nodes).toEqual(before);
    expect([...positions.values()].every(p=>laneAt(p)===null)).toBe(true);
  });
  it('keeps coordinates stable across filtering and explicit re-layout only',()=>{
    const node=createLifeNode({id:'a',type:'goal',position:{x:690,y:912}});
    expect(boardLayout([node]).get('a')).toEqual(node.position);
  });
  it('focuses a DAG subtree, exposes outside relations and retains original objects',()=>{
    const all=[createLifeNode({id:'a',type:'wish',title:'A'}),createLifeNode({id:'b',type:'goal',title:'B',parentIds:['a']}),
      createLifeNode({id:'x',type:'goal',title:'X'}),createLifeNode({id:'c',type:'project',title:'Needle',parentIds:['b','x'],bindings:{projectId:'p'}}),createLifeNode({id:'inbox'})];
    const graph=lifeNodesGraph(all,{tasks:[{id:'t',title:'Task',projectId:'p'}]});
    const focused=focusedLifeGraph(graph,{root:'b',showTasks:true});
    expect(focused.nodes.map(n=>n.id)).toEqual(['b','c','["task","t"]']); expect(focused.externalEdges).toHaveLength(2);
    expect(focused.nodes[0]).toBe(graph.nodes[1]);
    const searched=focusedLifeGraph(graph,{root:'a',query:'needle'}); expect(searched.nodes.map(n=>n.id)).toEqual(['a','b','c']);
    expect(focusedLifeGraph(graph).nodes.some(n=>n.id==='inbox')).toBe(false);
    expect(focusedLifeGraph(graph,{root:'inbox'}).nodes.map(n=>n.id)).toEqual(['inbox']);
  });
  it('does not include support networks in descendant navigation',()=>{
    const graph=lifeNodesGraph([createLifeNode({id:'a',type:'goal'}),createLifeNode({id:'b',type:'goal'})]);
    graph.edges.push({source:'a',target:'b',relation:'supports'});
    expect(focusedLifeGraph(graph,{root:'a'}).nodes.map(n=>n.id)).toEqual(['a']);
  });
});
