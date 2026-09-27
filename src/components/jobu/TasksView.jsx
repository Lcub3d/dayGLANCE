import React, {useMemo,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDayPlannerCtx} from '../../context/DayPlannerContext.jsx';
import {useFeaturesCtx} from '../../context/FeaturesContext.jsx';
import {parseJobuInput,spanKey,makeJobuTask,taskLabels,taskDisplayTitle} from '../../jobu/quickAdd.js';
import {compileJobuFilter} from '../../jobu/filters.js';
import {jobuValues} from '../../jobu/data.js';
import {dayKey} from '../../jobu/year.js';
import TaskPriorityCheckbox from '../TaskPriorityCheckbox.jsx';
import {writePomodoroTaskDrag} from '../../jobo/pomodoro.js';
import { ArrowLeft } from 'lucide-react';

export function FilterList({compact=false,onSelect}){
 const ctx=useDayPlannerCtx(),f=useFeaturesCtx(),{t}=useTranslation();
 const filters=jobuValues(f.jobuRecords||[],'filter'),tasks=[...(ctx.tasks||[]),...(ctx.unscheduledTasks||[])].filter(x=>!x.deleted&&!x.isExample&&(!f.isVisibleForUser || f.isVisibleForUser(x)));
 return <div className={`jobu-filter-list ${compact?'compact':''}`}><h3>{t('jobu.savedFilters')}</h3>{filters.map(row=>{const filter=compileJobuFilter(row.value.query,{projects:f.projects,today:dayKey(new Date())});return <button key={row.entityId} onClick={()=>onSelect(row.value.query)} title={row.value.query}><span>{row.value.name}</span><b>{filter.error?'!':tasks.filter(filter.test).length}</b></button>;})}{!filters.length&&<small>{t('jobu.noFilters')}</small>}</div>;
}
function QuickAdd(){
 const ctx=useDayPlannerCtx(),f=useFeaturesCtx(),{t}=useTranslation();
 const [text,setText]=useState(''),[dismissed,setDismissed]=useState([]),[natural,setNatural]=useState(true),[error,setError]=useState(''),[details,setDetails]=useState(false),[notes,setNotes]=useState('');
 const id=useRef(null),busy=useRef(false),input=useRef(null);
 const parsed=useMemo(()=>parseJobuInput(text,{projects:f.projects,dismissed,natural}),[text,f.projects,dismissed,natural]);
 const addToken=token=>{setText(s=>`${s.trim()} ${token} `);input.current?.focus();};
 function submit(e){e.preventDefault();if(busy.current)return;busy.current=true;setError('');try{
  if(parsed.warnings.some(w=>w.code==='recurrence'))throw Error(t('jobu.recurrenceHint'));
  if(parsed.warnings.some(w=>w.code==='unknownProject'||w.code==='ambiguousProject'))throw Error(t('jobu.projectHint'));
  id.current ||= `jobu-task:${crypto.randomUUID()}`;
  const task={...makeJobuTask(parsed,{id:id.current}),notes};
  ctx.pushUndo?.();
  const setter=task.date?ctx.setTasks:ctx.setUnscheduledTasks;
  setter(rows=>rows.some(row=>row.id===task.id)?rows:[...rows,task]);
  setText('');setDismissed([]);setNotes('');id.current=null;input.current?.focus();
 }catch(err){setError(err.message);}finally{busy.current=false;}}
 return <form className="jobu-quick-add" onSubmit={submit} onKeyDown={e=>e.stopPropagation()}>
 <input ref={input} aria-label={t('jobu.quickAdd')} placeholder={t('jobu.quickPlaceholder')} value={text} maxLength={10000} onChange={e=>{setText(e.target.value);id.current=null;}}/>
 <div className="jobu-input-preview" aria-live="polite">{parsed.spans.map(s=><button type="button" key={spanKey(s)} title={t('jobu.keepLiteral')} onClick={()=>setDismissed(d=>[...d,spanKey(s)])}>{s.type==='project'?`#${s.value.title}`:s.type==='label'?`@${s.value}`:s.type==='priority'?`p${4-s.value}`:typeof s.value==='object'?s.text:String(s.value)} ×</button>)}{parsed.startTime&&!parsed.date&&<span>{t('jobu.today')} {dayKey(new Date())}</span>}</div>
 <div className="jobu-actions"><select aria-label={t('jobu.project')} value="" onChange={e=>{if(e.target.value)addToken(`#"${e.target.value}"`);}}><option value=""># {t('jobu.project')}</option>{f.projects.filter(p=>!p.deleted&&!p.archived).map(p=><option key={p.id} value={p.title}>{p.title}</option>)}</select><select aria-label={t('jobu.priority')} value="" onChange={e=>{if(e.target.value)addToken(e.target.value);}}><option value="">⚑ {t('jobu.priority')}</option>{[1,2,3,4].map(n=><option key={n} value={`p${n}`}>p{n}</option>)}</select><button type="button" onClick={()=>addToken('@')}>@ {t('jobu.label')}</button><button type="button" onClick={()=>setDetails(!details)}>{t('jobu.details')}</button><label className="jobu-inline-check"><input type="checkbox" checked={natural} onChange={e=>setNatural(e.target.checked)}/>{t('jobu.parseDates')}</label><button className="jobu-primary" disabled={!parsed.title.trim()||!ctx.dataLoaded}>{t('jobu.addTask')}</button></div>
 {details&&<textarea aria-label={t('jobu.note')} placeholder={t('jobu.note')} value={notes} onChange={e=>setNotes(e.target.value)}/>}
 {parsed.warnings.length>0&&<p className="jobu-warning">{parsed.warnings.map(w=>`${t(`jobu.warning.${w.code}`)}: ${w.text}`).join(' · ')}</p>}{error&&<p role="alert" className="jobu-error">{error}</p>}
 </form>;
}
export default function TasksView({onClose,headerActions}){
 const ctx=useDayPlannerCtx(),f=useFeaturesCtx(),{t}=useTranslation();const [query,setQuery]=useState(f.jobuFilter||'!completed'),[name,setName]=useState(''),[error,setError]=useState('');
 const filter=compileJobuFilter(query,{projects:f.projects});
 const all=[...(ctx.tasks||[]).map(task=>({task,inbox:false})),...(ctx.unscheduledTasks||[]).map(task=>({task,inbox:true}))].filter(x=>!x.task.deleted&&!x.task.isExample&&(!f.isVisibleForUser || f.isVisibleForUser(x.task)));
 const visible=all.filter(x=>filter.test(x.task)).sort((a,b)=>(b.task.priority||0)-(a.task.priority||0)||String(a.task.date||'9999').localeCompare(b.task.date||'9999'));
 async function saveFilter(){try{if(filter.error||!name.trim())throw Error(t('jobu.invalidFilter'));const id=crypto.randomUUID();await f.jobuData.save(`filter:${id}`,'filter',{id,name:name.trim(),query});setName('');setError('');}catch(e){setError(e.message);}}
 return <section className="jobu-tasks"><div className="jobu-page-heading"><div>{onClose&&<button type="button" className="jobu-task-back" onClick={onClose}><ArrowLeft size={15}/>{t('common.back')}</button>}<h1>{t('jobu.tasks')}</h1><p>{t('jobu.quickHint')}</p></div>{headerActions}</div><QuickAdd/>
 <div className="jobu-task-tools"><input aria-label={t('jobu.filter')} value={query} onChange={e=>setQuery(e.target.value)}/><input aria-label={t('jobu.filterName')} placeholder={t('jobu.filterName')} value={name} maxLength={100} onChange={e=>setName(e.target.value)}/><button disabled={!f.jobuWritable} onClick={saveFilter}>{t('jobu.saveFilter')}</button></div>
 <small>{t('jobu.filterHint')}</small>{(error||filter.error)&&<p role="alert" className="jobu-error">{error||t('jobu.invalidFilter')}</p>}
 <div className="jobu-task-columns"><div className="jobu-task-list">{visible.map(({task,inbox})=><article className={`jobu-task p${4-(task.priority||0)} ${task.completed?'done':''}`} key={task.id} data-pomodoro-task={task.id} draggable onDragStart={event=>{if(event.target.closest('input,textarea')){event.preventDefault();return;}writePomodoroTaskDrag(event,task);event.dataTransfer.effectAllowed='copyMove';}}>
 <TaskPriorityCheckbox priority={task.priority} checked={!!task.completed} darkMode={ctx.darkMode} onClick={()=>ctx.toggleComplete(task.id,inbox)} ariaLabel={`${t('jobu.complete')}: ${taskDisplayTitle(task)}`}/><div>{ctx.editingTaskId===task.id?<input autoFocus aria-label={t('jobu.title')} value={ctx.editingTaskText} onChange={e=>ctx.setEditingTaskText(e.target.value)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')ctx.saveTaskTitle(task.id,inbox);if(e.key==='Escape')ctx.cancelEditingTask();}} onBlur={()=>ctx.saveTaskTitle(task.id,inbox)}/>:<button className="jobu-task-title" onClick={()=>ctx.startEditingTask(task,inbox)}>{taskDisplayTitle(task)}</button>}<div className="jobu-task-meta"><span className="jobu-priority">p{4-(task.priority||0)}</span>{task.date&&<button onClick={()=>{ctx.setSelectedDate(new Date(`${task.date}T12:00:00`));f.setJobuPage('jobo');}}>{task.date} {task.startTime||''}</button>}{task.projectId&&<span>#{f.projects.find(p=>p.id===task.projectId)?.title||t('jobu.missingProject')}</span>}{taskLabels(task).map(label=><button key={label} onClick={()=>setQuery(`@${label} & !completed`)}>@{label}</button>)}</div>{task.notes&&<p className="jobu-task-note">{task.notes}</p>}</div></article>)}{!visible.length&&<p className="jobu-empty">{t('jobu.noTasks')}</p>}</div><FilterList onSelect={setQuery}/></div></section>;
}
