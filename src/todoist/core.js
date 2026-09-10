// Selective read-source sync. Only item_close is permitted on the write side.
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false, priorities: [1, 2], projects: [], labels: [],
  match: 'all', labelMatch: 'any', subprojects: true,
  completionWriteback: false, intervalMinutes: 5,
});
const flag = value => value === true || value === 1;
const key = value => String(value ?? '');
export const active = item => !flag(item.is_deleted) && !flag(item.checked);
export const taskId = (accountId, id) => `todoist:${key(accountId)}:${key(id)}`;
export function normalizeSettings(raw = {}) {
  const list = value => [...new Set(Array.isArray(value) ? value.map(String) : [])];
  return {
    enabled: raw.enabled === true,
    priorities: [...new Set((Array.isArray(raw.priorities) ? raw.priorities : DEFAULT_SETTINGS.priorities).filter(p => [1, 2, 3, 4].includes(p)))],
    projects: list(raw.projects), labels: list(raw.labels),
    match: raw.match === 'any' ? 'any' : 'all',
    labelMatch: raw.labelMatch === 'all' ? 'all' : 'any',
    subprojects: raw.subprojects !== false,
    completionWriteback: raw.completionWriteback === true,
    intervalMinutes: [0, 1, 5, 15].includes(raw.intervalMinutes) ? raw.intervalMinutes : 5,
  };
}
export function matches(item, settings, projects = {}) {
  const tests = [];
  if (settings.priorities.length) tests.push(settings.priorities.includes(5 - Number(item.priority)));
  if (settings.labels.length) {
    const labels = Array.isArray(item.labels) ? item.labels : [];
    tests.push(settings.labels[settings.labelMatch === 'all' ? 'every' : 'some'](label => labels.includes(label)));
  }
  if (settings.projects.length) {
    let id = key(item.project_id);
    const visited = new Set();
    let found = false;
    while (id && !visited.has(id)) {
      visited.add(id);
      if (settings.projects.includes(id)) { found = true; break; }
      if (!settings.subprojects) break;
      id = key(projects[id]?.parent_id);
    }
    tests.push(found);
  }
  // Empty criteria must never turn into an accidental whole-account import.
  return tests.length > 0 && tests[settings.match === 'any' ? 'some' : 'every'](Boolean);
}
export function mergeResponse(previous = {}, response) {
  if (!response || typeof response.sync_token !== 'string') throw new Error('invalidResponse');
  const full = response.full_sync === true || response.full_sync === 1;
  const user = response.user ?? previous.user;
  const next = { ...previous, cursor: response.sync_token, user: user ? { id: user.id, full_name: user.full_name } : null };
  for (const resource of ['items', 'projects', 'labels']) {
    if (!Array.isArray(response[resource])) throw new Error('invalidResponse');
    next[resource] = Object.assign(Object.create(null), full ? {} : previous[resource]);
    for (const item of response[resource]) {
      if (item?.id != null) next[resource][key(item.id)] = item;
    }
  }
  if (!next.user?.id) throw new Error('invalidResponse');
  if (previous.user?.id && key(previous.user.id) !== key(next.user.id)) throw new Error('accountChanged');
  return next;
}
export function remoteFields(item) {
  return {
    title: String(item.content ?? ''), notes: String(item.description ?? ''),
    priority: Math.max(0, Math.min(3, Number(item.priority || 1) - 1)),
    deadline: item.deadline?.date ?? null, completed: flag(item.checked),
  };
}
export function linked(task, accountId) {
  return task.todoist?.accountId === key(accountId) && !!task.todoist?.id;
}
function sourceMetadata(item, cache, settings) {
  return {
    accountId: key(cache.user.id), id: key(item.id), projectId: key(item.project_id),
    project: cache.projects[key(item.project_id)]?.name ?? '', labels: item.labels ?? [],
    due: item.due ?? null, recurring: !!item.due?.is_recurring,
    inScope: matches(item, settings, cache.projects), remoteDeleted: flag(item.is_deleted),
  };
}
export function importTask(item, cache, settings, now) {
  return {
    id: taskId(cache.user.id, item.id), ...remoteFields(item),
    date: null, startTime: '09:00', duration: item.duration?.unit === 'minute' ? item.duration.amount : 30,
    color: 'bg-red-500', subtasks: [], imported: false, importSource: 'todoist',
    lastModified: now,
    todoist: { ...sourceMetadata(item, cache, settings), base: remoteFields(item), conflicts: {} },
  };
}
export function reconcileTask(task, cache, settings, now) {
  if (!linked(task, cache.user.id)) return task;
  const item = cache.items[task.todoist.id];
  if (!item) return task; // Missing from a snapshot is NOT evidence of deletion/completion.
  const metadata = { ...task.todoist, ...sourceMetadata(item, cache, settings) };
  let result = { ...task, todoist: metadata };
  if (metadata.inScope && !metadata.remoteDeleted) {
    const remote = remoteFields(item);
    const base = task.todoist.base ?? remote;
    const conflicts = { ...task.todoist.conflicts };
    for (const field of Object.keys(remote)) {
      const local = task[field] ?? (field === 'deadline' ? null : remote[field]);
      if (local === remote[field]) delete conflicts[field];
      else if (local === base[field]) { result[field] = remote[field]; delete conflicts[field]; }
      else if (remote[field] !== base[field] || Object.hasOwn(conflicts, field)) conflicts[field] = remote[field];
    }
    if (result.completed && !task.completed) result.completedAt = item.completed_at ?? now;
    if (!result.completed && task.completed) result.completedAt = null;
    result.todoist = { ...metadata, base: remote, conflicts };
  }
  return JSON.stringify(result) === JSON.stringify(task) ? task : { ...result, lastModified: now };
}
export function additions(allTasks, cache, settings, blockedIds = new Set(), now) {
  const ids = new Set(allTasks.map(t => key(t.id)));
  const sources = new Set(allTasks.filter(t => linked(t, cache.user.id)).map(t => t.todoist.id));
  return Object.values(cache.items).filter(item => active(item) && matches(item, settings, cache.projects)
    && !ids.has(taskId(cache.user.id, item.id)) && !sources.has(key(item.id))
    && !blockedIds.has(taskId(cache.user.id, item.id)))
    .map(item => importTask(item, cache, settings, now));
}
export function writebackReason(task, cache, settings) {
  if (!settings.completionWriteback || !linked(task, cache.user.id) || !task.completed
    || task.todoist.base?.completed !== false) return 'none';
  const item = cache.items[task.todoist.id];
  if (!item || !active(item) || !matches(item, settings, cache.projects)) return 'outOfScope';
  if (item.due?.is_recurring) return 'recurring';
  // Closing a parent also closes descendants, including those outside the filter.
  if (Object.values(cache.items).some(child => active(child) && key(child.parent_id) === key(item.id))) return 'parent';
  if (item.responsible_uid && key(item.responsible_uid) !== key(cache.user.id)) return 'assignedElsewhere';
  return 'ready';
}
export function prepareOutbox(existing, tasks, cache, settings, uuid) {
  const byId = new Map(tasks.map(t => [key(t.id), t]));
  const queue = existing.filter(op => op.accountId === key(cache.user.id)
    && !flag(cache.items[op.args.id]?.checked) && !flag(cache.items[op.args.id]?.is_deleted));
  const queued = new Set(queue.map(op => op.localId));
  for (const task of tasks) {
    if (writebackReason(task, cache, settings) !== 'ready' || queued.has(key(task.id))) continue;
    queue.push({ uuid: uuid(), type: 'item_close', args: { id: task.todoist.id },
      accountId: key(cache.user.id), localId: key(task.id) });
    queued.add(key(task.id));
  }
  return {
    queue,
    send: queue.filter(op => byId.has(op.localId)
      && writebackReason(byId.get(op.localId), cache, settings) === 'ready').slice(0, 25),
  };
}
export function acknowledge(queue, sent, response) {
  const succeeded = new Set(sent.filter(op => response.sync_status?.[op.uuid] === 'ok').map(op => op.uuid));
  return { queue: queue.filter(op => !succeeded.has(op.uuid)),
    failed: sent.filter(op => !succeeded.has(op.uuid)), succeeded };
}
