import React, {useEffect,useMemo,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDayPlannerCtx} from '../../context/DayPlannerContext.jsx';
import {useFeaturesCtx} from '../../context/FeaturesContext.jsx';
import {parseJobuInput,spanKey,makeJobuTask,taskDisplayTitle} from '../../jobu/quickAdd.js';
import {compileJobuFilter} from '../../jobu/filters.js';
import { taskDate } from '../../jobu/filterDates.js';
import FilterSidebar from './FilterSidebar.jsx';
import FilterEditor, { filterError } from './FilterEditor.jsx';
import { TaskLabelChips, TaskLabelPicker } from './TaskLabels.jsx';
import './organizer.css';
import {dayKey} from '../../jobu/year.js';
import TaskPriorityCheckbox from '../TaskPriorityCheckbox.jsx';
import {writePomodoroTaskDrag} from '../../jobo/pomodoro.js';
import { ArrowLeft, Filter, Tag } from 'lucide-react';

export function FilterList({compact=false,onSelect}) {
 return <FilterSidebar compact={compact} onSelect={onSelect} />;
}
function QuickAdd(){
 const ctx=useDayPlannerCtx(),f=useFeaturesCtx(),{t}=useTranslation();
 const [text,setText]=useState(''),[dismissed,setDismissed]=useState([]),[natural,setNatural]=useState(true),[error,setError]=useState(''),[details,setDetails]=useState(false),[notes,setNotes]=useState('');
 const id=useRef(null),busy=useRef(false),input=useRef(null),draft=useRef('');
 draft.current=text+notes;
 const registerGuard=f.registerJobuNavigationGuard;
 useEffect(()=>registerGuard?.(()=>!draft.current.trim()||window.confirm(t('organizer.discard'))),[registerGuard,t]);
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
export default function TasksView({onClose,headerActions,request,filtersPage=false}) {
 const ctx=useDayPlannerCtx(),f=useFeaturesCtx(),o=f.jobuOrganizer,{t}=useTranslation();
 const [query,setQuery]=useState(request?.query||f.jobuFilter||'overdue, today');
 const [title,setTitle]=useState(request?.title||t(filtersPage?'organizer.filters':'jobu.tasks'));
 const [editor,setEditor]=useState(false),[labelTask,setLabelTask]=useState(null);
 const filter=useMemo(()=>compileJobuFilter(query,o.options),[query,o.options]);
 const select=(next,name)=>{setQuery(next);setTitle(name||t('organizer.results'));};
 const sorted=[...o.entries].sort((a,b)=>(b.task.priority||0)-(a.task.priority||0)||String(taskDate(a.task)?.day||'9999').localeCompare(taskDate(b.task)?.day||'9999')||String(a.task.id).localeCompare(String(b.task.id)));
 const count=sorted.filter(({task})=>filter.test(task)).length;
 const results=filter.sections.map(section=>({...section,entries:sorted.filter(({task})=>section.test(task))}));
 const taskRow=({task,inbox},section)=>{
  const due=taskDate(task),child=!!task._jobuParent,canEdit=!!ctx.dataLoaded;
  return <article className={`jobu-task p${4-(task.priority||0)} ${task.completed?'done':''}`} key={`${section}:${task.id}`} data-pomodoro-task={task.id} draggable={!child} onDragStart={event=>{if(child||event.target.closest('input,textarea,button')){event.preventDefault();return;}writePomodoroTaskDrag(event,task);event.dataTransfer.effectAllowed='copyMove';}}>
    <TaskPriorityCheckbox priority={task.priority} checked={!!task.completed} darkMode={ctx.darkMode} disabled={!canEdit} onClick={()=>{if(canEdit){if(child)ctx.toggleSubtask(task._jobuParent,task._jobuChildId,inbox);else ctx.toggleComplete(task.id,inbox);}}} ariaLabel={`${t('jobu.complete')}: ${taskDisplayTitle(task)}`}/>
    <div className="min-w-0 flex-1">
     {ctx.editingTaskId===task.id&&!child?<input autoFocus aria-label={t('jobu.title')} value={ctx.editingTaskText} onChange={e=>ctx.setEditingTaskText(e.target.value)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')e.target.blur();if(e.key==='Escape'){e.target.dataset.cancel='true';ctx.cancelEditingTask();}}} onBlur={e=>{if(e.target.dataset.cancel!=='true'&&ctx.editingTaskId===task.id)ctx.saveTaskTitle(inbox);}}/>:<button type="button" className="jobu-task-title" disabled={!canEdit||child} onClick={()=>ctx.startEditingTask(task,inbox)}>{taskDisplayTitle(task)}</button>}
     <div className="jobu-task-meta"><span className="jobu-priority">p{4-(task.priority||0)}</span>
      {due&&<span className="ju-source-date" title={t(task.todoist?'organizer.sourceDate':'organizer.nativeDate')}>{due.day} {due.time||''}</span>}
      {task.projectId&&<span>#{f.projects?.find(p=>p.id===task.projectId)?.title||t('jobu.missingProject')}</span>}
      {!task.projectId&&task.todoist?.project&&<span>#{task.todoist.project}</span>}
      {child&&<span title={task._jobuParentTitle}>{t('organizer.subtaskOf')}: {taskDisplayTitle({title:task._jobuParentTitle})}</span>}
      {task.recurringTemplateId!=null&&<span>{t('organizer.nextOccurrence')}</span>}
      <TaskLabelChips task={task} onSelect={select}/>
      <button type="button" aria-label={`${t('organizer.taskLabels')}: ${taskDisplayTitle(task)}`} disabled={!o.loaded||!o.writable} onClick={()=>setLabelTask(task)}><Tag size={12}/></button>
     </div>{task.notes&&<p className="jobu-task-note">{task.notes}</p>}
    </div>
   </article>;
 };
 return <section className="jobu-tasks">
   <div className="jobu-page-heading"><div>{onClose&&<button type="button" className="jobu-task-back" onClick={onClose}><ArrowLeft size={15}/>{t('common.back')}</button>}<h1>{title}</h1><p>{t('organizer.resultsHint')}</p></div>{headerActions}</div>
   <QuickAdd/>
   <div className="ju-organizer-tools"><Filter size={16}/><input aria-label={t('organizer.query')} value={query} maxLength={2000} spellCheck={false} onChange={e=>{setQuery(e.target.value);setTitle(t('organizer.results'));}}/><button type="button" disabled={!o.writable||!o.loaded} onClick={()=>setEditor(true)}>{t('organizer.saveCopy')}</button><button type="button" onClick={()=>f.setJobuPage('labels')}><Tag size={15}/>{t('organizer.labels')}</button></div>
   <p className="ju-muted">{t('organizer.scopeHint')}</p>
   {!!o.labels.conflicts?.length&&<p className="jobu-warning" role="alert">{t('organizer.aliasConflict')}</p>}
   <div className="ju-task-filter-layout"><div className="jobu-task-list">
    {!o.loaded ? <p>{t('jobu.loading')}</p> : filter.error ? <p role="alert" className="jobu-error">{filterError(t,filter)}</p> : <><p className="ju-muted" aria-live="polite">{t('organizer.preview',{count,groups:results.length})}</p>{results.map((section,i)=><section key={`${i}:${section.query}`} className="ju-filter-section" aria-label={section.query}>
      <h2><span>{section.query}</span><b>{section.entries.length}</b></h2>{section.entries.map(entry=>taskRow(entry,i))}{!section.entries.length&&<p className="jobu-empty">{t('jobu.noTasks')}</p>}
    </section>)}</>}
   </div><FilterSidebar onSelect={select}/></div>
   {editor&&<FilterEditor query={query} onClose={()=>setEditor(false)}/>}
   {labelTask&&<TaskLabelPicker task={labelTask} onClose={()=>setLabelTask(null)}/>}
 </section>;
}
