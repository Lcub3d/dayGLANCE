import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import Year2View, { Year2Month } from './Year2View.jsx';
import { year2Months } from '../../jobu/year2.js';
import { chineseCalendarYear } from '../../jobu/calendar/chineseCalendar.js';
import { calendarDefaults } from '../../jobu/calendar/preferences.js';
import { Year2CalendarDetail } from './Year2CalendarLayers.jsx';

const items = {'2026-09-16': [
  {id:'a',title:'Report',color:'bg-blue-500',startTime:'09:00'},
  {id:'b',title:'Call',color:'bg-orange-500',startTime:'10:00',completed:true},
  {id:'c',title:'Review',startTime:'11:00'},
]};
const notes={'2026-09-16': {text:'A real daily note'}};
async function wrap(language, node) {
  const translation=await loaders[language]();
  const i18n=i18next.createInstance();
  await i18n.init({lng:language,fallbackLng:false,resources:{[language]:{translation}},interpolation:{escapeValue:false}});
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}
function month(props={}) {
  return <Year2Month model={year2Months(2026,1)[8]} selected="2026-09-16" today="2026-09-16" itemsByDate={items} notes={notes}
    onSelect={vi.fn()} onOpenMonth={vi.fn()} onMove={vi.fn()} {...props}/>;
}
describe('Year 2 month tiles',()=>{
  it.each(['en','zh-CN'])('renders the selected day and real event preview in %s', async language=>{
    const html=await wrap(language,month());
    expect((html.match(/data-year2-date=/g)||[])).toHaveLength(30);
    expect((html.match(/tabindex="0"/g)||[])).toHaveLength(1);
    expect(html).toContain('aria-current="date"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Report');
    expect(html).toContain('Call');
    expect(html).toContain('year2-more');
    expect(html).toContain('>+1<');
    expect(html).not.toContain('jobu.year2OpenMonth');
    expect(html).toContain(language==='en' ? 'Daily Note' : '每日笔记');
  });
  it('keeps leading/trailing cells blank and note tombstones invisible',async()=>{
    const html=await wrap('en',month({notes:{'2026-09-16':{text:'stale',deleted:true}}}));
    expect((html.match(/year2-blank/g)||[])).toHaveLength(12);
    expect(html).not.toContain('data-year2-date="2026-08-31"');
    expect(html).not.toContain('Daily Note');
  });
  it('does not force a hidden MONTH view back into the switcher',async()=>{
    const html=await wrap('en',month({onOpenMonth:undefined}));
    expect(html).toContain('<h2>September</h2>');
    expect(html).not.toContain('Open September');
  });
});

describe('Year 2 native integration',()=>{
  it('shows all 12 months using the existing native day selectors, without writes',async()=>{
    const getTasksForDate=vi.fn(date=>items[`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`]||[]);
    const setTasks=vi.fn(),recordJobo=vi.fn(),save=vi.fn();
    const html=await wrap('zh-CN',<DayPlannerContext.Provider value={{selectedDate:new Date(2026,8,16,12),currentTime:new Date(2026,8,16,12),weekStartDay:1,getTasksForDate,dailyNotes:notes,dataLoaded:true,setTasks}}>
      <FeaturesContext.Provider value={{recordJobo,jobuData:{save}}}><Year2View/></FeaturesContext.Provider>
    </DayPlannerContext.Provider>);
    expect((html.match(/data-year2-month=/g)||[])).toHaveLength(12);
    expect((html.match(/data-year2-date=/g)||[])).toHaveLength(365);
    expect(getTasksForDate).toHaveBeenCalledTimes(365);
    expect(html).toContain('aria-label="年2"');
    expect(setTasks).not.toHaveBeenCalled();
    expect(recordJobo).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});


describe('Year 2 cultural and official schedule layers', () => {
  const options = { ...calendarDefaults('zh-CN'), region: 'CN' };
  it('adds independent holiday and makeup badges without changing native items', async () => {
    const html = await wrap('zh-CN', month({ metadata: chineseCalendarYear(2026), options }));
    expect(html).toContain('data-arrangement="rest"'); expect(html).toContain('data-arrangement="work"');
    expect(html).toContain('中秋节'); expect(html).toContain('八月'); expect(html).toContain('秋分');
    expect(html).toContain('Report'); expect(html).toContain('>+1<');
    expect((html.match(/data-year2-date=/g)||[])).toHaveLength(30);
  });
  it('does not mark ordinary weekends as official rest days when the region is off', async () => {
    const html = await wrap('en', month({ metadata: chineseCalendarYear(2026), options: calendarDefaults('en') }));
    expect(html).not.toContain('data-arrangement='); expect(html).not.toContain('year2-lunar');
  });
  it('keeps original titles accessible in overview mode', async () => {
    const html = await wrap('en', month({ options: { ...options, density: 'overview' } }));
    expect(html).toContain('year2-dots'); expect(html).toContain('Report');
    expect(html).toContain('bg-blue-500');
  });
  it('adds read-only date context to the existing agenda, not a parallel day editor', async () => {
    const html = await wrap('zh-CN', <Year2CalendarDetail date="2026-09-25" options={options} />);
    expect(html).toContain('2026年八月十五'); expect(html).toContain('中秋节');
    expect(html).toContain('2026-09-25'); expect(html).toContain('2026-09-27');
    expect(html).not.toContain('<input'); expect(html).not.toContain('role="dialog"');
  });
  it('omits absent-year official status without hiding known lunar festivals', async () => {
    const html = await wrap('zh-CN', <Year2CalendarDetail date="2027-02-06" options={options} />);
    expect(html).toContain('春节'); expect(html).not.toContain('year2-date-arrangement');
  });
});
