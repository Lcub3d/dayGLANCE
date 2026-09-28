import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { organizerState } from '../../jobu/organizerStore.js';
import { FILTER_TEMPLATES } from '../../jobu/filterTemplates.js';
import FilterSidebar, { FiltersTab, LabelsEntry } from './FilterSidebar.jsx';
import FilterEditor from './FilterEditor.jsx';
import LabelsPage from './LabelsPage.jsx';
import { TaskLabelChips, TaskLabelPicker } from './TaskLabels.jsx';
import TasksView from './TasksView.jsx';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key,vars)=>vars?.count!=null?`${key}:${vars.count}`:key})}));
const task={id:'a',title:'Task #native',priority:3,date:'2026-09-29',todoist:{labels:['进行'],due:{date:'2026-09-29'}}};
function render(element,patch={}){
 const state=organizerState([], [task]);const organizer={...state,loaded:true,writable:true,entries:[{task,inbox:false}],options:{today:'2026-09-29',now:new Date('2026-09-29T12:00:00'),projects:[],getLabels:state.labels.namesFor},...patch};
 const f={jobuOrganizer:organizer,projects:[],setJobuPage:()=>{},openJobuFilter:()=>{},jobuWritable:true,jobuLoaded:true};
 return renderToStaticMarkup(<DayPlannerContext.Provider value={{tasks:[task],dataLoaded:true,darkMode:false}}><FeaturesContext.Provider value={f}>{element}</FeaturesContext.Provider></DayPlannerContext.Provider>);
}
describe('Organizer UI uses one filtered population',()=>{
 it('adds a scoped Filters tab and a visible Labels entry without stock clients requiring a new context',()=>{
  expect(render(<FiltersTab active onClick={()=>{}}/>)).toContain('data-jobu-filters-tab');expect(render(<LabelsEntry/>)).toContain('data-jobu-labels-entry');
  expect(renderToStaticMarkup(<FeaturesContext.Provider value={{}}><FiltersTab/><LabelsEntry/></FeaturesContext.Provider>)).toBe('');
 });
 it('renders all requested template names and queries, rather than placeholder names',()=>{
  const html=render(<FilterSidebar/>);for(const template of FILTER_TEMPLATES)expect(html).toContain(template.name);
  expect(html).toContain('今天&amp;!p4');expect(html).toContain('due before: +3 hours');expect(html).toContain('organizer.noPersonal');
 });
 it('does not show a false zero count for unloaded data',()=>{
  const html=render(<FilterSidebar/>,{loaded:false});expect(html).toContain('<b>…</b>');expect(html).not.toContain('<b>0</b>');
 });
 it('exposes error state and disables saving unsupported filters',()=>{
  const html=render(<FilterEditor query="!assigned to: someone" onClose={()=>{}}/>);
  expect(html).toContain('organizer.errors.filterUnsupported');expect(html).toContain('disabled=""');expect(html).toContain('aria-modal="true"');
 });
 it('shows labels from both source fields and native tags as buttons',()=>{
  const html=render(<TaskLabelChips task={task}/>);expect(html).toContain('进行');expect(html).toContain('native');expect(html).toContain('type="button"');
 });
 it('labels catalog counts tasks and provides rename/delete/favorite actions',()=>{
  const html=render(<LabelsPage onClose={()=>{}}/>);expect(html).toContain('organizer.editLabel: 进行');expect(html).toContain('common.delete: 进行');expect(html).toContain('organizer.favorite: 进行');
 });
 it('returns separate comma lists with repeated membership without counting them as separate identities',()=>{
  const html=render(<TasksView request={{query:'today,p1',title:'Sections'}}/>);
  expect((html.match(/class="ju-filter-section"/g)||[]).length).toBe(2);
  expect((html.match(/data-pomodoro-task="a"/g)||[]).length).toBe(2);expect(html).toContain('organizer.preview:1');
 });
 it('shows a missing task instead of saving labels onto an orphaned selection',()=>{
  const html=render(<TaskLabelPicker task={{id:'missing'}} onClose={()=>{}}/>);
  expect(html).toContain('organizer.errors.missing');expect(html).toContain('disabled=""');
 });
});
