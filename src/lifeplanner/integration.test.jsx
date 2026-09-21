import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_IDS, createVision, validateVision } from './model.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const en=JSON.parse(fs.readFileSync(path.join(root,'public/locales/en/translation.json'),'utf8'));
const zh=JSON.parse(fs.readFileSync(path.join(root,'public/locales/zh-CN/translation.json'),'utf8'));
vi.mock('../context/DayPlannerContext.jsx',()=>({useDayPlannerCtx:()=>({darkMode:false,textPrimary:'text-stone-900',cardBg:'bg-white',textSecondary:'text-stone-500',borderClass:'border-stone-200',hoverBg:'hover:bg-stone-100',tasks:[],unscheduledTasks:[],recycleBin:[],actualTodayNonImportedTasks:[],actualTodayCompletedTasks:[],inboxCompletedTodayCount:0})}));
vi.mock('../context/FeaturesContext.jsx',()=>({useFeaturesCtx:()=>({goalsProjectsEnabled:true,lifeplannerEnabled:true,multiUserEnabled:false,users:[],projects:[],goals:[]})}));
vi.mock('../context/SyncContext.jsx',()=>({useSyncCtx:()=>({obsidianConfig:{enabled:false}})}));
vi.mock('../hooks/useGlanceFabs.js',()=>({default:()=>({collapsed:false,toggle:()=>{}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:key=>key,i18n:{language:'en'}})}));
import GlanceFabs from '../components/GlanceFabs.jsx';
import { ProjectForm } from '../components/goals/GoalDashboard.jsx';

const keys=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?keys(v,`${p}${k}.`):`${p}${k}`).sort();
describe('Life Planner native integration contracts',()=>{
  it('uses the same native pill style and renders directly below Goals & Projects',()=>{
    const html=renderToStaticMarkup(<GlanceFabs/>);
    const buttons=[...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>[\s\S]*?<\/button>/g)];
    const goals=buttons.find(m=>m[0].includes('settings.goalsProjects'));
    const life=buttons.find(m=>m[0].includes('lifeplanner.entry'));
    expect(goals).toBeTruthy();expect(life).toBeTruthy();expect(goals[1]).toBe(life[1]);expect(html.indexOf(goals[0])).toBeLessThan(html.indexOf(life[0]));
  });
  it('prefills the native NEW Project form instead of pretending to edit a project',()=>{
    const html=renderToStaticMarkup(<ProjectForm prefill={{title:'Publish 1 book'}} goals={[]} onSave={()=>{}} onCancel={()=>{}}/>);
    expect(html).toContain('value="Publish 1 book"');expect(html).toContain('goals.createProject');expect(html).toContain('goals.newProject');expect(html).not.toContain('goals.editProject');
  });
  it('preserves the existing edit-form semantics',()=>{
    const html=renderToStaticMarkup(<ProjectForm initial={{id:'p',title:'Existing'}} prefill={{title:'Ignored'}} goals={[]} onSave={()=>{}} onCancel={()=>{}}/>);
    expect(html).toContain('value="Existing"');expect(html).toContain('goals.editProject');expect(html).not.toContain('value="Ignored"');
  });
  it.each(['en','zh-CN','de','es','fr','it','pt-BR','pt-PT'])('provides complete locale keys and valid optional examples (%s)',lng=>{
    const strings=JSON.parse(fs.readFileSync(path.join(root,`public/locales/${lng}/translation.json`),'utf8')).lifeplanner;
    expect(keys(strings)).toEqual(keys(en.lifeplanner));
    for (const id of CATEGORY_IDS) for (const example of strings.categories[id].exampleVision.split('\n')) expect(validateVision(createVision(example,'2026-09-20','test'))).toBeNull();
  });
  it('uses the revised notebook headings and preserves five default mottos',()=>{
    expect(zh.lifeplanner.title).toBe('人生愿望清单');expect(zh.lifeplanner.principles).toBe('座右铭');expect(Object.values(zh.lifeplanner.defaults)).toHaveLength(5);
  });
  it('uses the native brand token for the guide button; no diagram/mock overlay',()=>{
    const jsx=fs.readFileSync(path.join(root,'src/components/lifeplanner/LifePlanner.jsx'),'utf8');
    expect(jsx).toContain('lp-guide-button bg-brand');expect(jsx).toContain("L('assistant')");
  });
});
