import React,{useEffect,useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useDayPlannerCtx} from '../../context/DayPlannerContext.jsx';
import {useFeaturesCtx} from '../../context/FeaturesContext.jsx';
import {jobuValues,materializeJobu} from '../../jobu/data.js';
import {yearDays,completionCounts,heatLevel,DEFAULT_DAY_TEMPLATES,validateDayTemplate,dayRange,dayKey} from '../../jobu/year.js';
const EMPTY = Object.freeze([]);
const freshTemplate=()=>({id:crypto.randomUUID(),name:'',kind:'custom',color:'#3b82f6',blocks:[]});
export default function YearView(){
 const ctx=useDayPlannerCtx(),f=useFeaturesCtx(),{t}=useTranslation();const L=(k,o)=>t(`jobu.${k}`,o);
 const [year,setYear]=useState(ctx.selectedDate?.getFullYear()||new Date().getFullYear()),[selected,setSelected]=useState(dayKey(ctx.selectedDate||new Date())),[end,setEnd]=useState(''),[chosen,setChosen]=useState('business'),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 useEffect(()=>{
  const contextYear=ctx.selectedDate?.getFullYear();
  if (!contextYear||contextYear===year) return;
  setYear(contextYear);
  setSelected(dayKey(ctx.selectedDate));
  setEnd('');
  setNote('');
 },[ctx.selectedDate,year]);
 const records=f.jobuRecords||EMPTY,templates=useMemo(()=>{const map=new Map(DEFAULT_DAY_TEMPLATES.map(x=>[x.id,x]));for(const r of jobuValues(records,'dayTemplate'))map.set(r.value.id,r.value);return [...map.values()];},[records]);
 const counts=useMemo(()=>completionCounts({...ctx,joboRecords:f.joboRecords}),[ctx,f.joboRecords]);
 const heads=useMemo(()=>materializeJobu(records),[records]),days=yearDays(year);const offset=days[0].weekday;const annotations=jobuValues(records,'day');
 const selectedRow=heads.get(`day:${selected}`);const assigned=selectedRow&&!selectedRow.deleted?selectedRow.value:null;
 async function act(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(`${L('saveError')}: ${e.message}`);}finally{setBusy(false);}}
 async function apply(){const tpl=templates.find(x=>x.id===chosen);if(!tpl)return;await act(()=>f.jobuData.transact((rows,map)=>dayRange(selected,end||selected).map(date=>{const old=map.get(`day:${date}`);return {entityId:`day:${date}`,kind:'day',value:{date,template:structuredClone(tpl),note:date===selected?note:(old?.value?.note||'')}};})));}
 async function generate(){if(!assigned)return;await act(async()=>{for(const block of assigned.template.blocks){const id=`jobu-template:${selected}:${assigned.template.id}:${block.id}`;if([...ctx.tasks,...ctx.unscheduledTasks].some(x=>String(x.id)===id))continue;ctx.createTimelineTask({id,title:block.title,date:selected,startTime:block.startTime,duration:block.duration});}});}
 const changeYear=delta=>{
  const nextYear=Math.max(1900,Math.min(2200,year+delta));
  const nextDate=new Date(`${selected}T12:00:00`);
  nextDate.setFullYear(nextYear);
  nextDate.setHours(12,0,0,0);
  const nextSelected=dayKey(nextDate);
  setYear(nextYear);
  setSelected(nextSelected);
  setEnd('');
  setNote('');
  ctx.setSelectedDate?.(nextDate);
 };
 return <section className="jobu-year" aria-label={L('year')}>
 <div className="jobu-page-heading"><div><h1>{L('year')}</h1><p>{L('heatHint')}</p></div><div className="jobu-actions"><button onClick={()=>changeYear(-1)} aria-label={L('previous')}>‹</button><strong>{year}</strong><button onClick={()=>changeYear(1)} aria-label={L('next')}>›</button><button onClick={()=>setDraft(freshTemplate())}>{L('newTemplate')}</button></div></div>
 {!f.jobuLoaded&&<p role="status">{L('loading')}</p>}{(error||f.jobuError)&&<p role="alert" className="jobu-error">{error||f.jobuError}</p>}
 <div className="jobu-year-scroll"><div className="jobu-year-months">{Array.from({length:12},(_,m)=><span key={m}>{new Intl.DateTimeFormat(undefined,{month:'short'}).format(new Date(year,m,1))}</span>)}</div>
 <div className="jobu-heatmap" role="group" aria-label={L('heatmap')}>
 {Array.from({length:offset},(_,i)=><span key={`blank${i}`} aria-hidden="true"/>)}
 {days.map(d=>{const a=annotations.find(x=>x.value.date===d.date)?.value;const due=(f.goals||[]).some(g=>g.targetDate===d.date);return <button key={d.date} data-date={d.date} data-level={heatLevel(counts[d.date]||0)} className={`jobu-day level-${heatLevel(counts[d.date]||0)} ${selected===d.date?'selected':''}`} aria-pressed={selected===d.date} aria-label={`${d.date}: ${counts[d.date]||0} ${L('completed')}${a?` · ${a.template.name}`:''}`} title={`${d.date}: ${counts[d.date]||0} ${L('completed')}${a?` · ${a.template.name}`:''}`} onClick={()=>{setSelected(d.date);setEnd('');setNote(a?.note||'');}}>{a&&<i style={{backgroundColor:a.template.color}}/>}{due&&<b title={L('goalDeadline')}>◆</b>}</button>;})}
 </div></div><div className="jobu-legend"><span>{L('less')}</span>{[0,1,2,3,4].map(n=><i key={n} className={`jobu-day level-${n}`}/>)}<span>{L('more')}</span><span>{L('templateLegend')}</span></div>
 <div className="jobu-year-details"><div><h2>{selected}</h2><p>{counts[selected]||0} {L('completed')}</p><p>{assigned?.template.name||L('noTemplate')}</p>{assigned?.note&&<p>{assigned.note}</p>}<button onClick={()=>{ctx.setSelectedDate(new Date(`${selected}T12:00:00`));f.setJoboEnabled?.(true);ctx.setViewMode?.('jobo');}}>{L('openDay')}</button>
 {(f.goals||[]).filter(g=>g.targetDate===selected).map(g=><p key={g.id}>◆ {g.title}</p>)}
 {assigned&&<div className="jobu-actions"><button disabled={busy||!f.jobuWritable} onClick={()=>act(()=>f.jobuData.save(`day:${selected}`,'day',null,{expectedHead:selectedRow.id,deleted:true}))}>{L('removeTemplate')}</button>{assigned.template.blocks.length>0&&<button disabled={busy||!ctx.dataLoaded||!f.jobuWritable} onClick={generate}>{L('generateTasks')}</button>}</div>}</div>
 <div><h2>{L('applyTemplate')}</h2><label>{L('template')}<select value={chosen} onChange={e=>setChosen(e.target.value)}>{templates.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>{L('throughDate')}<input type="date" value={end} min={selected} onChange={e=>setEnd(e.target.value)}/></label><label>{L('note')}<input value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label><button disabled={busy||!f.jobuWritable} onClick={apply}>{L('apply')}</button><small>{L('templateHint')}</small></div></div>
 {draft&&<div className="jobu-dialog-backdrop" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')setDraft(null);}}><form role="dialog" aria-modal="true" aria-label={L('newTemplate')} className="jobu-dialog" onSubmit={e=>{e.preventDefault();act(async()=>{validateDayTemplate(draft);await f.jobuData.save(`template:${draft.id}`,'dayTemplate',draft);setChosen(draft.id);setDraft(null);});}}><h2>{L('newTemplate')}</h2><label>{L('name')}<input autoFocus required maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>{L('color')}<input type="color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></label><h3>{L('scheduleBlocks')}</h3>{draft.blocks.map((b,i)=><div className="jobu-block-row" key={b.id}><input required aria-label={L('title')} value={b.title} onChange={e=>setDraft({...draft,blocks:draft.blocks.map((x,j)=>j===i?{...x,title:e.target.value}:x)})}/><input type="time" required value={b.startTime} aria-label={L('time')} onChange={e=>setDraft({...draft,blocks:draft.blocks.map((x,j)=>j===i?{...x,startTime:e.target.value}:x)})}/><input type="number" min="5" max="1440" value={b.duration} aria-label={L('minutes')} onChange={e=>setDraft({...draft,blocks:draft.blocks.map((x,j)=>j===i?{...x,duration:Number(e.target.value)}:x)})}/><button type="button" aria-label={L('remove')} onClick={()=>setDraft({...draft,blocks:draft.blocks.filter((_,j)=>j!==i)})}>×</button></div>)}<button type="button" onClick={()=>setDraft({...draft,blocks:[...draft.blocks,{id:crypto.randomUUID(),title:'',startTime:'09:00',duration:60}]})}>{L('addBlock')}</button><div className="jobu-actions"><button type="button" onClick={()=>setDraft(null)}>{L('cancel')}</button><button disabled={busy||!f.jobuWritable}>{L('save')}</button></div></form></div>}
 </section>;
}
