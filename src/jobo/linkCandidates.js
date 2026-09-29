import { stripWikilinksAndTags } from '../utils/taskUtils.js';
import { planSnapshotOf } from './detector.js';
import { getPartialTag, getFilteredTags, applyTagCompletion } from '../utils/suggestionParser.js';

// Linking a new Do to a task from the editor's Title field. Pure: the view
// hands in the day's tasks and the Inbox, the editor shows the matches, and
// a pick links the Do to that task and its plan as it stands, the same
// capture the completion detector makes, so a manual Do and the task's later
// completion group as one execution.

const plain = (task) => stripWikilinksAndTags(task?.title ?? '').toLowerCase();

/**
 * Where a task sits in Goals and Projects, for telling tasks apart in the
 * suggestions: its project's title and, when the project belongs to one, the
 * goal's. Null for a task with no project, or with one that no longer exists.
 */
export function projectPath(task, projects = [], goals = []) {
  if (!task?.projectId) return null;
  const project = projects.find((p) => p.id === task.projectId);
  if (!project) return null;
  const goal = project.goalId ? goals.find((g) => g.id === project.goalId) : null;
  return { project: project.title, goal: goal?.title ?? null };
}

/**
 * What a new Do can link to: the selected day's tasks, then the Inbox. An
 * imported calendar event is not a task the user owns (a task calendar is),
 * and an archived Inbox item is out of play. One entry per id. Pass
 * `projects` and `goals` (only when Goals and Projects is on) and each entry
 * carries its `path`.
 */
export function doLinkCandidates({ dayTasks = [], inboxTasks = [], projects = [], goals = [] } = {}) {
  const seen = new Set();
  const out = [];
  const add = (task, where) => {
    if (!task?.id || seen.has(task.id)) return;
    if (task.imported && !task.isTaskCalendar) return;
    if (task.archived) return;
    seen.add(task.id);
    out.push({ task, where, path: projectPath(task, projects, goals) });
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

/**
 * The app's tags to offer while a `#tag` is being typed at `cursor` in an
 * unlinked Do's title, as the new-task dialog offers them. Empty when the
 * cursor is not inside a tag.
 */
export function doTagSuggestions(title, cursor, allTags = [], limit = 8) {
  if (typeof title !== 'string' || !Number.isInteger(cursor)) return [];
  const partial = getPartialTag(title, cursor);
  return partial ? getFilteredTags(partial.tag, allTags).slice(0, limit) : [];
}

/**
 * Completes the tag at `cursor` with `tag`, then a space: added when none
 * follows, stepped over when one does, so completing mid-title never
 * leaves a double space.
 */
export function completeDoTag(title, cursor, tag) {
  const { text, newCursorPos } = applyTagCompletion(title, cursor, tag);
  if (/\s/.test(text[newCursorPos] ?? '')) return { title: text, cursor: newCursorPos + 1 };
  return { title: `${text.slice(0, newCursorPos)} ${text.slice(newCursorPos)}`, cursor: newCursorPos + 1 };
}
