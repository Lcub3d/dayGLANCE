import { describe, it, expect } from 'vitest';
import { compileJobuFilter, quoteFilterName } from './filters.js';
import { FILTER_TEMPLATES } from './filterTemplates.js';
import { taskDate, readDate, parseFilterDate } from './filterDates.js';
import { collectFilterTasks, filterProjects } from './filterTasks.js';

const now = new Date(2026, 8, 28, 12), today = '2026-09-28';
const options = { now, today, projects: [{ id:'work', title:'工作' }, { id:'sub', title:'子项目', parentId:'work' }] };
const tasks = [
  {id:'a',title:'材料 #进行',date:today,startTime:'13:00',priority:3,projectId:'work'},
  {id:'b',title:'轻任务',date:today,isAllDay:true,priority:0},
  {id:'c',title:'过期 #进行',date:'2026-09-27',priority:2,projectId:'work'},
  {id:'d',title:'等待',priority:1},
  {id:'e',title:'可能',priority:0},
  {id:'f',title:'执行',priority:2,projectId:'work'},
  {id:'g',title:'已完成',date:today,priority:3,completed:true},
  {id:'h',title:'已删除',date:today,priority:3,deleted:true},
  {id:'i',title:'已归档',date:today,priority:3,archived:true},
];
const matching = (query, input = tasks, extra = {}) => input.filter(compileJobuFilter(query, {...options,...extra}).test).map(t=>t.id);
const expected = {
 today:['a','b','c'], home:['a','b','c','d','e'], 'no-label':['b','d','e','f'], 'today-tasks':['a'], 'today-goals':['a'], 'in-progress':['a','c'], 'no-date':['d','e','f'], soon:['a','c'], someday:['e'], waiting:['d'], 'next-actions':['f'], p1:['a'], p2:['c','f'], p4:['b','e'], overdue:['c'], 'today-unplanned':['b'],
};
describe('The actual requested Todoist templates', () => {
 it.each(FILTER_TEMPLATES)('$name — $query', template => {
  const result = compileJobuFilter(template.query, options);
  expect(result.error).toBeNull(); expect(matching(template.query).sort()).toEqual(expected[template.id].sort());
 });
 it('keeps comma lists separate, counts union once, and allows a task in multiple lists', () => {
  const result = compileJobuFilter('today, p1', options);
  expect(result.sections.map(s=>tasks.filter(s.test).map(t=>t.id))).toEqual([['a','b'],['a']]);
  expect(tasks.filter(result.test).map(t=>t.id)).toEqual(['a','b']);
 });
 it('keeps 今日目标 a task-priority filter, never an inference about goal entities', () => {
  expect(matching('今天&!p4',[{id:'task',date:today,priority:1},{id:'goal-tag',date:today,priority:0,title:'#goal'}])).toEqual(['task']);
 });
});
describe('Filter grammar and honest dates', () => {
 it.each(['', 'today &', '(today', 'today,', 'today,,p1', '(today,p1)', '!assigned to: me', '!/section', 'p9', '!#missing', 'eval(1)', 'due before: bananas', 'date: 2026-02-30', '('.repeat(40)+'p1'+')'.repeat(40)])('fails closed for %s', query => {
  const result=compileJobuFilter(query, options); expect(result.error).toBeTruthy();expect(result.sections).toEqual([]);expect(result.test(tasks[0])).toBe(false);
 });
 it('uses AND precedence before OR and explicit groups',()=>{
  expect(matching('today | no date & p3')).toEqual(['a','b','d']);
  expect(matching('(today | no date) & p3')).toEqual(['d']);
 });
 it('hides completed tasks for all, priorities, labels and negation unless explicitly requested',()=>{
  expect(matching('all')).not.toContain('g');expect(matching('p1')).toEqual(['a']);expect(matching('!%missing')).not.toContain('g');expect(matching('completed')).toEqual(['g']);expect(matching('!completed')).toEqual(['a','b','c','d','e','f']);
 });
 it('accepts Chinese aliases, p/P, source labels and native nested tags',()=>{
  expect(matching('今日 & P1')).toEqual(['a']);
  const data=[{id:'x',title:'Native #work/deep',todoist:{labels:['进行','场所: 公园']}}];
  expect(matching('@进行 & %work/deep',data)).toEqual(['x']);
  expect(matching('%"场所: 公园"',data)).toEqual(['x']);
 });
 it.each(['with spaces', 'x,y&z|a!b(c)', 'x*y', 'quoted"name', 'back\\slash', 'café', '纯中文'])('safely round-trips exact label %s',name=>{
  const query='%'+quoteFilterName(name);const f=compileJobuFilter(query,{...options,getLabels:t=>t.labels});
  expect(f.error).toBeNull();expect(f.test({labels:[name]})).toBe(true);expect(f.test({labels:[name.replace('*','ANYTHING')+'no']})).toBe(false);
 });
 it('supports escaped operators and globs without regex injection or catastrophic backtracking',()=>{
  expect(matching('%a\\&b',[{id:'x',todoist:{labels:['a&b']}}])).toEqual(['x']);
  expect(matching('%work*',[{id:'x',title:'#work/deep'}])).toEqual(['x']);
  expect(compileJobuFilter(`%${'a*'.repeat(500)}b`,{...options,getLabels:()=>['a'.repeat(128)]}).test({})).toBe(false);
 });
 it('distinguishes undated tasks, date-only tasks and timed tasks',()=>{
  expect(matching('no time')).toEqual(['b','c']);expect(matching('today & no time')).toEqual(['b']);expect(matching('no date')).toEqual(['d','e','f']);
 });
 it('compares hour boundaries with times, not fabricated same-day midnight appointments',()=>{
  const input=[{id:'prior',date:'2026-09-27'},{id:'14',date:today,startTime:'14:59'}, {id:'15',date:today,startTime:'15:00'},{id:'date-only',date:today},{id:'absent'}];
  expect(matching('due before: +3 hours',input)).toEqual(['prior','14']);
  expect(matching('today & due after: today at 2pm',input)).toEqual(['14','15']);
 });
 it('uses due date before deadline, retains no-date distinction, never rewrites storage',()=>{
  const input=[{id:'both',date:'2026-09-29',deadline:today},{id:'deadline',deadline:today},{id:'none'}];
  const before=structuredClone(input);
  expect(matching('today',input)).toEqual(['deadline']);expect(matching('deadline: today',input)).toEqual(['both','deadline']);expect(matching('no date',input)).toEqual(['deadline','none']);
  expect(matching('no time',input)).toEqual(['both','deadline']);expect(input).toEqual(before);
 });
 it('filters the stored Todoist due date independently of a local time block',()=>{
  const task={id:'linked',date:'2026-09-30',startTime:'15:00',todoist:{due:{date:today},labels:[]}};
  expect(matching('today & no time',[task])).toEqual(['linked']);expect(matching('no date',[{...task,todoist:{due:null}}])).toEqual(['linked']);
 });
 it('handles strict ISO, explicit clocks and daylight-saving-aware local boundaries',()=>{
  expect(readDate('2026-02-30')).toBeNull();expect(readDate('2026-09-28T26:00:00Z')).toBeNull();
  expect(parseFilterDate('tomorrow at 3pm',options)).toMatchObject({day:'2026-09-29',time:'15:00'});
  expect(parseFilterDate('+1 days',{...options,today:'2026-12-31'}).day).toBe('2027-01-01');
  expect(taskDate({date:today,startTime:'09:00',isAllDay:true}).time).toBeNull();
 });
 it('respects explicit source timezones and does not call malformed or ambiguous dates undated',()=>{
  const value=taskDate({todoist:{due:{date:'2026-09-29T00:30:00',timezone:'Asia/Tokyo'}}});
  expect(value.instant).toBe(Date.parse('2026-09-28T15:30:00Z'));
  const invalid={id:'invalid',date:'bad-date',deadline:today};
  expect(matching('no date',[invalid])).toEqual([]);expect(matching('today',[invalid])).toEqual([]);
  const ambiguous={id:'fold',todoist:{due:{date:'2026-11-01T01:30:00',timezone:'America/New_York'}}};
  expect(taskDate(ambiguous)).toBeNull();expect(matching('no date',[ambiguous])).toEqual([]);
 });
 it('supports direct/descendant projects, source-only projects and project-less Inbox',()=>{
  const input=[{id:'parent',projectId:'work'},{id:'child',projectId:'sub'},{id:'inbox',date:today},{id:'source',todoist:{accountId:'local',projectId:'source',project:'Remote'}}];
  const projects=filterProjects(options.projects,input.map(task=>({task})));
  expect(matching('#工作',input,{projects})).toEqual(['parent']);expect(matching('##工作',input,{projects})).toEqual(['parent','child']);
  expect(matching('#收件箱',input,{projects})).toEqual(['inbox']);expect(matching('#Remote',input,{projects})).toEqual(['source']);
 });
 it('searches all words across title/description and bounded calendar-day ranges',()=>{
  expect(matching('search: draft report',[{id:'x',title:'Report',notes:'Draft attached'}])).toEqual(['x']);
  expect(matching('3 days',[{id:'a',date:today},{id:'b',date:'2026-09-30'},{id:'c',date:'2026-10-01'}])).toEqual(['a','b']);
 });
});
describe('Filter population is not the currently selected calendar',()=>{
 it('deduplicates tasks, excludes other users, archives, examples and readonly calendar events',()=>{
  const input={tasks:[{id:'a'}, {id:'dup'}, {id:'old',projectId:'archive'}, {id:'event',imported:true}, {id:'other',owner:'other'},{id:'example',isExample:true}],unscheduledTasks:[{id:'dup'},{id:'inbox'}],projects:[{id:'archive',archived:true}],isVisibleForUser:t=>t.owner!=='other',today};
  expect(collectFilterTasks(input).map(e=>e.task.id)).toEqual(['a','dup','inbox']);
 });
 it('projects one next native occurrence, respecting completed, exceptions and repeat limits',()=>{
  const series={id:'r',title:'Base',recurrence:{type:'daily',startDate:today,endDate:'2026-10-02'},completedDates:[today],exceptions:{'2026-09-29':{skipped:true},'2026-09-30':{title:'Occurrence'}}};
  const entries=collectFilterTasks({recurringTasks:[series],today});
  expect(entries).toHaveLength(1);expect(entries[0].task).toMatchObject({date:'2026-09-30',recurringTemplateId:'r',title:'Occurrence',completed:false});
 });
 it('checklist children keep own facts and a stable parent action link',()=>{
  const task={id:'parent',date:today,priority:3,title:'Parent #tag',projectId:'work',subtasks:[{id:'s',title:'Child'}]};
  const entries=collectFilterTasks({tasks:[task],today});const child=entries[1].task;
  expect(child).toMatchObject({_jobuParent:'parent',_jobuChildId:'s',projectId:'work'});expect(child.date).toBeUndefined();expect(child.priority).toBeUndefined();
  expect(compileJobuFilter('no date & p4 & no label & subtask',options).test(child)).toBe(true);
 });
});
