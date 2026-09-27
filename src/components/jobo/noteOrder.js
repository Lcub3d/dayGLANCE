function clockMinutes(value) {
  if (typeof value !== 'string') return Number.POSITIVE_INFINITY;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? hours * 60 + minutes
    : Number.POSITIVE_INFINITY;
}

function taskKey(item) {
  const key = item?.noteKey ?? item?.currentTask?.id ?? item?.sourceTask?.id ?? item?.task?.id ?? item?.id;
  return key == null ? '' : String(key);
}

function itemDate(item, fallback = '') {
  return String(item?.plan?.date ?? item?.date ?? item?.currentTask?.date ?? item?.task?.date ?? fallback ?? '');
}

function itemMinute(item) {
  if (Number.isFinite(item?.startMinute)) return item.startMinute;
  return clockMinutes(item?.plan?.startTime ?? item?.startTime ?? item?.currentTask?.startTime ?? item?.task?.startTime);
}

function itemId(item) {
  return String(item?.id ?? taskKey(item));
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePosition(a, b) {
  const date = compareStrings(a.date, b.date);
  if (date) return date;
  const minute = a.minute - b.minute;
  if (Number.isFinite(minute) && minute) return minute;
  if (Number.isFinite(a.minute) !== Number.isFinite(b.minute)) return Number.isFinite(a.minute) ? -1 : 1;
  return compareStrings(a.id, b.id) || a.index - b.index;
}

function choosePlan(candidates) {
  return [...candidates].sort((a, b) => {
    // A live Plan is the source of truth for the Notes column. Historical
    // captures only determine the position when no live Plan exists.
    const historical = Number(Boolean(a.historical)) - Number(Boolean(b.historical));
    return historical || comparePosition(a, b);
  })[0] || null;
}

/**
 * Sort task note tiles by the final Plan column order.
 *
 * planItems may contain both current and captured Plans. For one note key we
 * choose the live item first, then sort by its rendered vertical position.
 * Notes without a live association fall back to a captured Plan position and
 * finally to their task date/time/id. The input order is only a last-resort
 * tie breaker, so opening notes cannot reorder the column.
 */
export function sortNoteTasks(tasks, planItems = [], fallbackDate = '') {
  const plansByKey = new Map();
  (Array.isArray(planItems) ? planItems : []).forEach((item, index) => {
    const key = taskKey(item);
    if (!key) return;
    const candidate = {
      ...item,
      date: itemDate(item, fallbackDate),
      minute: itemMinute(item),
      id: itemId(item),
      index,
    };
    const list = plansByKey.get(key) || [];
    list.push(candidate);
    plansByKey.set(key, list);
  });

  return [...(Array.isArray(tasks) ? tasks : [])]
    .map((task, index) => {
      const key = taskKey(task);
      const plan = choosePlan(plansByKey.get(key) || []);
      return {
        task,
        index,
        position: plan || {
          date: itemDate(task, fallbackDate),
          minute: itemMinute(task),
          id: key || itemId(task),
          index,
        },
        hasLivePlan: Boolean(plan && !plan.historical),
      };
    })
    .sort((a, b) => {
      // Notes attached to the current live Plan must occupy the same first-order
      // region as the Plan lane. Historical-only and unassociated notes are
      // useful context, but must not jump ahead because their old timestamp is
      // earlier than the current live task.
      if (a.hasLivePlan !== b.hasLivePlan) return a.hasLivePlan ? -1 : 1;
      return comparePosition(a.position, b.position);
    })
    .map(({ task }) => task);
}

export { clockMinutes };
