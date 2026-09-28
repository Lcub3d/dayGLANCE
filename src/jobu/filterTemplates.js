// Explicitly requested personal templates, copied from the user's saved queries.
// No account/project/filter IDs, task content, API tokens or live connection.
// Templates are read-only until saved as a personal editable copy.
export const FILTER_TEMPLATES = Object.freeze([
  { id: 'today', name: 'Todoist 今日', query: 'overdue, today', builtin: true, isFavorite: true, color: 'red' },
  { id: 'home', name: '首页', query: 'overdue | today,@进行, #收件箱', color: 'magenta' },
  { id: 'no-label', name: '无标签', query: 'no label' },
  { id: 'today-tasks', name: '今日任务', query: '今天&P1', isFavorite: true, color: 'red' },
  { id: 'today-goals', name: '今日目标', query: '今天&!p4', isFavorite: true, color: 'red' },
  { id: 'in-progress', name: '正在进行', query: '@进行', isFavorite: true, color: 'red' },
  { id: 'no-date', name: '无日期', query: 'no date' },
  { id: 'soon', name: '马上要做', query: 'due before: +3 hours', isFavorite: true, color: 'red' },
  { id: 'someday', name: '可能清单', query: 'no date&p4', isFavorite: true, color: 'magenta' },
  { id: 'waiting', name: '等待清单', query: 'p3', isFavorite: true, color: 'magenta' },
  { id: 'next-actions', name: '执行清单', query: 'no date&(p1|p2)', isFavorite: true, color: 'magenta' },
  { id: 'p1', name: '优先度p1', query: 'p1', color: 'red' },
  { id: 'p2', name: '优先度p2', query: 'p2' },
  { id: 'p4', name: '优先度p4', query: 'p4' },
  { id: 'overdue', name: '过期', query: 'overdue' },
  { id: 'today-unplanned', name: '今天待排', query: 'today & no time', isFavorite: true, color: 'violet' },
]);
