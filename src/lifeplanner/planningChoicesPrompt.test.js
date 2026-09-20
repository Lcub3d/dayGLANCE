import { describe, expect, it, vi } from 'vitest';
import { PLANNING_PROMPT_KEY as K, PLANNING_PROMPT_DISMISSED_KEY as D, registerPlanningChoicesVisit as visit, dismissPlanningChoicesForToday as dismiss } from './planningChoicesPrompt.js';
const day = text => new Date(`${text}T12:00:00`);
const saved = { version: 1, lastVisit: '2026-09-17', days: 16, mondays: 16, sundays: 16 };
function fixture(state) {
  const data = new Map([['native-tasks', 'unchanged']]);
  if (state) data.set(K, JSON.stringify(state));
  const storage = { getItem: key => data.get(key) ?? null, setItem: vi.fn((key, value) => data.set(key, value)) };
  return { data, storage };
}
describe('bounded device-local guide cadence', () => {
  it.each(Array.from({length:16}, (_,i)=>i+1))('daily ordinal %i has its exact schedule', count => {
    const f=fixture({ ...saved, days: count-1, mondays: 0, sundays: 0, lastVisit: count===1 ? undefined : saved.lastVisit });
    if(count===1) f.data.delete(K);
    expect(visit(f.storage,day('2026-09-18'))).toBe([1,2,4,7,15].includes(count));
    expect(f.data.get('native-tasks')).toBe('unchanged');
  });
  it.each([['mondays','2026-09-21'],['sundays','2026-09-20']])('%s have independent 1/2/4/7/15 milestones', (name,date) => {
    for(let count=1;count<=16;count++) {
      const f=fixture({...saved,[name]:count-1});
      expect(visit(f.storage,day(date))).toBe([1,2,4,7,15].includes(count));
    }
  });
  it('counts opened dates, not elapsed days or refreshes', () => {
    const f=fixture();expect(visit(f.storage,day('2026-09-02'))).toBe(true);
    expect(visit(f.storage,day('2026-09-04'))).toBe(true);
    const writes=f.storage.setItem.mock.calls.length;
    expect(visit(f.storage,day('2026-09-04'))).toBe(true);
    expect(f.storage.setItem).toHaveBeenCalledTimes(writes);
    expect(visit(f.storage,day('2026-09-08'))).toBe(false);
    expect(JSON.parse(f.data.get(K)).days).toBe(3);
  });
  it('monthly first is eligible even after all counters saturate', () => {
    const f=fixture(saved);expect(visit(f.storage,day('2026-10-01'))).toBe(true);
    expect(visit(f.storage,day('2026-10-02'))).toBe(false);
  });
  it('today dismissal wins over every schedule and survives reload-like callers', () => {
    const f=fixture();visit(f.storage,day('2026-09-01'));
    expect(dismiss(f.storage,day('2026-09-01'))).toBe(true);
    expect(visit(f.storage,day('2026-09-01'))).toBe(false);
    expect(f.data.get(D)).toBe('2026-09-01');
    expect(visit(f.storage,day('2026-09-02'))).toBe(true);
  });
  it('snoozing never initializes or changes task/preference data', () => {
    const f=fixture();dismiss(f.storage,day('2026-09-20'));
    expect([...f.data.keys()]).toEqual(['native-tasks',D]);
  });
  it.each(['broken','null','{}','{"version":99}','{"version":1,"days":999}'])('fails closed and preserves invalid/future data %s', raw=>{
    const f=fixture();f.data.set(K,raw);
    expect(visit(f.storage,day('2026-09-20'))).toBe(false);
    expect(f.data.get(K)).toBe(raw);expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('does not overwrite its high-water mark after clock rollback',()=>{
    const f=fixture(saved);expect(visit(f.storage,day('2026-09-01'))).toBe(false);
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('keeps constant-size metadata after long usage',()=>{
    const f=fixture();for(let i=0;i<1500;i++)visit(f.storage,new Date(2026,8,i+1,12));
    expect(f.data.get(K).length).toBeLessThan(125);
    expect(JSON.parse(f.data.get(K))).toMatchObject({days:16,mondays:16,sundays:16});
  });
  it('does not fake dismissal success or auto-open on storage errors',()=>{
    const storage={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}};
    expect(visit(storage,day('2026-09-01'))).toBe(false);
    expect(dismiss(storage,day('2026-09-01'))).toBe(false);
    expect(visit(fixture().storage,new Date('bad'))).toBe(false);
  });
});
