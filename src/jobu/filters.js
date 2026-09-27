import {dayKey} from './year.js';
import {taskLabels} from './quickAdd.js';
// Recursive descent; never eval user expressions. Invalid syntax fails closed.
export function compileJobuFilter(query,{projects=[],today=dayKey(new Date())}={}){
 if(typeof query!=='string'||!query.trim()||query.length>2000)return {test:()=>false,error:'filter'};
 const tokens=[];let start=0,quoted=false;
 for(let i=0;i<query.length;i++){if(query[i]==='"')quoted=!quoted;if(!quoted&&'&|!()'.includes(query[i])){if(query.slice(start,i).trim())tokens.push(query.slice(start,i).trim());tokens.push(query[i]);start=i+1;}}
 if(quoted)return {test:()=>false,error:'filter'};
 if(query.slice(start).trim())tokens.push(query.slice(start).trim());
 let at=0,depth=0;
 const word=raw=>{
  const q=raw.toLocaleLowerCase();
  if(q==='all')return ()=>true;
  if(q==='completed')return t=>!!t.completed;
  if(q==='no date')return t=>!t.date;
  if(q==='today')return t=>t.date===today&&!t.completed;
  if(q==='tomorrow'){const d=new Date(`${today}T12:00:00`);d.setDate(d.getDate()+1);return t=>t.date===dayKey(d)&&!t.completed;}
  if(q==='overdue')return t=>!!t.date&&t.date<today&&!t.completed;
  if(/^p[1-4]$/.test(q))return t=>(t.priority||0)===4-Number(q[1]);
  if(/^[@%]/.test(q)){const name=raw.slice(1).replace(/^"|"$/g,'').toLocaleLowerCase();if(!name)throw Error();return t=>taskLabels(t).some(s=>s.toLocaleLowerCase()===name);}
  if(q.startsWith('#')){const name=raw.slice(1).replace(/^"|"$/g,'').toLocaleLowerCase();const ids=projects.filter(p=>String(p.title).toLocaleLowerCase()===name).map(p=>p.id);if(!ids.length)throw Error('project');return t=>ids.includes(t.projectId);}
  if(q.startsWith('search:')){const term=q.slice(7).trim().replace(/^"|"$/g,'');if(!term)throw Error();return t=>String(t.title||'').toLocaleLowerCase().includes(term);}
  throw Error('filter');
 };
 const factor=()=>{if(++depth>32)throw Error();let fn;const token=tokens[at++];if(token==='!'){const child=factor();fn=t=>!child(t);}else if(token==='('){fn=or();if(tokens[at++]!==')')throw Error();}else if(!token||'&|)'.includes(token))throw Error();else fn=word(token);depth--;return fn;};
 const and=()=>{let fn=factor();while(tokens[at]==='&'){at++;const left=fn,right=factor();fn=t=>left(t)&&right(t);}return fn;};
 const or=()=>{let fn=and();while(tokens[at]==='|'){at++;const left=fn,right=and();fn=t=>left(t)||right(t);}return fn;};
 try{const test=or();if(at!==tokens.length)throw Error();return {test,error:null};}catch{return {test:()=>false,error:'filter'};}
}
