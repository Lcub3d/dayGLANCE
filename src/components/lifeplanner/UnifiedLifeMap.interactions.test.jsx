import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ slots: [], cursor: 0,
  state(initial) { const i=this.cursor++;if (!(i in this.slots)) this.slots[i]=typeof initial==='function'?initial():initial;
    return [this.slots[i],v=>{this.slots[i]=typeof v==='function'?v(this.slots[i]):v;}]; },
  ref(initial) { const [value]=this.state(()=>({current:initial}));return value; },
}));
vi.mock('react',async()=>{const real=await vi.importActual('react');return {...real,
  useState:runtime.state.bind(runtime),useRef:runtime.ref.bind(runtime),useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:()=>{},
  useSyncExternalStore:(_subscribe,get)=>get()};});
vi.mock('react-i18next',()=>({useTranslation:()=>({t:key=>key})}));
vi.mock('@xyflow/react',()=>({ReactFlow:'flow',ReactFlowProvider:'provider',Background:'background',Handle:'handle',ViewportPortal:'portal',
  Position:{Left:'left',Right:'right'},MarkerType:{ArrowClosed:'closed'},useReactFlow:()=>({getViewport:()=>({x:0,y:0,zoom:1}),viewportInitialized:false})}));
vi.mock('./useLifeNetwork.js',()=>({default:()=>({pending:false,state:{edges:[]}})}));
import UnifiedLifeMap from './UnifiedLifeMap.jsx';
import LifeNodeEditor from './LifeNodeEditor.jsx';
import LifeMapGantt from './LifeMapGantt.jsx';
import { createJobuData } from '../../jobu/data.js';
import { migrateLifeNodes, saveLifeNode, readLifeNodes } from '../../jobu/lifeNodeStore.js';
import { createLifeNode } from '../../lifeplanner/entities.js';
const elements = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree,...elements(tree.props?.children)];
async function fixture() {
  let disk=[],i=0;
  const store={fail:false,read:async()=>({ok:true,value:disk}),writable:async()=>true,
    update:async fn=>{if(store.fail)return{ok:false,error:'quota'};try{disk=fn(disk);return{ok:true,value:disk};}catch(e){return{ok:false,error:e.message};}}};
  const data=createJobuData({store,uuid:()=>`revision-${++i}`});await data.load();const raw=new Map();
  await migrateLifeNodes(data,{storage:{getItem:k=>raw.get(k)??null,setItem:(k,v)=>raw.set(k,v)}});
  await saveLifeNode(data,createLifeNode({id:'idea',title:'Idea'}),null);
  const render=()=>{runtime.cursor=0;const canvas=UnifiedLifeMap({jobuData:data,goals:[],projects:[],tasks:[],unscheduledTasks:[],recurringTasks:[]}).props.children;
    return elements(canvas.type(canvas.props));};
  let tree=render();tree.find(e=>e.type==='button'&&e.props.children==='Idea').props.onClick();tree=render();
  return {data,store,render,tree,editor:()=>render().find(e=>e.type===LifeNodeEditor)};
}
beforeEach(()=>{runtime.slots=[];runtime.cursor=0;vi.stubGlobal('window',{confirm:vi.fn(()=>true)});});
afterEach(()=>vi.unstubAllGlobals());
describe('selected inbox editor after durable placement',()=>{
  it('refreshes its opened head after spreading unclassified ideas',async()=>{
    const f=await fixture(),before=f.editor();await f.tree.find(e=>e.props?.className==='lb-spread').props.onClick();
    expect(f.editor().key).not.toBe(before.key);expect(f.editor().props.row.id).not.toBe(before.props.row.id);
    expect(f.editor().props.row.value).toMatchObject({onCanvas:true,type:null});f.data.dispose();
  });
  it('refreshes its opened head after placing that same selected inbox card',async()=>{
    const f=await fixture(),before=f.editor();const place=f.tree.find(e=>e.type==='button'&&e.props['aria-label']==='lifeBoard.place · Idea');
    await place.props.onClick();expect(f.editor().key).not.toBe(before.key);expect(f.editor().props.row.id).not.toBe(before.props.row.id);f.data.dispose();
  });
  it('does not discard or advance the editor on failed placement',async()=>{
    const f=await fixture(),before=f.editor();f.store.fail=true;
    await f.tree.find(e=>e.props?.className==='lb-spread').props.onClick();expect(f.editor().key).toBe(before.key);
    expect(readLifeNodes(f.data.get().records).nodes[0].onCanvas).toBe(false);f.data.dispose();
  });
  it('leaves a dirty draft and its node untouched when placement confirmation is declined',async()=>{
    const f=await fixture(),before=f.editor();before.props.onDirty(true);window.confirm.mockReturnValue(false);
    await f.tree.find(e=>e.props?.className==='lb-spread').props.onClick();expect(f.editor().key).toBe(before.key);
    expect(readLifeNodes(f.data.get().records).nodes[0].onCanvas).toBe(false);f.data.dispose();
  });
});


describe('Gantt and canvas keep one selection and draft guard', () => {
  const switchButton = f => f.render().find(e => e.type === 'button' && elements(e).some(c => c.props?.children?.includes?.('lifeGantt.title')));
  it('switches without a data write and preserves the same selected node', async () => {
    const f = await fixture(), records = f.data.get().records;
    switchButton(f).props.onClick();
    expect(f.render().find(e => e.type === LifeMapGantt).props.active).toBe(true);
    expect(f.editor().props.row.entityId).toBe('idea');expect(f.data.get().records).toEqual(records);f.data.dispose();
  });
  it('does not lose a dirty node draft when switching is declined', async () => {
    const f = await fixture(), editor = f.editor();editor.props.onDirty(true);window.confirm.mockReturnValue(false);
    switchButton(f).props.onClick();
    expect(f.render().find(e => e.type === LifeMapGantt).props.active).toBe(false);
    expect(f.editor().key).toBe(editor.key);f.data.dispose();
  });
});
