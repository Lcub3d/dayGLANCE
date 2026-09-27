import { parseQuickAdd, stripSpans } from '../utils/quickAddParser.js';
import { dayKey, validDay } from './year.js';
const pad=n=>String(n).padStart(2,'0');
export const spanKey=s=>`${s.type}:${s.start}:${s.text}`;
// Todoist-inspired native input. Project/label/priority tokens are explicit;
// natural-language parsing is deterministic and each accepted span is reversible.
export function parseJobuInput(text,{now=new Date(),projects=[],dismissed=[],natural=true}={}){
 if(typeof text!=='string'||text.length>10000)throw new Error('title');
 const spans=[],warnings=[],chars=text.split('');
 const mask=(a,b)=>{for(let i=a;i<b;i++)chars[i]=' ';};
 const add=(type,start,end,value)=>{const s={type,start,end,value,text:text.slice(start,end)};if(!dismissed.includes(spanKey(s)))spans.push(s);mask(start,end);};
 // Only whitespace-delimited sigils: email addresses and C# stay literal.
 const re=/(?:^|\s)([#@%])(?:"([^"\n]+)"|([^\s#@%]+))/gu;
 for(const m of text.matchAll(re)){
  const start=m.index+(m[0].startsWith(' ')?1: /^\s/.test(m[0])?1:0),name=m[2]||m[3];
  if(m[1]==='#'){
   const found=projects.filter(p=>!p.deleted&&!p.archived&&String(p.title).toLocaleLowerCase()===name.toLocaleLowerCase());
   if(found.length===1)add('project',start,m.index+m[0].length,{id:found[0].id,title:found[0].title});
   else {mask(start,m.index+m[0].length);warnings.push({code:found.length?'ambiguousProject':'unknownProject',text:name});}
  }else if(/^[\p{L}\p{N}_-]+$/u.test(name))add('label',start,m.index+m[0].length,name);
  else{mask(start,m.index+m[0].length);warnings.push({code:'label',text:name});}
 }
 for(const m of chars.join('').matchAll(/\bp([1-4])\b/gi))add('priority',m.index,m.index+m[0].length,4-Number(m[1]));
 if(natural){
  for(const m of chars.join('').matchAll(/大后天|今天|明天|后天|\d{1,3}天后|下周[一二三四五六日天]|本周[一二三四五六日天]|\d{4}-\d{2}-\d{2}/gu)){
   let date;const d=new Date(now);d.setHours(12,0,0,0);
   if(/^\d{4}-/.test(m[0]))date=m[0];
   else if(m[0].includes('周')){const weekday='日一二三四五六'.indexOf(m[0].at(-1)==='天'?'日':m[0].at(-1));d.setDate(d.getDate()-((d.getDay()+6)%7)+(m[0][0]==='下'?7:0)+(weekday+6)%7);date=dayKey(d);}
   else{const offset=({今天:0,明天:1,后天:2,大后天:3})[m[0]]??Number.parseInt(m[0],10);d.setDate(d.getDate()+offset);date=dayKey(d);}
   if(validDay(date))add('date',m.index,m.index+m[0].length,date);else warnings.push({code:'date',text:m[0]});
  }
  for(const m of chars.join('').matchAll(/(?:(上午|下午|晚上|中午|凌晨)\s*)?(\d{1,2})(?:点|时)(?:(半)|(\d{1,2})分?)?/gu)){
   let h=Number(m[2]),min=m[3]?30:Number(m[4]||0);if(['下午','晚上','中午'].includes(m[1])&&h<12)h+=12;if(['上午','凌晨'].includes(m[1])&&h===12)h=0;
   if(h<=23&&min<=59)add('time',m.index,m.index+m[0].length,`${pad(h)}:${pad(min)}`);
  }
  for(const m of chars.join('').matchAll(/(?:用时|持续)?(\d+(?:\.\d+)?)\s*(小时|分钟)/gu)){
   const n=Number(m[1])*(m[2]==='小时'?60:1);if(n>0&&n<=1440)add('duration',m.index,m.index+m[0].length,n);
  }
  const english=parseQuickAdd(chars.join(''),{now}).spans;
  for(const s of english){
   // Recurrence is intentionally not silently downgraded to an ordinary task.
   if(s.type==='recurrence'){warnings.push({code:'recurrence',text:text.slice(s.start,s.end)});continue;}
   if(s.type==='tag')continue;
   add(s.type,s.start,s.end,s.value);
  }
 }
 // One date/time/priority/project, right-most wins. Earlier expressions remain
 // literal rather than being silently stripped without affecting the result.
 const singles=new Set(['date','time','duration','priority','project','timerange']);
 const accepted=spans.filter(s=>!singles.has(s.type)||!spans.some(x=>x.type===s.type&&x.start>s.start)).sort((a,b)=>a.start-b.start);
 const last=type=>accepted.filter(s=>s.type===type).at(-1)?.value;
 const range=last('timerange');
 const labels=[...new Set(accepted.filter(s=>s.type==='label').map(s=>s.value))];
 const date=last('date')||null,time=range?.startTime||last('time')||null;
 return {spans:accepted,title:stripSpans(text,accepted,{includeTags:true}),date,startTime:time,
  duration:range?.duration||last('duration')||30,priority:last('priority')??0,
  project:last('project')||null,labels,warnings};
}
export function makeJobuTask(parsed,{id,now=new Date().toISOString()}={}){
 if(!id||!parsed.title.trim())throw new Error('title');
 if(parsed.date&&!validDay(parsed.date))throw new Error('date');
 if(parsed.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.startTime))throw new Error('time');
 if(!Number.isFinite(parsed.duration)||parsed.duration<=0||parsed.duration>1440)throw new Error('duration');
 // A time without a date is explicit in the preview as today's schedule.
 const date=parsed.date||(parsed.startTime?dayKey(new Date(now)):null);
 return {id,title:[parsed.title.trim(),...parsed.labels.map(label=>`#${label}`)].join(' '),
  priority:parsed.priority,projectId:parsed.project?.id||undefined,completed:false,notes:'',subtasks:[],
  date:date||undefined,startTime:parsed.startTime||undefined,isAllDay:!!date&&!parsed.startTime,
  duration:parsed.duration,color:'bg-blue-500',lastModified:now};
}
export function taskLabels(task){return [...String(task.title||'').matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(m=>m[1]);}
export function taskDisplayTitle(task){return String(task.title||'').replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu,'').trim();}
