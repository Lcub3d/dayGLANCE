// Calendar-day, unique-task counts. Manual Do records and split intervals are
// not extra completions. Explicit source dates avoid observer-timezone drift.
export const dayKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function validDay(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false; const d=new Date(`${value}T12:00:00`); return Number.isFinite(+d) && dayKey(d) === value; }
export function yearDays(year) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('year');
  const result=[]; const d=new Date(year,0,1,12);
  while (d.getFullYear() === year) { result.push({ date:dayKey(d), weekday:d.getDay(), month:d.getMonth(), day:d.getDate() }); d.setDate(d.getDate()+1); }
  return result;
}
export function completionCounts({ tasks=[], unscheduledTasks=[], recurringTasks=[], recycleBin=[], joboRecords=[] }={}) {
  const days=new Map();
  const add=(date,id)=>{ if (!validDay(date) || id == null) return; if (!days.has(date)) days.set(date,new Set()); days.get(date).add(String(id)); };
  for (const t of [...tasks,...unscheduledTasks,...recycleBin]) if (t.completed && !t.recurringTemplateId && !t.isExample) add(t.completedAt?.slice(0,10),t.id);
  for (const r of recurringTasks) for (const date of r.completedDates || []) add(r.completedDatesTimestamps?.[date]?.slice(0,10) || date, `${r.id}:${date}`);
  for (const r of joboRecords || []) {
    if (r.deleted || r.source !== 'completion' || r.progress !== 'completed' || r.taskId == null) continue;
    const template = recurringTasks.find(t=>String(t.id)===String(r.taskId));
    const prefix = `do:${String(r.taskId)}:`;
    const suffix = r.id?.startsWith(prefix) ? r.id.slice(prefix.length) : '';
    const instance = /^\d{4}-\d{2}-\d{2}(?::|$)/.test(suffix) ? suffix.slice(0,10) : null;
    const occurrence = template ? (instance || r.planSnapshot?.date || r.date) : null;
    // Interval corrections must not move the original completion to another day.
    add(r.createdAt?.slice(0,10) || r.date, occurrence ? `${r.taskId}:${occurrence}` : r.taskId);
  }
  return Object.fromEntries([...days].map(([date,ids])=>[date,ids.size]));
}
export const heatLevel = n => !n ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : 4;
export const DEFAULT_DAY_TEMPLATES = [
  { id:'business',name:'出差 / Business trip',color:'#3b82f6',kind:'business',blocks:[] },
  { id:'holiday',name:'休假 / Holiday',color:'#a855f7',kind:'holiday',blocks:[] },
  { id:'deadline',name:'目标截止日 / Goal deadline',color:'#ef4444',kind:'deadline',blocks:[] },
];
export function validateDayTemplate(t) {
  if (!t || typeof t.id!=='string' || !t.id || typeof t.name!=='string' || !t.name.trim() || t.name.length>120 || !/^#[0-9a-f]{6}$/i.test(t.color) || !Array.isArray(t.blocks) || t.blocks.length>40) throw new Error('template');
  const ids=new Set();
  for (const b of t.blocks) { if (!b.id || ids.has(b.id) || !b.title?.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.startTime) || !Number.isFinite(b.duration) || b.duration<=0 || b.duration>1440) throw new Error('template'); ids.add(b.id); }
  return t;
}
export function dayRange(from,to) { if (!validDay(from)||!validDay(to)||from>to) throw new Error('date'); const out=[];const d=new Date(`${from}T12:00:00`);while(dayKey(d)<=to){out.push(dayKey(d));if(out.length>366)throw new Error('range');d.setDate(d.getDate()+1);}return out; }
