import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, createVision, createWish, defaultDocument, validateDocument } from './model.js';
import { commitNotebookText, moveNotebookItem, moveNotebookItems, notebookCategories } from './notebook.js';
import { createPlannerStore } from './store.js';

function doc() {
  const result = defaultDocument(['Be kind']);
  result.wishes = ['a', 'b', 'c'].map(id => createWish(id, id === 'c' ? 'health' : 'creation', id));
  result.wishes[0].visions = [createVision('Write 2 books', '2026-09-20', 'vision')];
  return result;
}
describe('notebook is a view of the existing Life Planner document', () => {
  it('exposes all eleven categories even when the document is empty', () => {
    const groups = notebookCategories([]);
    expect(groups.map(g => g.id)).toEqual(CATEGORY_IDS);
    expect(groups.every(g => g.wishes.length === 0)).toBe(true);
  });
  it('does not mutate, clone, fabricate or persist example wishes', () => {
    const d = doc(), before = JSON.stringify(d);
    const groups = notebookCategories(d.wishes);
    expect(groups.flatMap(g => g.wishes)).toHaveLength(3);
    expect(groups.find(g => g.id === 'creation').wishes[0]).toBe(d.wishes[0]);
    expect(JSON.stringify(d)).toBe(before);
  });
  it.each([['a','c',true,['b','c','a']], ['c','a',false,['c','a','b']], ['a','a',false,['a','b','c']], ['b','c',false,['a','b','c']]])('moves %s relative to %s preserving identities', (id, target, after, expected) => {
    const d=doc(), moved=moveNotebookItem(d.wishes,id,target,after);
    expect(moved.map(w=>w.id)).toEqual(expected);
    expect(moved.find(w=>w.id==='a')).toBe(d.wishes[0]);
    expect(d.wishes.map(w=>w.id)).toEqual(['a','b','c']);
  });
  it.each([
    [['b','c'], 'a', false, ['b','c','a','d']],
    [['b','c'], 'd', true, ['a','d','b','c']],
    [['a','c'], 'd', false, ['b','a','c','d']],
  ])('moves a selected block as one unit while keeping internal order: %j', (moving, target, after, expected) => {
    const d = doc(); d.wishes.push(createWish('d', 'creation', 'd'));
    const moved = moveNotebookItems(d.wishes, moving, target, after);
    expect(moved.map(item => item.id)).toEqual(expected);
    expect(moved.find(item => item.id === 'b')).toBe(d.wishes[1]);
    expect(moved.find(item => item.id === 'c')).toBe(d.wishes[2]);
  });
  it('rejects a batch target inside the selected block and stale batch snapshots', () => {
    const d = doc();
    expect(moveNotebookItems(d.wishes, ['b','c'], 'c', false)).toBe(d.wishes);
    expect(() => moveNotebookItems([...d.wishes].reverse(), ['b','c'], 'a', false, ['a','b','c'])).toThrow('conflict');
    expect(() => moveNotebookItems(d.wishes, ['a','outside'], 'c')).toThrow('missing');
  });
  it('reorders within the assistant category without changing category or dropping hidden rows', () => {
    const d=doc(), moved=moveNotebookItem(d.wishes,'b','a',false,['a','b']);
    expect(moved.map(w=>w.id)).toEqual(['b','a','c']);
    expect(moved[0].category).toBe('creation');
  });
  it('rejects a stale order when another tab moved or removed an involved row', () => {
    const d=doc();
    expect(()=>moveNotebookItem([...d.wishes].reverse(),'a','b',false,['a','b','c'])).toThrow('conflict');
    expect(()=>moveNotebookItem(d.wishes.slice(1),'a','b',false,['a','b','c'])).toThrow('conflict');
  });
  it('rejects drag targets outside the current group', () => {
    expect(()=>moveNotebookItem(doc().wishes,'a','c',false,['a','b'])).toThrow('missing');
  });
  it('keeps concurrently updated content and unrelated inserted rows', () => {
    const d=doc();d.wishes[0].title='New title';d.wishes.push(createWish('new','social','d'));
    const moved=moveNotebookItem(d.wishes,'b','a',false,['a','b','c']);
    expect(moved.map(w=>w.id)).toEqual(['b','a','c','d']);expect(moved[1].title).toBe('New title');
  });
  it('uses the same unmodified schema for inline creation', () => {
    const d=doc(), next=commitNotebookText(d,{kind:'wish',id:'new',text:'  A real wish  ',before:'',isNew:true,category:'family'});
    expect(validateDocument(next)).toBe(next);
    expect(next.wishes.at(-1)).toEqual(createWish('A real wish','family','new'));
    expect(d.wishes).toHaveLength(3);
  });
  it('idempotently retries creation rather than duplicating the row', () => {
    const draft={kind:'wish',id:'new',text:'A wish',before:'',isNew:true};
    const next=commitNotebookText(doc(),draft);
    expect(commitNotebookText(next,draft)).toBe(next);
    expect(next.wishes).toHaveLength(4);
  });
  it('an inline title edit preserves later stars, vision stages and native project links', () => {
    const d=doc();d.wishes[0].starred=true;d.wishes[0].visions[0].steps=[{id:'s',value:1,amount:1,unit:'year',projectId:'project'}];
    const next=commitNotebookText(d,{kind:'wish',id:'a',text:'Edited',before:'a'});
    expect(next.wishes[0]).toMatchObject({starred:true,title:'Edited'});
    expect(next.wishes[0].visions).toBe(d.wishes[0].visions);
  });
  it('rejects a stale title without overwriting a newer title', () => {
    const d=doc();d.wishes[0].title='External edit';
    expect(()=>commitNotebookText(d,{kind:'wish',id:'a',before:'a',text:'Stale'})).toThrow('conflict');
    expect(d.wishes[0].title).toBe('External edit');
  });
  it('never resurrects a deleted persisted wish', () => {
    expect(()=>commitNotebookText(doc(),{kind:'wish',id:'deleted',before:'old',text:'new'})).toThrow('missing');
  });
  it('leaves a conflicting reserved new identity unchanged', () => {
    expect(()=>commitNotebookText(doc(),{kind:'wish',id:'a',isNew:true,before:'',text:'new'})).toThrow('conflict');
  });
  it.each(['', ' ', 'a'.repeat(2001)])('rejects empty or excessive text without deleting a row (%s)', text => {
    expect(()=>commitNotebookText(doc(),{kind:'wish',id:'a',text,before:'a'})).toThrow('title');
  });
  it('creates and edits mottos without touching wishes', () => {
    const d=doc(), next=commitNotebookText(d,{kind:'principle',id:'m',text:'Keep learning',isNew:true,before:''});
    expect(next.wishes).toBe(d.wishes);
    expect(commitNotebookText(next,{kind:'principle',id:'m',text:'Keep going',before:'Keep learning'}).principles.at(-1).text).toBe('Keep going');
  });
  it.each(['wish','principle'])('retains the existing 100-item safety bound for %s', kind => {
    const d=doc();const field=kind==='wish'?'wishes':'principles';d[field]=Array.from({length:100},(_,i)=>kind==='wish'?createWish('Wish','other',`id${i}`):{id:`id${i}`,text:'Motto'});
    expect(()=>commitNotebookText(d,{kind,id:'overflow',text:'x',before:'',isNew:true})).toThrow('limit');
  });
  it('does not fake a durable edit or mutate the store when disk writes fail', async () => {
    const initial=doc();let fail=true;
    const data=new Map([['day-planner-lifeplanner-v1',JSON.stringify(initial)]]);
    const store=createPlannerStore({storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('quota');data.set(k,v);}},defaults:[]});
    const transform=d=>commitNotebookText(d,{kind:'wish',id:'a',text:'Edited',before:'a'});
    await expect(store.commit(transform)).rejects.toThrow('storageWrite');
    expect(store.get().wishes[0].title).toBe('a');fail=false;
    await store.commit(transform);expect(store.get().wishes[0].title).toBe('Edited');
  });
});
