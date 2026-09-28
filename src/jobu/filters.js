import { dayKey } from './year.js';
import { taskLabels } from './quickAdd.js';
import { priorityLevel } from '../utils/taskPriority.js';
import { compareDate, hasTaskDate, parseFilterDate, shiftDay, taskDate } from './filterDates.js';

// Keep escapes until interpreting a name: an escaped * is a literal, not a glob.
export function quoteFilterName(name) { return `"${String(name).replace(/[\\"*]/g, '\\$&')}"`; }
function namePattern(raw) {
  let text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  if (!text) throw Error('filter');
  const pattern = []; let escaped = false;
  for (const char of text.normalize('NFC').toLowerCase()) {
    if (!escaped && char === '\\') { escaped = true; continue; }
    if (char === '*' && !escaped) { if (pattern.at(-1) !== null) pattern.push(null); }
    else pattern.push(char);
    escaped = false;
  }
  if (escaped) throw Error('filter');
  // Bounded glob matcher, not a backtracking regex built from user input.
  return name => {
    const chars = [...String(name || '').normalize('NFC').toLowerCase()];
    let p = 0, n = 0, star = -1, retry = 0;
    while (n < chars.length) {
      if (pattern[p] === chars[n]) { p++; n++; }
      else if (p < pattern.length && pattern[p] === null) { star = p++; retry = n; }
      else if (star !== -1) { p = star + 1; n = ++retry; }
      else return false;
    }
    while (p < pattern.length && pattern[p] === null) p++;
    return p === pattern.length;
  };
}
function tokenize(query) {
  const tokens = []; let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && '&|!(),'.includes(char)) {
      if (query.slice(start, i).trim()) tokens.push(query.slice(start, i).trim());
      tokens.push(char); start = i + 1;
    }
  }
  if (quoted || escaped) throw Error('filter');
  if (query.slice(start).trim()) tokens.push(query.slice(start).trim());
  return tokens;
}
// Recursive descent, never eval. Commas are independent result sections, not
// OR. Every caller (sidebar count, preview, results) consumes the same compiler.
export function compileJobuFilter(query, { projects = [], now = new Date(), today = dayKey(now), getLabels = taskLabels } = {}) {
  const failed = (reason = 'filter', token = '') => ({ test: () => false, sections: [], error: reason, errorToken: token });
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) return failed();
  let token = '';
  try {
    const tokens = tokenize(query); let at = 0, depth = 0, includeCompleted = false;
    const word = raw => {
      token = raw; const q = raw.toLowerCase().trim();
      if (['all', 'view all', '所有', '全部'].includes(q)) return () => true;
      // Retained Jobu extension; Todoist filters normally contain active tasks.
      if (['completed', '已完成'].includes(q)) { includeCompleted = true; return t => !!t.completed; }
      if (['no date', 'no due date', '无日期'].includes(q)) return t => !hasTaskDate(t, 'date');
      if (['no time', '无时间'].includes(q)) return t => !!taskDate(t) && !taskDate(t).time;
      if (['no deadline', '无截止日期'].includes(q)) return t => !hasTaskDate(t, 'deadline');
      if (['no label', 'no labels', '无标签'].includes(q)) return t => getLabels(t).length === 0;
      if (['recurring', '重复'].includes(q)) return t => !!(t.recurrence || t.isRecurring || t.todoist?.recurring);
      if (['subtask', '子任务'].includes(q)) return t => t.parentId != null || t.parent_id != null || !!t._jobuParent;
      if (['overdue', 'over due', 'od', '过期', '逾期'].includes(q)) return t => !!taskDate(t) && taskDate(t).day < today;
      if (['no priority', '无优先级'].includes(q) || /^p[1-4]$/.test(q)) return t => priorityLevel(t.priority) === (q.startsWith('p') ? q : 'p4');
      if (/^[@%]/.test(raw)) { const matches = namePattern(raw.slice(1)); return t => getLabels(t).some(matches); }
      if (/^#/.test(raw)) {
        const nested = raw.startsWith('##'), matches = namePattern(raw.slice(nested ? 2 : 1));
        const ids = new Set(projects.filter(p => !p.deleted && matches(p.title)).map(p => String(p.id)));
        if (nested) {
          for (let n = 0; n < projects.length; n++) {
            let changed = false;
            for (const p of projects) if (!p.deleted && ids.has(String(p.parentId ?? p.parent_id)) && !ids.has(String(p.id))) { ids.add(String(p.id)); changed = true; }
            if (!changed) break;
          }
        }
        const inbox = matches('Inbox') || matches('收件箱');
        // Source-only project names are added to projects by the task adapter.
        if (!inbox && !ids.size) throw Error('filterProject');
        return t => t.todoist && !t.projectId
          ? matches(t.todoist.project) || ids.has(`todoist:${t.todoist.accountId}:${t.todoist.projectId}`)
          : ids.has(String(t.projectId)) || (inbox && !t.projectId);
      }
      if (q.startsWith('search:') || q.startsWith('搜索:')) {
        const text = raw.slice(raw.indexOf(':') + 1).trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1').toLowerCase();
        if (!text) throw Error('filter');
        const terms = text.split(/\s+/);
        return t => terms.every(term => `${t.title || ''} ${t.notes || ''}`.toLowerCase().includes(term));
      }
      const dateQuery = /^(date|due|deadline)(?:\s+(before|after))?\s*:\s*(.+)$/i.exec(raw);
      if (dateQuery) {
        const target = parseFilterDate(dateQuery[3], { now, today });
        return t => compareDate(taskDate(t, dateQuery[1].toLowerCase()), target, dateQuery[2]?.toLowerCase() || 'on');
      }
      const days = /^(?:next\s+)?(\d{1,3})\s*(?:days|天)$/.exec(q);
      if (days && Number(days[1]) > 0) {
        const end = shiftDay(today, Number(days[1]) - 1);
        return t => !!taskDate(t) && taskDate(t).day >= today && taskDate(t).day <= end;
      }
      // An unprefixed date is a due query; due prefers date over deadline.
      try { const target = parseFilterDate(raw, { now, today }); return t => compareDate(taskDate(t), target, 'on'); }
      catch { throw Error('filterUnsupported'); }
    };
    const factor = () => {
      if (++depth > 32) throw Error('filter');
      let fn; const value = tokens[at++];
      if (value === '!') { const child = factor(); fn = t => !child(t); }
      else if (value === '(') { fn = or(); if (tokens[at++] !== ')') throw Error('filter'); }
      else if (!value || '&|),'.includes(value)) throw Error('filter');
      else fn = word(value);
      depth--; return fn;
    };
    const and = () => { let fn = factor(); while (tokens[at] === '&') { at++; const left = fn, right = factor(); fn = t => left(t) && right(t); } return fn; };
    const or = () => { let fn = and(); while (tokens[at] === '|') { at++; const left = fn, right = and(); fn = t => left(t) || right(t); } return fn; };
    const sections = [];
    while (at < tokens.length) {
      includeCompleted = false; const start = at, matches = or(), complete = includeCompleted;
      sections.push({ query: tokens.slice(start, at).join(' '), test: t => !!t && !t.deleted && !t.archived && (!t.completed || complete) && matches(t) });
      if (at === tokens.length) break;
      if (tokens[at++] !== ',' || at === tokens.length) throw Error('filter');
      if (sections.length > 20) throw Error('filter');
    }
    if (!sections.length) return failed();
    return { test: t => sections.some(section => section.test(t)), sections, error: null, errorToken: '' };
  } catch (error) { return failed(error.message || 'filter', token); }
}
