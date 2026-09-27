import { stripWikilinksAndTags } from '../utils/taskUtils.js';
import { planSnapshotOf } from './detector.js';

// Linking a new Do to a task from the editor's Title field. Pure: the view
// hands in the day's tasks and the Inbox, the editor shows the matches, and
// a pick links the Do to that task and its plan as it stands, the same
// capture the completion detector makes, so a manual Do and the task's later
// completion group as one execution.

const plain = (task) => stripWikilinksAndTags(task?.title ?? '').toLowerCase();

/**
 * What a new Do can link to: the selected day's tasks, then the Inbox. An
 * imported calendar event is not a task the user owns (a task calendar is),
 * and an archived Inbox item is out of play. One entry per id.
 */
export function doLinkCandidates({ dayTasks = [], inboxTasks = [] } = {}) {
  const seen = new Set();
  const out = [];
  const add = (task, where) => {
    if (!task?.id || seen.has(task.id)) return;
    if (task.imported && !task.isTaskCalendar) return;
    if (task.archived) return;
    seen.add(task.id);
    out.push({ task, where });
  };
  dayTasks.forEach((task) => add(task, 'plan'));
  inboxTasks.forEach((task) => add(task, 'inbox'));
  return out;
}

/**
 * Candidates whose title contains `query`, best first: a match at the start
 * of the title, then at the start of a word, then anywhere; open tasks before
 * completed ones; the day's plan before the Inbox. Two characters at least,
 * so a first keystroke does not open a list of everything.
 */
export function matchDoLinks(candidates, query, limit = 6) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  candidates.forEach((candidate, order) => {
    const title = plain(candidate.task);
    const at = title.indexOf(q);
    if (at < 0) return;
    const place = at === 0 ? 0 : /\s/.test(title[at - 1]) ? 1 : 2;
    scored.push({ candidate, key: [place, candidate.task.completed ? 1 : 0, candidate.where === 'plan' ? 0 : 1, order] });
  });
  scored.sort((a, b) => {
    for (let i = 0; i < a.key.length; i += 1) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return 0;
  });
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

/** What createManualDo takes to link a Do to `task`. */
export const linkFor = (task) => ({ task, planSnapshot: planSnapshotOf(task) });
