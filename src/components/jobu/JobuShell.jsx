import React,{lazy,Suspense,useCallback,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FeaturesContext,useFeaturesCtx} from '../../context/FeaturesContext.jsx';
import {useDayPlannerCtx} from '../../context/DayPlannerContext.jsx';
import JoboView from '../JoboView.jsx';
import GlanceSidebar from '../GlanceSidebar.jsx';
import {FilterList} from './TasksView.jsx';
import {dayKey} from '../../jobu/year.js';
import './jobu.css';
const TasksView=lazy(()=>import('./TasksView.jsx'));
const YearView=lazy(()=>import('./YearView.jsx'));
const LifePlanner=lazy(()=>import('../lifeplanner/LifePlanner.jsx'));
export default function JobuShell({children}){
 const f=useFeaturesCtx(),ctx=useDayPlannerCtx(),{t}=useTranslation();
 const [page,setPage]=useState('jobo'),[filter,setFilter]=useState('!completed'),[error,setError]=useState(''),[history,setHistory]=useState(false),[entity,setEntity]=useState('');
 const file=useRef(null), navigationGuard=useRef(null);
 const registerJobuNavigationGuard=useCallback(guard=>{navigationGuard.current=guard;return()=>{if(navigationGuard.current===guard)navigationGuard.current=null;};},[]);
 function select(next){if(next!==page&&navigationGuard.current&&!navigationGuard.current())return;if(next==='jobo')f.setJoboEnabled(true);setPage(next);}
 const personal={...f,registerJobuNavigationGuard,setJobuPage:select,jobuFilter:filter,setShowLifePlanner:show=>select(show?'life':'jobo')};
 const exportData=()=>{try{const blob=new Blob([f.jobuData.export()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`jobu-personal-${dayKey(new Date())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.message);}};
 const importData=async e=>{const input=e.target,uploaded=input.files?.[0];if(!uploaded)return;try{if(uploaded.size>50000000)throw Error('file too large');const data=JSON.parse(await uploaded.text());if(data.format!=='jobu-personal'||data.version!==1)throw Error('format');if(window.confirm(t('jobu.importConfirm')))await f.jobuData.restore(data.records);}catch(err){setError(err.message);}finally{input.value='';}};
 const entities=[...new Set((f.jobuRecords||[]).map(row=>row.entityId))];
 const revisions=(f.jobuRecords||[]).filter(row=>row.entityId===entity).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
 return <FeaturesContext.Provider value={personal}><div className={`jobu-shell ${ctx.darkMode?'jobu-dark':''}`} onKeyDown={e=>{if(e.target.closest('input,textarea,select,[contenteditable="true"]'))e.stopPropagation();}}>
 <nav className="jobu-nav" aria-label="Jobu"><strong className="jobu-brand">Jobu</strong>{[['jobo','jobo'],['tasks','tasks'],['life','life'],['year','year'],['calendar','calendar']].map(([key,label])=><button key={key} aria-current={page===key?'page':undefined} onClick={()=>select(key)}>{t(`jobu.${label}`)}</button>)}<div className="jobu-nav-spacer"/><button onClick={exportData} disabled={!f.jobuLoaded}>{t('jobu.backup')}</button><button onClick={()=>file.current?.click()}>{t('jobu.import')}</button><button onClick={()=>setHistory(true)}>{t('jobu.history')}</button><button aria-label={t('jobu.settings')} onClick={()=>ctx.setShowSettings?.(true)}>⚙</button><input ref={file} type="file" accept="application/json" hidden onChange={importData}/></nav>
 {(f.jobuError||error)&&<div className="jobu-global-error" role="alert">{t('jobu.saveError')}: {error||f.jobuError} <button onClick={()=>{setError('');f.jobuData.load();}}>{t('jobu.retry')}</button></div>}
 {f.multiUserEnabled&&<p className="jobu-global-error">{t('jobu.personalOnly')}</p>}
 <div className="jobu-content"><Suspense fallback={<p>{t('jobu.loading')}</p>}>
 {page==='calendar'?<div className="jobu-native">{children}</div>:page==='tasks'?<TasksView key={filter}/>:page==='year'?<YearView/>:page==='life'?<LifePlanner/>:<div className="jobu-workspace"><aside className="jobu-glance"><FilterList compact onSelect={q=>{setFilter(q);setPage('tasks');}}/><GlanceSidebar/></aside><main className="jobu-jobo"><div className="jobu-date-bar"><button aria-label={t('jobu.previous')} onClick={()=>{const d=new Date(ctx.selectedDate);d.setDate(d.getDate()-1);ctx.setSelectedDate(d);}}>‹</button><input type="date" aria-label={t('jobu.date')} value={dayKey(ctx.selectedDate)} onChange={e=>{if(e.target.value)ctx.setSelectedDate(new Date(`${e.target.value}T12:00:00`));}}/><button aria-label={t('jobu.next')} onClick={()=>{const d=new Date(ctx.selectedDate);d.setDate(d.getDate()+1);ctx.setSelectedDate(d);}}>›</button><button onClick={()=>ctx.setSelectedDate(new Date())}>{t('jobu.today')}</button>{!f.joboEnabled&&<button onClick={()=>f.setJoboEnabled(true)}>{t('jobu.enableRecording')}</button>}</div><JoboView/></main></div>}
 </Suspense></div>
 {history&&<div className="jobu-dialog-backdrop" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')setHistory(false);}}><div className="jobu-dialog" role="dialog" aria-modal="true" aria-label={t('jobu.history')}><h2>{t('jobu.history')}</h2><p>{t('jobu.historyHint')}</p><select aria-label={t('jobu.entity')} value={entity} onChange={e=>setEntity(e.target.value)}><option value="">{t('jobu.entity')}</option>{entities.map(id=><option key={id}>{id}</option>)}</select>{revisions.map(row=><details key={row.id}><summary>{row.updatedAt} {row.deleted?'×':''}</summary><pre>{JSON.stringify(row.value,null,2)}</pre><button disabled={!f.jobuWritable} onClick={async()=>{try{await f.jobuData.save(row.entityId,row.kind,row.value,{deleted:row.deleted});setHistory(false);}catch(e){setError(e.message);}}}>{t('jobu.restoreRevision')}</button></details>)}<button onClick={()=>setHistory(false)}>{t('jobu.close')}</button></div></div>}
 </div></FeaturesContext.Provider>;
}
