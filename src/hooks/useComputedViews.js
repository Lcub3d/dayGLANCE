import { useMemo, useCallback } from 'react';
import { dateToString, extractTags } from '../utils/taskUtils.js';
import { notBucketed } from '../utils/bucketList.js';

export default function useComputedViews({
  tasks,
  unscheduledTasks,
  recurringTasks,
  selectedDate,
  selectedTags,
  inboxPriorityFilter,
  hideCompletedInbox,
  hideProjectTasksInbox,
  hideStandaloneTasksInbox,
  inboxTagFilter,
  inboxProjectFilter,
  projects,
  goalsProjectsEnabled,
  isVisibleForUser,
}) {
  // Tasks for the currently selected date
  const todayTasks = useMemo(
    () => tasks.filter(t => t.date === dateToString(selectedDate)),
    [tasks, selectedDate]
  );

  // All unique tags from all task sources (excludes imported events)
  const allTags = useMemo(() => {
    const tagSet = new Set();
    tasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    unscheduledTasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    recurringTasks.forEach(template => {
      extractTags(template.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks, unscheduledTasks, recurringTasks]);

  // Tags offered by the GLANCE tag-filter UIs. Bucket List items are excluded:
  // their tasks never appear in the filtered views, so a bucket-only tag would
  // be a filter option that matches nothing. allTags stays complete for the
  // #-autocomplete and AI context, where bucket vocabulary is useful.
  const filterableTags = useMemo(() => {
    const tagSet = new Set();
    tasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    unscheduledTasks.filter(t => !t.imported && notBucketed(t)).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    recurringTasks.forEach(template => {
      extractTags(template.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks, unscheduledTasks, recurringTasks]);

  // Incomplete scheduled tasks from today (used by rescheduling feature)
  const incompleteTodayTasks = useMemo(() => {
    const todayStr = dateToString(new Date());
    return tasks.filter(t => t.date === todayStr && !t.completed && !t.imported && !t.isExample);
  }, [tasks]);

  // Filter tasks by selected tags (OR logic - show tasks matching ANY selected tag)
  // Untagged tasks are always shown — the filter only scopes tagged tasks
  const filterByTags = useCallback((taskList) => {
    return taskList.filter(task => {
      const taskTags = extractTags(task.title);
      // Imported events and untagged tasks always shown
      if (task.imported || taskTags.length === 0) return true;
      // If no tags are selected, hide tagged tasks
      if (selectedTags.length === 0) return false;
      // Show tagged tasks only if they match a selected tag
      return selectedTags.some(tag => taskTags.includes(tag));
    });
  }, [selectedTags]);

  // A saved Inbox filter can name a project or tag that no longer exists (a
  // deleted project, a tag whose last task was renamed). Applying it verbatim
  // matches nothing while the filter's "active" dot still says a filter is on,
  // so the list reads as "all my tasks are gone" (#2137 review). Ignore the
  // stale selections at READ time instead of pruning the saved preference:
  // tasks and tags keep arriving after the first load (the Obsidian ingest, the
  // first sync apply), so a preference pruned before they land would
  // permanently drop a selection that was only temporarily unseen. The values
  // here are what the filter UIs should use for their "active" state; the
  // setters still own the saved preference.
  const liveInboxProjectFilter = useMemo(() => {
    const saved = inboxProjectFilter || [];
    if (saved.length === 0) return saved;
    const live = new Set((projects || []).map(project => String(project.id)));
    const kept = saved.filter(id => live.has(String(id)));
    return kept.length === saved.length ? saved : kept;
  }, [inboxProjectFilter, projects]);
  const liveInboxTagFilter = useMemo(() => {
    const saved = inboxTagFilter || [];
    if (saved.length === 0) return saved;
    const kept = saved.filter(tag => filterableTags.includes(tag));
    return kept.length === saved.length ? saved : kept;
  }, [inboxTagFilter, filterableTags]);

  // Inbox tasks filtered by priority and completion status.
  // When goalsProjectsEnabled, tasks tied to a project live on the dashboard
  // instead of the inbox — they get their own home in the project card.
  // hideProjectTasksInbox lets the user opt in to also seeing project tasks here.
  // If the feature is toggled off, the exclusion is lifted so nothing is hidden.
  const filteredUnscheduledTasks = useMemo(
    () => unscheduledTasks
      // Bucket List items never appear in the Inbox — unconditional (unlike
      // the user-toggleable project exclusion below). The Inbox nags; the
      // Bucket doesn't.
      .filter(notBucketed)
      .filter(task => !task.archived)
      // Multi-user: only show tasks assigned to "me" (or unassigned). Other
      // surfaces already filter via isVisibleForUser; the inbox list was the
      // one display path that didn't, so members saw each other's inbox tasks.
      .filter(task => isVisibleForUser(task))
      .filter(task => {
        if (!goalsProjectsEnabled) return true;
        // If specific projects are selected, show only tasks from those projects
        if (liveInboxProjectFilter.length > 0) return task.projectId && liveInboxProjectFilter.includes(task.projectId);
        // Otherwise apply type-level toggles
        if (hideProjectTasksInbox && task.projectId) return false;
        if (hideStandaloneTasksInbox && !task.projectId) return false;
        return true;
      })
      .filter(task => inboxPriorityFilter === 0 || (task.priority || 0) >= inboxPriorityFilter)
      .filter(task => !(task.completed && task.deadline))
      .filter(task => !hideCompletedInbox || !task.completed)
      .filter(task => {
        if (liveInboxTagFilter.length === 0) return true;
        const taskTags = extractTags(task.title);
        return liveInboxTagFilter.some(tag => taskTags.includes(tag));
      })
      .sort((a, b) => {
        // Completed tasks always sink below incomplete ones
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (b.priority || 0) - (a.priority || 0);
      }),
    [unscheduledTasks, inboxPriorityFilter, hideCompletedInbox, hideProjectTasksInbox,
     hideStandaloneTasksInbox, liveInboxTagFilter, liveInboxProjectFilter, goalsProjectsEnabled,
     isVisibleForUser]
  );

  // Today's tasks filtered by tag selection
  const filteredTodayTasks = useMemo(
    () => filterByTags(todayTasks),
    [filterByTags, todayTasks]
  );

  return {
    todayTasks,
    allTags,
    filterableTags,
    incompleteTodayTasks,
    filterByTags,
    filteredUnscheduledTasks,
    filteredTodayTasks,
    // What an "a filter is active" indicator should use: a saved selection whose
    // target no longer exists matches nothing and must not light it up.
    liveInboxTagFilter,
    liveInboxProjectFilter,
  };
}
