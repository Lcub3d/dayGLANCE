import { describe, expect, it } from 'vitest';
import * as M from './model.js';
const wish = () => M.createWish('A meaningful working life', 'career', 'wish-1');
const vision = () => M.createVision('Publish 2 books, in 3 years', '2026-09-20', 'vision-1');
const doc = () => ({ ...M.defaultDocument(['Be honest']), wishes: [{ ...wish(), visions: [vision()] }] });

describe('Life Planner workbook model', () => {
  it.each([
    ['出版2本书籍，3年内', '出版2本书籍', 2, 3, 'year'],
    ['Publish 2 books, in 3 years', 'Publish 2 books', 2, 3, 'year'],
    ['阅读36本书，36个月内', '阅读36本书', 36, 36, 'month'],
    ['Save 100,000 dollars, in 1825 days', 'Save 100,000 dollars', 100000, 1825, 'day'],
    ['Complete 75% of the course', 'Complete 75% of the course', 75, 5, 'year'],
    ['完成75％的课程', '完成75％的课程', 75, 5, 'year'],
    ['Improve by 0.5 levels', 'Improve by 0.5 levels', .5, 5, 'year'],
    ['Reach -3 degrees', 'Reach -3 degrees', -3, 5, 'year'],
    ['Keep 0 unresolved incidents', 'Keep 0 unresolved incidents', 0, 5, 'year'],
  ])('recognizes the measure and time separately: %s', (text, outcome, target, amount, unit) => {
    expect(M.parseVisionText(text)).toMatchObject({ outcome, target, amount, unit, valid: true });
  });
  it.each(['Learn Spanish', 'Write 2 books and speak 3 languages', '', '2 to 3 books', '1e3 dollars'])('does not choose a number from an ambiguous outcome: %s', text => {
    expect(M.parseVisionText(text)).toMatchObject({ valid: false, target: 100 });
  });
  it('inherits the entire measurement phrase, including percent units', () => {
    expect(M.measureText('完成75%的课程', 25)).toBe('完成25%的课程');
    expect(M.measureText('Publish 2 books', 1)).toBe('Publish 1 books');
  });
  it('starts uncompleted, unstarred, current=0 with no invented stages', () => {
    expect(wish()).toMatchObject({ starred: false, completed: false, visions: [] });
    expect(vision()).toMatchObject({ completed: false, current: 0, steps: [], amount: 3 });
  });
  it.each([[3,'year'], [5,'year'], [36,'month'], [60,'month'], [1095,'day'], [1825,'day']])('accepts a 3–5 year equivalent (%s %s)', (amount, unit) => {
    expect(M.validateVision({ ...vision(), amount, unit })).toBeNull();
  });
  it.each([[2,'year'],[6,'year'],[35,'month'],[61,'month'],[1094,'day'],[1826,'day'],[3.5,'year'],[5,'unknown'],[NaN,'year']])('rejects an invalid horizon (%s %s)', (amount,unit) => {
    expect(M.validateVision({ ...vision(), amount, unit })).toBe('horizon');
  });
  it('rejects invalid date, empty number and repeated step identity', () => {
    expect(M.validateVision({ ...vision(), startDate: '2026-02-30' })).toBe('date');
    expect(M.validateVision({ ...vision(), current: '' })).toBe('number');
    const step = { id:'s1',value:1,amount:1,unit:'year' };
    expect(M.validateVision({ ...vision(),steps:[step,step] })).toBe('steps');
  });
  it('sums successive time windows; values are results, not summed budgets', () => {
    const v = { ...vision(), steps: [{ id:'s1',value:1,amount:12,unit:'month' },{ id:'s2',value:2,amount:2,unit:'year' }] };
    expect(M.totalYears(v)).toBe(3);
    expect(M.validateVision(v)).toBeNull();
    expect(M.milestoneDate(v,'s2')).toBe('2029-09-20');
    expect(M.validateVision({ ...v, amount:3,steps:[...v.steps,{id:'s3',value:2,amount:1,unit:'day'}] })).toBe('total');
  });
  it.each([[0,'year'],[-1,'year'],[1.5,'month'],[6,'year'],[1,'unknown']])('rejects invalid stage duration %s %s', (amount,unit) => {
    expect(M.validateVision({ ...vision(),steps:[{id:'s1',value:1,amount,unit}] })).toBe('duration');
  });
  it('permits downward targets without forcing a completion', () => {
    const v={...vision(),title:'Keep 5 unfinished projects',current:10,steps:[{id:'s1',value:8,amount:1,unit:'year'}]};
    expect(M.validateVision(v)).toBeNull(); expect(v.completed).toBe(false);
  });
  it('clamps leap-day and month-end project dates', () => {
    expect(M.addDuration('2028-02-29',1,'year')).toBe('2029-02-28');
    expect(M.addDuration('2026-01-31',1,'month')).toBe('2026-02-28');
    expect(M.addDuration('2026-12-31',1,'day')).toBe('2027-01-01');
    expect(() => M.addDuration('2026-01-31',1.5,'month')).toThrow('duration');
  });
  it('reorders by identity without changing records, and respects bounds', () => {
    const items=[{id:'a'},{id:'b'},{id:'c'}];
    expect(M.reorder(items,'b',-1).map(x=>x.id)).toEqual(['b','a','c']);
    expect(M.reorder(items,'a',-1)).toBe(items); expect(M.reorder(items,'missing',1)).toBe(items);
  });
  it('updates purpose completion independently from its visions', () => {
    const before=doc(); const next=M.updateWish(before,'wish-1',{completed:true});
    expect(next.wishes[0].completed).toBe(true); expect(next.wishes[0].visions[0].completed).toBe(false);
    expect(before.wishes[0].completed).toBe(false);
  });
  it('updates one vision without losing newer unrelated wish/principle edits', () => {
    const before=doc(); const opened=before.wishes[0].visions[0];
    const concurrent=M.updateWish(before,'wish-1',{title:'Changed title',starred:true});
    const next=M.saveVision(concurrent,'wish-1',{...opened,current:1},opened);
    expect(next.wishes[0]).toMatchObject({title:'Changed title',starred:true});
    expect(next.principles).toEqual(before.principles);
    expect(next.wishes[0].visions[0].current).toBe(1);
  });
  it('does not resurrect deleted wishes or overwrite a newer vision draft', () => {
    const before=doc(),opened=before.wishes[0].visions[0];
    expect(() => M.saveVision({...before,wishes:[]},'wish-1',opened,opened)).toThrow('missing');
    const next=M.saveVision(before,'wish-1',{...opened,current:1},opened);
    expect(() => M.saveVision(next,'wish-1',{...opened,current:2},opened)).toThrow('conflict');
  });
  it('new vision retry cannot append a duplicate', () => {
    const d={...M.defaultDocument(),wishes:[wish()]};
    const next=M.saveVision(d,'wish-1',vision(),null);
    expect(() => M.saveVision(next,'wish-1',vision(),null)).toThrow('conflict');
    expect(next.wishes[0].visions).toHaveLength(1);
  });
  it('validates every identity and field on restore', () => {
    expect(M.validateDocument(doc())).toEqual(doc());
    for (const mutate of [
      d=>{d.version=2;},d=>{d.revision=-1;},d=>{d.wishes[0].category='invalid';},
      d=>{d.wishes[0].title=' ';},d=>{d.wishes[0].starred=1;},d=>{d.wishes[0].visions[0].completed='yes';},
      d=>{d.principles.push({...d.principles[0]});},d=>{d.wishes[0].visions[0].id='wish-1';},
    ]) { const d=doc(); mutate(d); expect(()=>M.validateDocument(d)).toThrow('format'); }
  });
  it('bounds wish and stage counts and text length', () => {
    expect(()=>M.validateDocument({...doc(),wishes:Array.from({length:101},(_,i)=>M.createWish('Wish','other',`w${i}`))})).toThrow('format');
    expect(()=>M.validateDocument({...doc(),wishes:[M.createWish('x'.repeat(2001),'other','long')]})).toThrow('format');
    expect(M.validateVision({...vision(),steps:Array.from({length:31},(_,i)=>({id:`s${i}`,value:i,amount:1,unit:'day'}))})).toBe('steps');
  });
  it('creates only native project fields, never task payloads or completion writes', () => {
    const step={id:'s1',value:1,amount:1,unit:'year'},v={...vision(),steps:[step]};
    expect(M.projectFields(wish(),v,step,'Context')).toEqual({title:'Publish 1 books',description:'Context',targetDate:'2027-09-20',color:'bg-blue-500'});
  });
});
