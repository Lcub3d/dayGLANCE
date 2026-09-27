import {describe,it,expect} from 'vitest';
import {parseJobuInput,spanKey,makeJobuTask,taskLabels} from './quickAdd.js';
import {compileJobuFilter} from './filters.js';
import {yearDays,dayRange,completionCounts,heatLevel,validDay,validateDayTemplate} from './year.js';
const now=new Date(2026,8,27,12),projects=[{id:'work',title:'工作'},{id:'r',title:'Research Team'}];
describe('Jobu Todoist-style input',()=>{
 it('parses Chinese due time, labels, native project id and p1 without text loss',()=>{const input='编写材料 明天下午3点 45分钟 #工作 @写作 p1';const p=parseJobuInput(input,{now,projects});expect(p).toMatchObject({title:'编写材料',date:'2026-09-28',startTime:'15:00',duration:45,priority:3,project:{id:'work'},labels:['写作']});const task=makeJobuTask(p,{id:'task1',now:now.toISOString()});expect(task.title).toBe('编写材料 #写作');expect(task.projectId).toBe('work');expect(task.priority).toBe(3);expect(taskLabels(task)).toEqual(['写作']);});
 it.each([['today 9am','2026-09-27','09:00'],['tomorrow 3pm','2026-09-28','15:00'],['下周一上午9点','2026-09-28','09:00'],['后天晚上8点半','2026-09-29','20:30'],['大后天12点','2026-09-30','12:00'],['2天后14点15分','2026-09-29','14:15']])('parses %s',(phrase,date,startTime)=>{expect(parseJobuInput(`Work ${phrase}`,{now})).toMatchObject({date,startTime,title:'Work'});});
 it.each([1,2,3,4])('maps p%i to the existing 0–3 native priority',n=>expect(parseJobuInput(`Task p${n}`,{now}).priority).toBe(4-n));
 it('accepts quoted project names and both @ / % label notation',()=>{expect(parseJobuInput('Read #"Research Team" @deep %writing',{now,projects})).toMatchObject({title:'Read',project:{id:'r'},labels:['deep','writing']});});
 it('does not reinterpret email addresses, C#, unknown projects or invalid dates',()=>{const p=parseJobuInput('email a@b.com C# #missing 2026-02-30',{now,projects});expect(p.title).toContain('a@b.com C# #missing 2026-02-30');expect(p.date).toBeNull();expect(p.warnings.length).toBeGreaterThan(0);});
 it('leaves dismissed spans literal and disabling dates keeps prose intact',()=>{const text='Task tomorrow 3pm p2',p=parseJobuInput(text,{now});const date=p.spans.find(s=>s.type==='date');expect(parseJobuInput(text,{now,dismissed:[spanKey(date)]})).toMatchObject({date:null,title:'Task tomorrow'});expect(parseJobuInput(text,{now,natural:false})).toMatchObject({date:null,startTime:null,title:'Task tomorrow 3pm',priority:2});});
 it('does not silently turn recurring text into a one-off',()=>{const p=parseJobuInput('Run every monday 9am',{now});expect(p.title).toContain('every monday');expect(p.warnings.some(w=>w.code==='recurrence')).toBe(true);});
 it('creates undated Inbox or all-day task rather than inventing an execution interval',()=>{const inbox=makeJobuTask(parseJobuInput('Read p3'),{id:'i'});expect(inbox.date).toBeUndefined();const allDay=makeJobuTask(parseJobuInput('Read tomorrow',{now}),{id:'d'});expect(allDay.isAllDay).toBe(true);expect(allDay.startTime).toBeUndefined();});
});
describe('Safe saved GLANCE filters',()=>{
 const task={title:'Write #deep',priority:3,date:'2026-09-27',projectId:'work',completed:false};const options={projects,today:'2026-09-27'};
 it.each(['today & p1','(@deep | @other) & !completed','#工作 & p1','%deep','search:Write','all'])('matches %s',q=>expect(compileJobuFilter(q,options).test(task)).toBe(true));
 it.each(['','(','today &','eval(alert(1))','p9','#missing'])('fails closed for %s',q=>{const f=compileJobuFilter(q,options);expect(f.error).toBeTruthy();expect(f.test(task)).toBe(false);});
 it('distinguishes completed, undated and overdue',()=>{expect(compileJobuFilter('overdue',options).test({...task,date:'2026-09-26'})).toBe(true);expect(compileJobuFilter('overdue',options).test({...task,date:'2026-09-26',completed:true})).toBe(false);expect(compileJobuFilter('no date',options).test({...task,date:undefined})).toBe(true);});
});
describe('Year heatmap and day templates',()=>{
 it.each([[2024,366],[2026,365],[2000,366],[2100,365]])('builds %i without DST/leap holes',(year,count)=>{const days=yearDays(year);expect(days).toHaveLength(count);expect(new Set(days.map(d=>d.date)).size).toBe(count);expect(days.at(-1).date).toBe(`${year}-12-31`);});
 it('validates date ranges and caps bulk edits to one year',()=>{expect(dayRange('2024-02-28','2024-03-01')).toEqual(['2024-02-28','2024-02-29','2024-03-01']);expect(validDay('2026-02-29')).toBe(false);expect(()=>dayRange('2026-12-31','2026-01-01')).toThrow();expect(()=>dayRange('2025-01-01','2027-01-01')).toThrow();});
 it('counts unique tasks, not number of Do segments or duplicate sources',()=>{const tasks=[{id:'t',completed:true,completedAt:'2026-09-27T09:00:00+08:00'}];const doRow={taskId:'t',source:'completion',date:'2026-09-27',progress:'completed'};expect(completionCounts({tasks,joboRecords:[{...doRow,id:'a'},{...doRow,id:'b'},{...doRow,taskId:null,id:'manual',source:'manual'}]})).toEqual({'2026-09-27':1});});
 it('does not count reopened completions or deleted evidence',()=>{expect(completionCounts({tasks:[{id:'t',completed:false}],joboRecords:[{taskId:'t',source:'completion',date:'2026-09-27',progress:'partial'},{taskId:'b',source:'completion',date:'2026-09-27',progress:'completed',deleted:true}]})).toEqual({});});
 it('deduplicates recurring occurrence sources',()=>{const r={id:'r',completedDates:['2026-09-26'],completedDatesTimestamps:{'2026-09-26':'2026-09-27T00:10:00+08:00'}};expect(completionCounts({recurringTasks:[r],joboRecords:[{taskId:'r',source:'completion',date:'2026-09-27',progress:'completed',planSnapshot:{date:'2026-09-26'}}]})).toEqual({'2026-09-27':1});});
 it('uses bounded, stable heat levels and validates custom templates',()=>{expect([0,1,2,3,5,6,9,10,500].map(heatLevel)).toEqual([0,1,1,2,2,3,3,4,4]);const t={id:'trip',name:'Trip',color:'#123456',blocks:[{id:'meeting',title:'Meeting',startTime:'09:00',duration:60}]};expect(validateDayTemplate(t)).toBe(t);expect(()=>validateDayTemplate({...t,blocks:[{...t.blocks[0],startTime:'25:00'}]})).toThrow();});
});

describe('Year source identity after interval correction',()=>{
 it('counts a recurring untimed completion once on its source day',()=>{const r={id:'r',completedDates:['2026-09-26'],completedDatesTimestamps:{'2026-09-26':'2026-09-27T00:10:00+08:00'}};expect(completionCounts({recurringTasks:[r],joboRecords:[{id:'do:r:2026-09-26:2026-09-27T00:10:00+08:00',taskId:'r',source:'completion',date:'2026-09-28',createdAt:'2026-09-27T00:10:00+08:00',progress:'completed',planSnapshot:null}]})).toEqual({'2026-09-27':1});});
});
