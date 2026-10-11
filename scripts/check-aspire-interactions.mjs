// Mounted DOM interaction checks. These complement, but do not replace,
// browser layout, native IME, and live sync-service verification.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(cwd + '/package.json');
// Optional test-only dependency: npm install --no-save --package-lock=false jsdom
const { JSDOM } = require('jsdom');
const dom=new JSDOM('<!doctype html><html><body><button id="opener">Open</button><div id="root"></div></body></html>',{url:'http://localhost'});
for(const key of ['window','document','HTMLElement','HTMLTextAreaElement','Event','KeyboardEvent','MouseEvent']) globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react');const {act}=React;const {createRoot}=require('react-dom/client');const {Simulate}=require('react-dom/test-utils');
const {createServer}=await import(cwd+'/node_modules/vite/dist/node/index.js');
const server=await createServer({root:cwd,server:{middlewareMode:true},appType:'custom'});
const {default:AspireModal}=await server.ssrLoadModule('/src/components/AspireModal.jsx');
const {DayPlannerContext}=await server.ssrLoadModule('/src/context/DayPlannerContext.jsx');
const {FeaturesContext}=await server.ssrLoadModule('/src/context/FeaturesContext.jsx');
const {createAspireNotebook}=await server.ssrLoadModule('/src/aspire/notebook.js');
const i18n=require('i18next').createInstance();
const { I18nextProvider } = await import('react-i18next');
await i18n.init({lng:'en',resources:{en:{translation:JSON.parse(await readFile(cwd+'/public/locales/en/translation.json','utf8'))}},interpolation:{escapeValue:false}});
const at='2026-10-11T12:00:00.000Z';
const row=(id,text,order=1)=>({id,kind:'wish',text,order,createdAt:at,updatedAt:at,contentUpdatedAt:at,orderUpdatedAt:at,deleted:false});
let value=[row('a','First'),row('b','Second',2)],fail=false, seq=0,closeCount=0;
const store={read:async()=>({ok:true,value}),writable:async()=>true,update:async fn=>{if(fail)return {ok:false,error:'diskFull'};try{value=fn(value);return {ok:true,value};}catch(error){return{ok:false,error:error.message}}}};
const book=createAspireNotebook({store,id:()=>`new-${++seq}`});await book.load();
const root=createRoot(document.getElementById('root'));
function Harness(){const [state,setState]=React.useState(book.get());React.useEffect(()=>book.subscribe(setState),[]);return React.createElement(I18nextProvider,{i18n},React.createElement(DayPlannerContext.Provider,{value:{cardBg:'bg-white',borderClass:'border-stone-200',textPrimary:'text-stone-900',textSecondary:'text-stone-500',hoverBg:'hover:bg-stone-100'}},React.createElement(FeaturesContext.Provider,{value:{aspireEntries:state.records,aspireLoaded:state.loaded,aspireWritable:state.writable,aspireError:state.error,commitAspire:book.commit,reloadAspire:book.load}},React.createElement(AspireModal,{onClose:()=>closeCount++}))));}
const render=async()=>{await act(async()=>root.render(React.createElement(Harness)));};
const field=id=>document.querySelector(`[data-aspire-field="${id}"]`);
const button=label=>[...document.querySelectorAll('button')].find(el=>el.textContent===label||el.getAttribute('aria-label')===label);
const click=async el=>{assert(el,'button exists');await act(async()=>Simulate.click(el));};
const change=async(id,text)=>{await act(async()=>{field(id).focus();Simulate.change(field(id),{target:{value:text}});});};
const key=async(key,opts={})=>{await act(async()=>document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,...opts})));};
try{
 document.getElementById('opener').focus();await render();
 assert.equal(document.activeElement.getAttribute('aria-label'),'Close');
 await change('a','Edited first');await act(async()=>Simulate.blur(field('a')));assert.equal(value.find(x=>x.id==='a').text,'Edited first');
 await change('a','Cancelled');await key('Escape');assert.equal(field('a').value,'Edited first');assert.equal(closeCount,0);
 await click(button('Move entry 1 down'));assert.equal(document.querySelector('[data-aspire-entry]').dataset.aspireEntry,'b');
 await click(button('Add a motto'));assert.equal(value.find(x=>x.id==='new-1').text,'');assert.equal(document.activeElement.dataset.aspireField,'new-1');
 await change('new-1','Keep going');await click(button('Close'));assert.equal(value.find(x=>x.id==='new-1').text,'Keep going');assert.equal(closeCount,1);
 await click(button('Remove entry 1'));assert(value.find(x=>x.id==='b').deleted);await click(button('Undo'));assert(!value.find(x=>x.id==='b').deleted);
 fail=true;await change('a','Not lost');await click(button('Close'));assert.equal(closeCount,1);assert.equal(field('a').value,'Not lost');assert(document.body.textContent.includes('Could not save'));
 fail=false;await click(button('Save'));assert.equal(value.find(x=>x.id==='a').text,'Not lost');
 await change('a','Draft survives remote delete');const current=value.find(x=>x.id==='a');const later=new Date(Date.now()+1000).toISOString();
 await act(async()=>book.applyRemote([{...current,deleted:true,deletedAt:later,contentUpdatedAt:later,updatedAt:later}]));
 assert.equal(field('a').value,'Draft survives remote delete');await click(button('Close'));assert.equal(closeCount,1);
 await click(button('Cancel'));assert.equal(field('a'),null);await click(button('Close'));assert.equal(closeCount,2);
 await act(async()=>root.unmount());assert.equal(document.activeElement.id,'opener');
 console.log('PASS: edit/blur-save, Escape cancel, reorder, add blank motto, close flush, delete/Undo, failed save retention/retry, remote deletion keeps cancellable draft, focus restoration');
}finally{book.dispose();await server.close();dom.window.close();}
