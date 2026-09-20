// Jobo ledger operations. No I/O or remote task completion.
//
// The task itself owns Original Plan (`task.originalPlan`). A Do record owns
// the Final Plan that was current when the record was created
// (`record.planSnapshot`). The old v3 `plans` map is retained as a local
// compatibility index, but new entries are only captured from
// `task.originalPlan`; the current task schedule is never promoted to an
// Original Plan here.

const VERSION = 3;
const PROGRESS = ['started', 'partial', 'mostly', 'complete'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const key = id => String(id);
const safeId = s => typeof s === 'string' && s.length > 0 && s.length < 512 && !['__proto__', 'prototype', 'constructor'].includes(s);
function dateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T12:00:00');
  return Number.isFinite(+d) && dateString(d) === s;
}
function minutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!m) return NaN;
  const h = +m[1],
    n = +m[2];
  return n < 60 && h <= 24 && (h < 24 || n === 0) ? h * 60 + n : NaN;
}
function clock(m) {
  m = Math.max(0, Math.min(1440, Math.round(m)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function endEpoch(p) {
  return +new Date(`${p.date}T00:00:00`) + (minutes(p.startTime) + Number(p.duration)) * 60000;
}
function startEpoch(p) {
  return +new Date(`${p.date}T00:00:00`) + minutes(p.startTime) * 60000;
}
function empty() {
  return {
    version: VERSION,
    plans: {},
    records: [],
    noteHeights: {},
    notePresence: {},
    planTags: {},
    prefs: {
      dayScale: 84,
      weekScale: 1,
      allHours: false
    }
  };
}
function schedule(task) {
  if (!task || !validDate(task.date) || !Number.isFinite(minutes(task.startTime)) || minutes(task.startTime) >= 1440 || task.isAllDay) return null;
  const duration = Math.max(1, Math.min(1440 - minutes(task.startTime), Number(task.duration) || 30));
  return {
    date: task.date,
    startTime: clock(minutes(task.startTime)),
    duration
  };
}

// Original Plan is already stamped onto native tasks by main. It may be an
// older baseline without duration; that is valid provenance but cannot be
// used for a duration comparison. Keep the missing field missing instead of
// filling it from today's task schedule.
function originalPlanSnapshot(task) {
  const source = task?.originalPlan;
  if (!source || task?.isAllDay || !validDate(source.date) || !Number.isFinite(minutes(source.startTime)) || minutes(source.startTime) >= 1440) return null;
  const out = {
    date: source.date,
    startTime: clock(minutes(source.startTime))
  };
  if (own(source, 'duration')) {
    const duration = Number(source.duration);
    if (!Number.isFinite(duration) || duration < 1 || duration > 1440) return null;
    out.duration = duration;
  }
  return out;
}

// Final Plan is the current native schedule at the moment a Do is recorded.
// It is deliberately separate from the Do interval (`at`).
function planSnapshot(task) {
  return schedule(task);
}

function snapshot(task, now = new Date().toISOString()) {
  const s = originalPlanSnapshot(task);
  if (!s || task?.id == null || !safeId(key(task.id))) return null;
  return {
    ...s,
    id: key(task.id),
    title: String(task.title || ''),
    color: task.color || 'bg-blue-500',
    notes: String(task.notes || ''),
    projectId: task.projectId || null,
    baselineSource: 'task.originalPlan',
    capturedAt: now
  };
}
function capture(state, tasks, now) {
  let plans = state.plans,
    changed = false;
  for (const task of tasks || []) {
    const id = key(task.id);
    // A task without main's Original Plan is intentionally unknown. In
    // particular, do not use its current date/startTime as a fabricated
    // baseline. Keep any existing v3 entry untouched for old ledgers.
    if (task?.id == null || task.isAllDay || !task.originalPlan || own(plans, id)) continue;
    const p = snapshot(task, now);
    if (!p) continue;
    if (!changed) {
      plans = {
        ...plans
      };
      changed = true;
    }
    plans[id] = p;
  }
  return changed ? {
    ...state,
    plans
  } : state;
}
function recordsFor(state, planId) {
  return state.records.filter(r => r.planId === key(planId));
}
// The plan badge describes the most recently appended execution, not an
// aggregate and not the latest position on the time axis. Durable append order
// survives manual time edits, equal timestamps, clock rollback and reload.
function latestRecord(state, planId) {
  const id = key(planId);
  for (let i = state.records.length - 1; i >= 0; i--) {
    if (state.records[i].planId === id) return state.records[i];
  }
  return null;
}
function planChecked(state, planId) {
  const r = latestRecord(state, planId);
  return !!r && !['started', 'partial'].includes(r.progress);
}
// Record intervals may cross midnight. Plans retain the original schedule rules.
function recordSchedule(record) {
  if (!record || !validDate(record.date)) return null;
  const start = minutes(record.startTime),
    duration = Number(record.duration);
  if (!Number.isFinite(start) || start >= 1440 || !Number.isFinite(duration) || duration < 1 || duration > 1440) return null;
  return {
    date: record.date,
    startTime: clock(start),
    duration
  };
}
function immediatelyBeforeNow(task, now = new Date()) {
  const end = new Date(now);
  if (!Number.isFinite(+end)) throw new Error('Invalid current time');
  end.setSeconds(0, 0);
  const duration = Math.max(1, Math.min(1440, Number(task.duration) || 30));
  const start = new Date(+end - duration * 60000);
  return {
    date: dateString(start),
    startTime: clock(start.getHours() * 60 + start.getMinutes()),
    duration
  };
}
function recordChecked(state, task, id, now = new Date()) {
  // Check the live state here as well as the visual control to reject duplicate clicks.
  if (planChecked(state, task.id)) return state;
  return createRecord(state, task, immediatelyBeforeNow(task, now), id, new Date(now).toISOString());
}
function recordEndClock(record) {
  const end = minutes(record.startTime) + Number(record.duration);
  return clock(end > 1440 ? end % 1440 : end);
}
function resizeRecord(record, visible, patch, edge) {
  const displayed = {
    ...visible,
    ...patch
  };
  const a = edge === 'top' ? startEpoch(displayed) : startEpoch(record);
  const b = edge === 'bottom' ? endEpoch(displayed) : endEpoch(record);
  if (!(b > a) || b - a > 1440 * 60000) throw new Error('Invalid record interval');
  const start = new Date(a);
  return {
    date: dateString(start),
    startTime: clock(start.getHours() * 60 + start.getMinutes()),
    duration: (b - a) / 60000
  };
}
function recordsOnDate(state, date) {
  if (!validDate(date)) return [];
  const dayStart = +new Date(date + 'T00:00:00');
  const dayEnd = +new Date(date + 'T00:00:00');
  const nextDay = new Date(dayEnd);
  nextDay.setDate(nextDay.getDate() + 1);
  return state.records.flatMap(r => {
    const a = Math.max(startEpoch(r), dayStart),
      b = Math.min(endEpoch(r), +nextDay);
    if (!(b > a)) return [];
    if (r.date === date && endEpoch(r) <= +nextDay) return [r];
    const d = new Date(a);
    return [{
      ...r,
      date,
      startTime: clock(d.getHours() * 60 + d.getMinutes()),
      duration: (b - a) / 60000,
      _joboProjected: true
    }];
  });
}
// Canonical task notes also feed the Notes column and inherited Do snapshots.
// Preserve any legacy, explicitly separate note before joining it to the source.
function syncSourceNotes(state, tasks, now = new Date().toISOString()) {
  const sources = new Map((tasks || []).map(t => [key(t.id), t]));
  let changed = false;
  const records = state.records.map(r => {
    const task = r.sourceTaskId && sources.get(key(r.sourceTaskId));
    if (!task) return r;
    const text = String(task.notes || '');
    if (r.notes === text && !r.notesOwn) return r;
    changed = true;
    const legacy = r.notesOwn && r.notes && r.notes !== text ? [...(r.noteHistory || []), {
      text: r.notes,
      archivedAt: now,
      reason: 'legacy-separate-note'
    }] : r.noteHistory;
    return {
      ...r,
      notes: text,
      notesOwn: false,
      ...(legacy ? {
        noteHistory: legacy
      } : {})
    };
  });
  return changed ? {
    ...state,
    records
  } : state;
}
function createRecord(state, task, at, id, now = new Date().toISOString()) {
  if (!safeId(id)) throw new Error('Invalid record ID');
  if (state.records.some(r => r.id === id)) return state;
  let next = task ? capture(state, [task], now) : state;
  const s = recordSchedule({
    duration: task?.duration || 30,
    ...(task || {}),
    ...at
  });
  if (!s) throw new Error('Invalid record time');
  // A linked Do remains linked even when Original Plan is unknown. The
  // recording-time Final Plan is carried by the record itself, so linkage
  // must not depend on the legacy `plans` compatibility map.
  const taskId = task?.id != null && safeId(key(task.id)) ? key(task.id) : null;
  const r = {
    id,
    planId: taskId,
    sourceTaskId: taskId,
    ...s,
    title: String(at.title ?? task?.title ?? ''),
    color: at.color || task?.color || 'bg-purple-500',
    notes: String(at.notes ?? task?.notes ?? ''),
    notesOwn: !task,
    projectId: task?.projectId || null,
    // This is the current native schedule, not the actual interval above.
    // It is immutable through updateRecord so moving a Do cannot rewrite the
    // Final Plan it was recorded against.
    planSnapshot: task ? planSnapshot(task) : null,
    progress: 'complete',
    tags: [],
    createdAt: now,
    updatedAt: now
  };
  if (!r.title.trim()) throw new Error('Title is required');
  return {
    ...next,
    records: [...next.records, r]
  };
}
function updateRecord(state, id, patch, now = new Date().toISOString()) {
  const index = state.records.findIndex(r => r.id === id);
  if (index < 0) return state;
  const prior = state.records[index],
    allow = {};
  for (const k of ['title', 'date', 'startTime', 'duration', 'color', 'notes', 'notesOwn', 'progress', 'tags']) if (own(patch, k)) allow[k] = patch[k];
  if (allow.progress && !PROGRESS.includes(allow.progress)) throw new Error('Invalid completion level');
  if (allow.tags) allow.tags = normalizeTags(allow.tags);
  const r = {
      ...prior,
      ...allow,
      updatedAt: now
    },
    s = recordSchedule(r);
  if (!s || !String(r.title).trim()) throw new Error('Invalid record');
  const records = state.records.slice();
  records[index] = {
    ...r,
    ...s
  };
  return {
    ...state,
    records
  };
}
function removeRecord(state, id) {
  return {
    ...state,
    records: state.records.filter(r => r.id !== id)
  };
}

function completeAnchor(value) {
  if (!value || !validDate(value.date) || !Number.isFinite(minutes(value.startTime)) || minutes(value.startTime) >= 1440) return null;
  const duration = Number(value.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 1440) return null;
  return {
    date: value.date,
    startTime: clock(minutes(value.startTime)),
    duration
  };
}

function timingLabels(record, anchor) {
  const actual = recordSchedule(record),
    plan = completeAnchor(anchor);
  if (!actual || !plan) return null;
  const out = [],
    firstStart = startEpoch(actual),
    lastEnd = endEpoch(actual);
  if (firstStart > startEpoch(plan) || lastEnd > endEpoch(plan)) out.push('delayed');
  if (actual.duration > plan.duration) out.push('overrun');
  return out.length ? out : ['within'];
}

function withInterrupted(labels, records, record) {
  if (!labels) return null;
  const id = record?.taskId ?? record?.sourceTaskId ?? record?.planId;
  if (id == null) return labels;
  const related = (records || []).filter(item => (item.taskId ?? item.sourceTaskId ?? item.planId) === id);
  return new Set(related.map(item => item.id)).size >= 2 ? [...labels, 'interrupted'] : labels;
}

// Expose both anchors to the later comparison view without making an absent
// Original Plan look like a current-plan baseline. A legacy record with no
// `planSnapshot` keeps Final unknown after reload.
function classifyRecord(record, {
  originalPlan = null,
  records = [record]
} = {}) {
  return {
    original: withInterrupted(timingLabels(record, originalPlan), records, record),
    final: own(record || {}, 'planSnapshot') && record.planSnapshot
      ? withInterrupted(timingLabels(record, record.planSnapshot), records, record)
      : null,
    progress: record?.progress
  };
}

function labels(state, planId, now = Date.now(), displayedPlan = null) {
  const p = state.plans[key(planId)];
  const rs = recordsFor(state, planId);
  // An empty task is judged against the CURRENT visible block, not an old baseline.
  // A block crossing the current-time line is not a wholly elapsed block.
  if (!rs.length) {
    const visible = schedule(displayedPlan) || completeAnchor(p);
    return visible && now >= endEpoch(visible) ? ['notStarted'] : [];
  }
  // A task with no Original Plan remains unknown at this layer. Its records
  // can still be classified against their own Final snapshots below.
  if (!completeAnchor(p)) return [];
  // Interruption is an independent dimension. Keep timing deviations too.
  const out = [];
  const firstStart = Math.min(...rs.map(startEpoch)),
    lastEnd = Math.max(...rs.map(endEpoch));
  if (firstStart > startEpoch(p) || lastEnd > endEpoch(p)) out.push('delayed');
  if (rs.reduce((sum, r) => sum + Number(r.duration), 0) > p.duration) out.push('overrun');
  if (!out.length) out.push('within');
  if (rs.length >= 2) out.push('interrupted');
  return out;
}
function labelsForRecord(state, r, now) {
  if (!r.planId) return ['unplanned'];
  const final = own(r, 'planSnapshot') && r.planSnapshot ? r.planSnapshot : state.plans[key(r.planId)],
    out = withInterrupted(timingLabels(r, final), recordsFor(state, r.planId), r);
  return out || [];
}

function classifyRecordInState(state, r) {
  const id = r?.planId ?? r?.sourceTaskId;
  return classifyRecord(r, {
    originalPlan: id == null ? null : state.plans[key(id)] || null,
    records: id == null ? [r] : recordsFor(state, id)
  });
}

function validPlanEntry(value) {
  if (!value || !validDate(value.date) || !Number.isFinite(minutes(value.startTime)) || minutes(value.startTime) >= 1440) return null;
  if (!own(value, 'duration')) {
    // A main Original Plan from before duration was carried is valid
    // provenance, but its duration comparison remains unavailable.
    if (value.baselineSource !== 'task.originalPlan') return null;
    return {
      date: value.date,
      startTime: clock(minutes(value.startTime))
    };
  }
  const duration = Number(value.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 1440) return null;
  return {
    date: value.date,
    startTime: clock(minutes(value.startTime)),
    duration
  };
}

function validate(value) {
  if (!value || value.version !== VERSION || !Array.isArray(value.records) || typeof value.plans !== 'object' || !value.plans) throw new Error('Unsupported or invalid Jobo backup');
  if (value.records.length > 100000 || Object.keys(value.plans).length > 100000) throw new Error('Backup too large');
  const out = empty(),
    seen = new Set();
  for (const [id, p] of Object.entries(value.plans)) {
    const plan = validPlanEntry(p);
    if (!safeId(id) || !plan) throw new Error('Invalid plan');
    out.plans[id] = {
      ...p,
      ...plan,
      id
    };
  }
  for (const r of value.records) {
    if (!safeId(r.id) || seen.has(r.id) || !recordSchedule(r) || !PROGRESS.includes(r.progress) || typeof r.title !== 'string') throw new Error('Invalid Do record');
    if (own(r, 'planSnapshot') && r.planSnapshot !== null && !recordSchedule(r.planSnapshot)) throw new Error('Invalid Final Plan snapshot');
    // New linked records may legitimately have no Original Plan in the
    // compatibility index; their own planSnapshot is the only known anchor.
    // A v3 record without that field still requires its old baseline.
    if (r.planId != null && !safeId(key(r.planId))) throw new Error('Invalid plan link');
    if (r.planId != null && !own(out.plans, key(r.planId)) && !own(r, 'planSnapshot')) throw new Error('Missing plan baseline');
    out.records.push({
      ...r,
      tags: Array.isArray(r.tags) ? r.tags.map(String).slice(0, 20) : []
    });
    seen.add(r.id);
  }
  for (const [id, h] of Object.entries(value.noteHeights || {})) if (safeId(id) && Number.isFinite(h)) out.noteHeights[id] = Math.min(1000, Math.max(80, h));
  for (const [id, visible] of Object.entries(value.notePresence || {})) if (safeId(id) && typeof visible === 'boolean') out.notePresence[id] = visible;
  for (const [id, values] of Object.entries(value.planTags || {})) if (safeId(id) && Array.isArray(values)) out.planTags[id] = normalizeTags(values);
  const prefs = value.prefs || {};
  out.prefs = {
    dayScale: Math.max(44, Math.min(144, +prefs.dayScale || 84)),
    weekScale: Math.max(.7, Math.min(4, +prefs.weekScale || 1)),
    allHours: !!prefs.allHours
  };
  return out;
}
function carryCandidates(state, tasks, inbox, now = Date.now()) {
  const done = new Set((inbox || []).concat(tasks || []).map(t => t.joboCarrySource).filter(Boolean));
  const current = new Map((tasks || []).map(t => [key(t.id), t])),
    out = [];
  for (const [id, p] of Object.entries(state.plans)) if (labels(state, id, now, current.get(id)).includes('notStarted')) {
    const token = 'plan:' + id;
    if (!done.has(token)) out.push({
      token,
      kind: 'notStarted',
      task: current.get(id) || p,
      planId: id
    });
  }
  for (const r of state.records) if (['started', 'partial'].includes(r.progress)) {
    const token = 'do:' + r.id;
    if (!done.has(token)) out.push({
      token,
      kind: r.progress,
      task: r,
      recordId: r.id
    });
  }
  return out;
}
function carryTask(candidate, id, now = new Date().toISOString()) {
  const t = candidate.task;
  return {
    id,
    title: t.title,
    notes: t.notes || '',
    color: t.color || 'bg-blue-500',
    duration: t.duration || 30,
    completed: false,
    priority: 0,
    projectId: t.projectId || null,
    joboCarrySource: candidate.token,
    createdAt: now,
    lastModified: now
  };
}
// Allocate by the displayed rectangle, not just duration, so short two-row cards do not cover each other.
function lanes(items, scale, minHeight = 44) {
  const rows = items.map(item => ({
    item,
    start: minutes(item.startTime),
    end: minutes(item.startTime) + Math.max(item.duration, minHeight * 60 / scale)
  })).sort((a, b) => a.start - b.start || key(a.item.id).localeCompare(key(b.item.id)));
  let cluster = [],
    clusterEnd = -1;
  const out = [];
  function flush() {
    if (!cluster.length) return;
    const ends = [];
    for (const r of cluster) {
      let col = ends.findIndex(e => e <= r.start);
      if (col < 0) col = ends.length;
      ends[col] = r.end;
      r.col = col;
    }
    for (const r of cluster) out.push({
      ...r,
      width: 1 / ends.length,
      left: r.col / ends.length
    });
    cluster = [];
  }
  for (const r of rows) {
    if (r.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(r);
    clusterEnd = Math.max(clusterEnd, r.end);
  }
  flush();
  return out;
}
function normalizeTags(values) {
  return [...new Set((values || []).map(String).map(t => t.trim().replace(/^#+/, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
}
function addTag(state, role, id, text) {
  if (!safeId(key(id))) throw new Error('Invalid tag owner');
  const value = normalizeTags([text])[0];
  if (!value) return state;
  if (role === 'do') {
    const record = state.records.find(r => r.id === id);
    if (!record) return state;
    if (record.tags.includes(value)) return state;
    return updateRecord(state, id, {
      tags: normalizeTags([...record.tags, value])
    });
  }
  const current = (state.planTags || {})[key(id)] || [];
  if (current.includes(value)) return state;
  return {
    ...state,
    planTags: {
      ...state.planTags,
      [key(id)]: normalizeTags([...current, value])
    }
  };
}
function noteVisibility(state, id, visible) {
  if (!safeId(id)) throw new Error('Invalid note ID');
  if (state.notePresence?.[id] === visible) return state;
  return {
    ...state,
    notePresence: {
      ...state.notePresence,
      [id]: !!visible
    }
  };
}
function tags(title) {
  return [...String(title || '').matchAll(/#([\p{L}\p{N}_/-]+)/gu)].map(m => m[1]);
}
export { VERSION, PROGRESS, latestRecord, planChecked, recordSchedule, recordEndClock, resizeRecord, immediatelyBeforeNow, recordChecked, recordsOnDate, syncSourceNotes, empty, dateString, validDate, minutes, clock, startEpoch, endEpoch, schedule, planSnapshot, originalPlanSnapshot, snapshot, capture, createRecord, updateRecord, removeRecord, recordsFor, timingLabels, classifyRecord, classifyRecordInState, labels, labelsForRecord, validate, carryCandidates, carryTask, lanes, tags, normalizeTags, addTag, noteVisibility };
