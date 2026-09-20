import React from 'react';
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:key=>key})}));
const preferences=vi.hoisted(()=>({showPlanningChoices:false,setShowPlanningChoices:vi.fn(),joboEnabled:false,setJoboEnabled:vi.fn(),lifeplannerEnabled:false,setLifeplannerEnabled:vi.fn()}));
vi.mock('../context/FeaturesContext.jsx',()=>({useFeaturesCtx:()=>preferences}));
vi.mock('../context/DayPlannerContext.jsx',()=>({useDayPlannerCtx:()=>({darkMode:false,borderClass:'border-stone-200',textSecondary:'text-stone-500',canShowViewCycler:true,hiddenViews:{desktop:[]}})}));
vi.mock('react-dom',()=>({createPortal:children=>children}));
import PlanningChoices, { PlanningChoiceRow, PlanningChoicesButton } from '../components/lifeplanner/PlanningChoices.jsx';
const ctx={darkMode:false, borderClass:'border-stone-200',textSecondary:'text-stone-500'};
const bundle = lng=>JSON.parse(fs.readFileSync(new URL(`../../public/locales/${lng}/translation.json`,import.meta.url),'utf8')).planningChoices;
describe('planning choice presentation',()=>{
  it('renders a real always-on disabled switch, not a clickable fake',()=>{
    const html=renderToStaticMarkup(<PlanningChoiceRow name="daily" title="My day, at a glance." description="Daily view" checked locked ctx={ctx}/>);
    expect(html).toContain('role="switch"');expect(html).toContain('aria-checked="true"');expect(html).toContain('disabled=""');
    expect(html).toContain('planningChoices.alwaysOn');expect(html).toContain('aria-labelledby=');expect(html).toContain('aria-describedby=');
  });
  it.each([false,true])('optional switch has an accessible, stable label when %s',checked=>{
    const html=renderToStaticMarkup(<PlanningChoiceRow name="review" title="Reflect on my day." description="Plan / Do" checked={checked} ctx={ctx}/>);
    expect(html).toContain(`aria-checked="${checked}"`);expect(html).not.toContain('disabled=""');expect(html).toContain('Reflect on my day.');
  });
  it('uses the brand button and identifies its own dialog rather than replacing Help',()=>{
    const html=renderToStaticMarkup(<PlanningChoicesButton/>);expect(html).toContain('bg-brand');expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain('planningChoices.open');
  });
  it.each(['en','zh-CN','de','es','fr','it','pt-BR','pt-PT'])('keeps locale and placeholder parity in %s',lng=>{
    const en=bundle('en'), own=bundle(lng);expect(Object.keys(own).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(own).every(s=>typeof s==='string' && s.trim())).toBe(true);
  });
  it.each([false,true])('reads the real native Jobo preference from FeaturesContext when %s',checked=>{
    preferences.joboEnabled=checked;vi.stubGlobal('document',{body:{}});
    try {
      const html=renderToStaticMarkup(<PlanningChoices/>);
      const review=html.split('data-planning-choice="review"')[1].split('data-planning-choice="life"')[0];
      expect(review).toContain(`aria-checked="${checked}"`);
      expect(review.includes('planningChoices.openJobo')).toBe(checked);
    } finally {preferences.joboEnabled=false;vi.unstubAllGlobals();}
  });
  it('uses first-person copy, Plan/Do and the existing product name',()=>{
    expect(bundle('en').title).toBe('How do I want to use dayGLANCE?');expect(bundle('en').daily).toBe('My day, at a glance.');
    expect(bundle('en').reviewDescription).toContain('Plan and Do');expect(bundle('zh-CN').title).toContain('我');
    expect(JSON.stringify(bundle('en'))).not.toContain('lifeGLANCE');expect(bundle('en').joboPreview).toContain('preview');
  });
});
