import { cleanTitle } from '../utils/suggestionParser.js';
import { toInboxCopy } from '../utils/inboxMove.js';
import { stripBucketId } from '../utils/bucketList.js';
import { stripSpans } from '../utils/quickAddParser.js';
import { dateToString, extractTags, formatDeadlineDate, completionTimestamp, stripWikilinks } from '../utils/taskUtils.js';
import { TASK_COLORS } from '../utils/colorUtils.js';
import { triggerHaptic } from '../native.js';
import {
  canGroupTask,
  isPlanGroupReadonly,
  MINUTES_PER_DAY,
  nextDeletionStamp,
  parsePlanTime,
  samePlanVersion,
  shiftedPlanStart,
} from '../jobo/planGroupActions.js';
import { validCivilDate } from '../jobo/viewDates.js';

// Strip a specific tag (e.g. "#obsidian") from a title string.
const stripTag = (title, tag) =>
  title.replace(new RegExp(`#${tag}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();

// Pure local helpers (no state dependencies)
const getNextQuarterHour = () => {
  const now = new Date();
  const minutes = now.getMinutes();
  const nextQuarter = Math.ceil(minutes / 15) * 15;
  if (nextQuarter === 60) {
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
  } else {
    now.setMinutes(nextQuarter);
  }
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

// PROVENANCE (see utils/retiredTaskIds.js): THIS site is the user-pressed
// delete. It knows INTENT — the user removed the task and there is no
// successor — so it writes deletedTaskIds, never retiredTaskIds (that channel
// belongs to the commit-that-renames, which knows a successor) and never
// deletedObsidianKeys (the vault-scan detector's observed-vanish channel).
const recordDeletedTaskTombstone = (taskId) => {
  const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
  tombstones[String(taskId)] = new Date().toISOString();
  localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
};

export default function useTaskActions({
  tasks, setTasks,
  unscheduledTasks, setUnscheduledTasks,
  recurringTasks, setRecurringTasks,
  recycleBin, setRecycleBin,
  completedTaskUids, setCompletedTaskUids,
  selectedDate,
  onboardingProgress, setOnboardingProgress,
  pushUndo,
  playUISound,
  parseRecurringId,
  getAdjustedTimeForImportedConflicts,
  newTask, setNewTask,
  setShowAddTask,
  setShowRecurrencePicker,
  expandedNotesTaskId, setExpandedNotesTaskId,
  setSyncNotification,
  setUndoToast,
  setShowColorPicker,
  setShowDeadlinePicker,
  recurringDeleteConfirm, setRecurringDeleteConfirm,
  hoverPreviewTime, hoverPreviewDate, setHoverPreviewTime, setHoverPreviewDate,
  swipeSchedulingInboxTaskId,
  syncTaskCompletionToCalDAV,
  computeAvailableSlots,
  activeFrameNudgeKey, setFrameNudgeDismissedKey,
  frameScheduleModal, setFrameScheduleModal,
  focusBlockTasks, setFocusBlockTasks,
  focusCompletedTasks, setFocusCompletedTasks,
  exitFocusModeRef,
  playFocusSound,
  // Obsidian integration.
  // getObsidianTaskMeta(rawTitle) → { id, importSource, obsidianRawTitle, obsidianFileDate, obsidianBlockId }
  // Used synchronously at task-creation time so the task gets the obsidian-format
  // ID from the start, letting the next periodic sync de-duplicate instead of cloning.
  getObsidianTaskMeta,
  onWriteObsidianTask,
}) {
  const colors = TASK_COLORS;

  // Helper to update a recurring task template by ID
  const updateRecurringTemplate = (taskId, updater) => {
    const parsed = parseRecurringId(taskId);
    if (parsed) {
      setRecurringTasks(prev => prev.map(t => t.id === parsed.templateId ? { ...updater(t), lastModified: new Date().toISOString() } : t));
    }
  };

  // ── Deadline management ──────────────────────────────────────────────────

  const setDeadline = (taskId, deadline) => {
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline } : t
    ));
    setShowDeadlinePicker(null);
    if (!onboardingProgress.hasAddedDeadline) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedDeadline: true }));
    }
  };

  const postponeDeadlineTask = (taskId) => {
    const task = unscheduledTasks.find(t => t.id === taskId);
    if (!task || !task.deadline) return;
    const nextDay = new Date(task.deadline + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: nextDateStr } : t
    ));
    setUndoToast({ message: 'Deadline postponed to ' + formatDeadlineDate(nextDateStr), actionable: true });
    playUISound('slide');
  };

  const clearDeadline = (taskId) => {
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: null } : t
    ));
    setShowDeadlinePicker(null);
  };

  // ── Task creation ────────────────────────────────────────────────────────

  // JOBO's direct Plan creation path.  The modal-oriented addTask below reads
  // `newTask` and intentionally rejects an empty title; this explicit handler
  // receives a complete ordinary scheduled task from the JOBO adapter, keeps
  // the same native conflict/undo/audio behavior, and returns the exact task
  // synchronously so the view can begin inline title editing.
  const createTimelineTask = ({
    id = crypto.randomUUID(),
    title = '',
    date: requestedDate,
    startTime: requestedStartTime,
    duration = 30,
    color,
    notes = '',
    subtasks = [],
    projectId,
    assignedUserSyncIds,
    priority,
  } = {}) => {
    const taskDate = requestedDate || dateToString(selectedDate);
    const startTime = requestedStartTime || getNextQuarterHour();
    if (typeof title !== 'string') throw new TypeError('title must be a string');
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      throw new TypeError('duration must be a positive number');
    }

    const { conflicted, adjustedStartTime, conflictingEvent } = typeof getAdjustedTimeForImportedConflicts === 'function'
      ? getAdjustedTimeForImportedConflicts(id, startTime, duration, taskDate)
      : { conflicted: false, adjustedStartTime: startTime, conflictingEvent: null };
    const task = {
      id,
      title,
      duration,
      color: color || colors[0].class,
      completed: false,
      isAllDay: false,
      notes: typeof notes === 'string' ? notes : '',
      subtasks: Array.isArray(subtasks)
        ? subtasks.map((subtask) => ({ ...subtask, id: crypto.randomUUID(), completed: false }))
        : [],
      date: taskDate,
      startTime: adjustedStartTime,
      lastModified: new Date().toISOString(),
      ...(projectId !== undefined && projectId !== null && projectId !== '' ? { projectId } : {}),
      ...(Array.isArray(assignedUserSyncIds) && assignedUserSyncIds.length
        ? { assignedUserSyncIds: [...assignedUserSyncIds] } : {}),
      ...(priority !== undefined ? { priority } : {}),
    };

    pushUndo();
    setTasks(prev => prev.some(row => row.id === task.id) ? prev : [...prev, task]);
    if (conflicted && conflictingEvent) {
      setSyncNotification({
        type: 'info',
        title: 'Task Rescheduled',
        message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`,
      });
    }
    if (onboardingProgress && !onboardingProgress.hasAddedScheduledTask && typeof setOnboardingProgress === 'function') {
      setOnboardingProgress(prev => ({ ...prev, hasAddedScheduledTask: true }));
    }
    if (typeof playUISound === 'function') playUISound('pop');
    return task;
  };

  const addTask = (toInbox = false) => {
    if (newTask.title.trim()) {
      pushUndo();

      // Remove natural-language phrases the quick-add layer parsed into task
      // fields ("tomorrow 3pm every 2 weeks"); their values already live on
      // newTask. Dismissed chips are not in nlSpans, so their text survives.
      // cleanTitle then strips sigil shorthand as before.
      const savedTitle = cleanTitle(stripSpans(newTask.title, newTask.nlSpans));

      // Determine whether this task should be linked to an Obsidian daily note.
      // Recurring and swipe-scheduling paths are excluded: recurring tasks use
      // their own ID scheme; swipe-scheduling preserves an existing task's ID.
      const tags = extractTags(newTask.title);
      const hasObsidianTag = tags.includes('obsidian');
      const isRecurring = !!newTask.recurrence;
      const isSwipeSchedule = !!swipeSchedulingInboxTaskId.current;
      const rawObsidianTitle = hasObsidianTag ? stripTag(savedTitle, 'obsidian') : null;
      // Skip if stripping the tag leaves an empty title (e.g. task titled only "#obsidian")
      const obsidianMeta = (hasObsidianTag && rawObsidianTitle && !isRecurring && !isSwipeSchedule && getObsidianTaskMeta)
        ? getObsidianTaskMeta(rawObsidianTitle, newTask.projectId)
        : null;

      const taskId = obsidianMeta?.id ?? crypto.randomUUID();
      // Tracks the conflict-adjusted start time set by the scheduled branch so the
      // vault write uses the same time that ends up in DG state, not the raw input.
      let scheduledAdjustedStartTime = newTask.startTime || null;
      const task = {
        id: taskId,
        title: savedTitle,
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        completed: false,
        isAllDay: newTask.isAllDay || false,
        notes: '',
        subtasks: [],
        ...(obsidianMeta ?? {}),
        ...(newTask.projectId ? { projectId: newTask.projectId } : {}),
        ...(newTask.assignedUserSyncIds?.length ? { assignedUserSyncIds: newTask.assignedUserSyncIds } : {}),
      };

      if (toInbox) {
        const inboxTask = { ...task, priority: newTask.priority ?? 0 };
        if (newTask.deadline) {
          inboxTask.deadline = newTask.deadline;
        }
        setUnscheduledTasks(prev => [...prev, inboxTask]);
      } else if (newTask.keepUnscheduled && newTask.projectId) {
        // Save as unscheduled project task (no scheduling)
        setUnscheduledTasks(prev => [...prev, task]);
      } else if (newTask.recurrence) {
        // Create recurring task template
        const taskDate = newTask.date || dateToString(selectedDate);
        const template = {
          id: taskId,
          title: savedTitle,
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          duration: newTask.duration,
          color: newTask.color || colors[0].class,
          isAllDay: newTask.isAllDay || false,
          notes: '',
          subtasks: [],
          recurrence: { ...newTask.recurrence, startDate: taskDate },
          completedDates: [],
          exceptions: {},
          // Project membership is series-level too: it lives on the template so
          // every materialised instance inherits it (same rule as assignment).
          ...(newTask.projectId ? { projectId: newTask.projectId } : {}),
          // User assignment on recurring tasks is series-level: it lives on the
          // template so every materialised instance inherits it.
          ...(newTask.assignedUserSyncIds?.length ? { assignedUserSyncIds: newTask.assignedUserSyncIds } : {}),
          lastModified: new Date().toISOString()
        };
        setRecurringTasks(prev => [...prev, template]);
        if (!onboardingProgress.hasCreatedRecurring) {
          setOnboardingProgress(prev => ({ ...prev, hasCreatedRecurring: true }));
        }
      } else if (swipeSchedulingInboxTaskId.current) {
        // Scheduling from inbox swipe: move existing task (preserve ID, notes, subtasks)
        const inboxId = swipeSchedulingInboxTaskId.current;
        const inboxTask = unscheduledTasks.find(t => t.id === inboxId);
        swipeSchedulingInboxTaskId.current = null;
        if (inboxTask) {
          const requestedStartTime = newTask.isAllDay ? '00:00' : newTask.startTime;
          const taskDate = newTask.date || dateToString(selectedDate);
          const { conflicted, adjustedStartTime, conflictingEvent } = newTask.isAllDay
            ? { conflicted: false, adjustedStartTime: requestedStartTime, conflictingEvent: null }
            : getAdjustedTimeForImportedConflicts(inboxTask.id, requestedStartTime, newTask.duration, taskDate);
          const { priority, deadline, ...preserved } = inboxTask;
          setTasks(prev => [...prev, {
            ...preserved,
            title: savedTitle,
            duration: newTask.duration,
            color: newTask.color || colors[0].class,
            isAllDay: newTask.isAllDay || false,
            startTime: adjustedStartTime,
            date: taskDate
          }]);
          setUnscheduledTasks(prev => prev.filter(t => t.id !== inboxId));
          if (conflicted && conflictingEvent) {
            setSyncNotification({
              type: 'info',
              title: 'Task Rescheduled',
              message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`
            });
          }
          if (!onboardingProgress.hasDraggedToTimeline) {
            setOnboardingProgress(prev => ({ ...prev, hasDraggedToTimeline: true }));
          }
        }
      } else {
        const requestedStartTime = newTask.isAllDay ? '00:00' : newTask.startTime;
        const taskDate = newTask.date || dateToString(selectedDate);

        const { conflicted, adjustedStartTime, conflictingEvent } = newTask.isAllDay
          ? { conflicted: false, adjustedStartTime: requestedStartTime, conflictingEvent: null }
          : getAdjustedTimeForImportedConflicts(taskId, requestedStartTime, newTask.duration, taskDate);

        scheduledAdjustedStartTime = adjustedStartTime;
        setTasks(prev => [...prev, {
          ...task,
          startTime: adjustedStartTime,
          date: taskDate
        }]);

        if (conflicted && conflictingEvent) {
          setSyncNotification({
            type: 'info',
            title: 'Task Rescheduled',
            message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`
          });
        }
      }

      // If the task is tagged #obsidian, write it to today's daily note.
      // blockId rides along so the appended line carries the same ^dg- id the
      // app task was just created with (Phase 2 round-trip identity).
      if (obsidianMeta && onWriteObsidianTask) {
        onWriteObsidianTask({
          // The raw title as the identity was derived from it: with the
          // project field when the task was created under a project.
          title: obsidianMeta.obsidianRawTitle ?? rawObsidianTitle,
          startTime: toInbox || newTask.isAllDay ? null : scheduledAdjustedStartTime,
          duration: toInbox ? null : (newTask.duration || null),
          isAllDay: !toInbox && (newTask.isAllDay || false),
          date: toInbox ? null : (newTask.date || dateToString(selectedDate)),
          blockId: obsidianMeta.obsidianBlockId,
        });
      }

      setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 30, date: dateToString(selectedDate), isAllDay: false, recurrence: null });
      setShowAddTask(false);

      if (toInbox && !onboardingProgress.hasAddedInboxTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedInboxTask: true }));
      }
      if (!toInbox && !onboardingProgress.hasAddedScheduledTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedScheduledTask: true }));
      }
      if (!onboardingProgress.hasUsedTags && extractTags(newTask.title).length > 0) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedTags: true }));
      }
      playUISound('pop');
    }
  };

  const openNewTaskForm = () => {
    setNewTask({
      title: '',
      startTime: hoverPreviewTime || getNextQuarterHour(),
      duration: 30,
      date: hoverPreviewDate ? dateToString(hoverPreviewDate) : dateToString(selectedDate),
      isAllDay: false,
      recurrence: null
    });
    setHoverPreviewTime(null);
    setHoverPreviewDate(null);
    setShowRecurrencePicker(false);
    setShowAddTask(true);
  };

  // Date-header tap in every timeline view (MULTI/DAY/WEEK/SCHED and the
  // mobile header): a new scheduled task on that day, "All Day" pre-selected.
  const openNewAllDayTask = (dateStr) => {
    setNewTask({
      title: '',
      startTime: getNextQuarterHour(),
      duration: 30,
      date: dateStr,
      isAllDay: true,
      recurrence: null
    });
    setShowRecurrencePicker(false);
    setShowAddTask(true);
  };

  const openNewInboxTask = () => {
    setNewTask({
      title: '',
      startTime: getNextQuarterHour(),
      duration: 30,
      date: dateToString(selectedDate),
      isAllDay: false,
      openInInbox: true,
      deadline: null,
      priority: 0
    });
    setShowAddTask(true);
  };

  // ── Task update ──────────────────────────────────────────────────────────

  // Energy-axis override (summary strip): 'restore' | 'effort' | null (null =
  // back to auto-derivation, see utils/energyAxis.js). Same routing as
  // changeTaskColor: a recurring instance stores the override on its SERIES —
  // energy is a property of the block's nature, which recurs with it.
  const setTaskEnergy = (taskId, energy, fromInbox = false) => {
    pushUndo();
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, energy: energy ?? undefined, lastModified: new Date().toISOString() } : t
        ));
      }
      return;
    }
    const apply = (task) => (task.id === taskId ? { ...task, energy: energy ?? undefined } : task);
    if (fromInbox) setUnscheduledTasks(prev => prev.map(apply));
    else setTasks(prev => prev.map(apply));
  };

  const changeTaskColor = (taskId, newColor, fromInbox = false) => {
    pushUndo();
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, color: newColor, lastModified: new Date().toISOString() } : t
        ));
      }
      setShowColorPicker(null);
      return;
    }

    if (fromInbox) {
      setUnscheduledTasks(prev => prev.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    } else {
      setTasks(prev => prev.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    }
    setShowColorPicker(null);
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const updateTaskNotes = (taskId, notes, isInbox) => {
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, notes, lastModified: new Date().toISOString() } : t
        ));
      }
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    }
    if (!onboardingProgress.hasAddedNotes && notes && notes.trim()) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
  };

  const updateRecurrencePattern = (templateId, dateStr, newRecurrence) => {
    setRecurringTasks(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      const origStart = t.recurrence.startDate;
      const earlierDate = origStart <= dateStr ? origStart : dateStr;
      const newStart = earlierDate.substring(0, 8) + '01';
      return { ...t, recurrence: { ...newRecurrence, startDate: newStart }, lastModified: new Date().toISOString() };
    }));
  };

  const updateRecurrenceEndCondition = (templateId, { endDate, maxOccurrences }) => {
    setRecurringTasks(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      const updated = { ...t.recurrence };
      delete updated.endDate;
      delete updated.maxOccurrences;
      if (endDate) updated.endDate = endDate;
      if (maxOccurrences) updated.maxOccurrences = maxOccurrences;
      return { ...t, recurrence: updated, lastModified: new Date().toISOString() };
    }));
  };

  // ── Task completion ──────────────────────────────────────────────────────

  const toggleComplete = (id, fromInbox = false) => {
    pushUndo();
    playUISound('tick');
    triggerHaptic('medium');
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const { templateId, dateStr } = parseRecurringId(id);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== templateId) return t;
        const completed = (t.completedDates || []).includes(dateStr);
        return {
          ...t,
          completedDates: completed
            ? (t.completedDates || []).filter(d => d !== dateStr)
            : [...(t.completedDates || []), dateStr],
          // Stamp the toggled occurrence so sync resolves this complete/un-complete
          // by last-writer-wins per date instead of letting a concurrent series
          // edit clobber it (completedDates is unioned across devices on merge).
          completedDatesTimestamps: { ...(t.completedDatesTimestamps || {}), [dateStr]: new Date().toISOString() },
          lastModified: new Date().toISOString()
        };
      }));
      if (!onboardingProgress.hasCompletedTask) {
        setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
      }
      const wasCompleted = recurringTasks.find(t => t.id === templateId)?.completedDates?.includes(dateStr);
      if (!wasCompleted) {
        setUndoToast({ message: 'Task completed', actionable: true });
      }
      return;
    }

    const taskToToggle = fromInbox
      ? unscheduledTasks.find(t => t.id === id)
      : tasks.find(t => t.id === id);
    if (!onboardingProgress.hasCompletedTask && taskToToggle && !taskToToggle.completed) {
      setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
    }

    if (fromInbox) {
      setUnscheduledTasks(prev => prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed, completedAt: !task.completed ? completionTimestamp() : null, transitionId: crypto.randomUUID() } : task
      ));
    } else {
      const task = tasks.find(t => t.id === id);
      if (task?.isTaskCalendar && task?.icalUid) {
        const completionKey = task.icalUid + '::' + task.date;
        const newCompleted = !task.completed;
        setCompletedTaskUids(prev => {
          const newSet = new Set(prev);
          if (task.completed) {
            newSet.delete(completionKey);
          } else {
            newSet.add(completionKey);
          }
          return newSet;
        });
        syncTaskCompletionToCalDAV(task.icalUid, newCompleted, {
          isRecurring: task.isRecurringSeries,
          date: task.date,
          startTime: task.startTime,
          isAllDay: task.isAllDay
        });
      }
      // completedAt on the scheduled branch is NEW (it deliberately didn't
      // set one for years — the flip is pinned in taskMutations.pinning
      // .test.js): the Obsidian completion marker regenerates from this
      // stored value, so the app must record what it intends to write.
      setTasks(prev => prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed, completedAt: !task.completed ? completionTimestamp() : null, transitionId: crypto.randomUUID() } : task
      ));
    }
    if (taskToToggle && !taskToToggle.completed) {
      setUndoToast({ message: 'Task completed', actionable: true });
    }
  };

  // ── Task move ────────────────────────────────────────────────────────────

  const postponeTask = (id) => {
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const parsed = parseRecurringId(id);
      if (!parsed) return;
      const template = recurringTasks.find(t => t.id === parsed.templateId);
      if (!template) return;
      if (template.recurrence?.type === 'daily') return; // daily tasks recur tomorrow anyway
      const exc = template.exceptions?.[parsed.dateStr] || {};
      const title = exc.title || template.title;
      const startTime = exc.startTime !== undefined ? exc.startTime : (template.startTime || '');
      const duration = exc.duration !== undefined ? exc.duration : (template.duration ?? 30);
      const color = exc.color || template.color;
      const isAllDay = exc.isAllDay !== undefined ? exc.isAllDay : (template.isAllDay ?? false);
      if (!startTime && !isAllDay) return;
      const nextDay = new Date(parsed.dateStr + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDateStr = dateToString(nextDay);
      pushUndo();
      setRecurringTasks(prev => prev.map(t => t.id !== parsed.templateId ? t : {
        ...t,
        exceptions: { ...t.exceptions, [parsed.dateStr]: { ...(t.exceptions?.[parsed.dateStr] || {}), skipped: true } },
        lastModified: new Date().toISOString()
      }));
      setTasks(prev => [...prev, {
        id: crypto.randomUUID(), title,
        startTime: isAllDay ? '00:00' : startTime, duration, color,
        isAllDay, date: nextDateStr, completed: false, notes: '', subtasks: [],
      }]);
      setUndoToast({ message: 'Task postponed to tomorrow', actionable: true });
      playUISound('slide');
      return;
    }
    const task = tasks.find(t => t.id === id);
    if (!task || !task.startTime || !task.date) return;

    const nextDay = new Date(task.date + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];

    const { conflicted, conflictingEvent } = getAdjustedTimeForImportedConflicts(
      id, task.startTime, task.duration, nextDateStr
    );

    if (conflicted) {
      playUISound('error');
      setSyncNotification({
        type: 'error',
        title: "Can't Postpone",
        message: `Time slot conflicts with "${conflictingEvent?.title || 'a calendar event'}" on ${nextDateStr}`
      });
      return;
    }

    pushUndo();
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, date: nextDateStr } : t
    ));
    setUndoToast({ message: 'Task postponed to tomorrow', actionable: true });
    playUISound('slide');
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  // ── JOBO Plan group actions ─────────────────────────────────────────────
  // The view passes the exact native task object used to render each Plan.  A
  // group is accepted only after every row has been checked against the live
  // task/template collection.  This keeps a stale selection from applying
  // half of a move before the other half is discovered.
  const recurringInstanceInfo = (task) => {
    let parsed = typeof parseRecurringId === 'function' ? parseRecurringId(task?.id) : null;
    if (!parsed && typeof task?.id === 'string' && task.id.startsWith('recurring-')) {
      const parts = task.id.split('-');
      if (parts.length >= 5) {
        const dateStr = parts.slice(-3).join('-');
        const rawTemplateId = parts.slice(1, -3).join('-');
        parsed = { templateId: /^\d+$/.test(rawTemplateId) ? Number(rawTemplateId) : rawTemplateId, dateStr };
      }
    }
    if (parsed) return parsed;
    if (task?.recurringTemplateId != null && task?.date) {
      return { templateId: task.recurringTemplateId, dateStr: task.date };
    }
    return null;
  };

  const sameTemplateVersion = (template, requested) => {
    if (!template || !requested) return false;
    for (const key of ['version', 'lastModified', 'updatedAt']) {
      // Expanded recurring instances in the scheduler do not carry the
      // template's stamp.  When both sides expose one, however, it is an
      // optimistic version and must match exactly.
      if (Object.prototype.hasOwnProperty.call(template, key)
        && Object.prototype.hasOwnProperty.call(requested, key)
        && template[key] !== requested[key]) return false;
    }
    return true;
  };

  const samePlanShape = (current, requested) => current?.date === requested?.date
    && current?.startTime === requested?.startTime
    && Number(current?.duration) === Number(requested?.duration)
    && Boolean(current?.isAllDay) === Boolean(requested?.isAllDay);

  const normalizeTimelineInterval = (interval) => {
    if (!interval || typeof interval.startTime !== 'string'
      || typeof interval.duration !== 'number'
      || !Number.isInteger(interval.duration) || interval.duration <= 0) return null;
    const startMinute = parsePlanTime(interval.startTime);
    if (startMinute == null || startMinute + interval.duration > MINUTES_PER_DAY) return null;
    return { startTime: interval.startTime, duration: interval.duration };
  };

  const effectiveRecurringOccurrence = (template, dateStr) => {
    const exception = template?.exceptions?.[dateStr] || {};
    return {
      exception,
      startTime: exception.startTime !== undefined ? exception.startTime : template?.startTime,
      duration: exception.duration !== undefined ? exception.duration : (template?.duration ?? 30),
      isAllDay: exception.isAllDay !== undefined ? exception.isAllDay : (template?.isAllDay ?? false),
    };
  };

  const prepareTimelineGroup = (requestedTasks, { deltaMinutes = null } = {}) => {
    if (!Array.isArray(requestedTasks) || requestedTasks.length === 0) return null;
    if (deltaMinutes !== null && (!Number.isInteger(deltaMinutes) || deltaMinutes === 0)) return null;

    const ids = new Set();
    const recurringKeys = new Set();
    const prepared = [];
    let groupDate = null;

    for (const requested of requestedTasks) {
      if (!canGroupTask(requested) || isPlanGroupReadonly(requested)) return null;
      const idKey = String(requested.id);
      if (ids.has(idKey)) return null;
      ids.add(idKey);
      if (typeof requested.date !== 'string' || !requested.date) return null;
      if (groupDate === null) groupDate = requested.date;
      if (requested.date !== groupDate) return null;

      const recurring = recurringInstanceInfo(requested);
      if (recurring) {
        if (recurring.dateStr !== requested.date) return null;
        const recurringKey = `${String(recurring.templateId)}::${recurring.dateStr}`;
        if (recurringKeys.has(recurringKey)) return null;
        recurringKeys.add(recurringKey);
        const template = (Array.isArray(recurringTasks) ? recurringTasks : [])
          .find(candidate => String(candidate?.id) === String(recurring.templateId));
        if (!template || isPlanGroupReadonly(template) || !sameTemplateVersion(template, requested)) return null;
        const occurrence = effectiveRecurringOccurrence(template, recurring.dateStr);
        if (occurrence.exception.deleted || occurrence.isAllDay) return null;
        if (requested.startTime !== occurrence.startTime
          || Number(requested.duration) !== Number(occurrence.duration)) return null;
        const nextStartTime = deltaMinutes === null
          ? requested.startTime
          : shiftedPlanStart({ ...requested, startTime: occurrence.startTime, duration: occurrence.duration }, deltaMinutes);
        if (!nextStartTime) return null;
        prepared.push({ kind: 'recurring', requested, template, dateStr: recurring.dateStr, nextStartTime });
        continue;
      }

      const current = (Array.isArray(tasks) ? tasks : [])
        .find(candidate => String(candidate?.id) === idKey);
      if (!current || !samePlanVersion(current, requested) || !samePlanShape(current, requested)
        || !canGroupTask(current) || current.date !== groupDate) return null;
      if (current.isAllDay || typeof current.startTime !== 'string') return null;
      const nextStartTime = deltaMinutes === null
        ? current.startTime
        : shiftedPlanStart(current, deltaMinutes);
      if (!nextStartTime) return null;
      prepared.push({ kind: 'ordinary', requested, current, nextStartTime });
    }

    return prepared;
  };

  const freshTaskStamp = (previous, now) => {
    const prior = typeof previous === 'string' ? Date.parse(previous) : NaN;
    const floor = Number.isFinite(prior) ? prior + 1 : 0;
    const stamp = Math.max(now.value, floor);
    now.value = stamp + 1;
    return new Date(stamp).toISOString();
  };

  const moveTimelineTasks = (requestedTasks, deltaMinutes) => {
    const prepared = prepareTimelineGroup(requestedTasks, { deltaMinutes });
    if (!prepared) return false;
    const ordinary = prepared.filter(entry => entry.kind === 'ordinary');
    const recurring = prepared.filter(entry => entry.kind === 'recurring');
    if (ordinary.length && typeof setTasks !== 'function') return false;
    if (recurring.length && typeof setRecurringTasks !== 'function') return false;

    // Generate transition IDs once per accepted operation.  They are kept on
    // the original rows, matching the single-task drag path; no task identity
    // or user data is reconstructed during a group move.
    const transitionIds = new Map(ordinary.map(entry => [String(entry.current.id),
      typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : undefined]));
    const moveNow = { value: Date.now() };
    const moveStamps = new Map(ordinary.map(entry => [String(entry.current.id),
      freshTaskStamp(entry.current.lastModified, moveNow)]));
    pushUndo();

    if (ordinary.length) {
      const byId = new Map(ordinary.map(entry => [String(entry.current.id), entry]));
      setTasks(prev => {
        const rows = Array.isArray(prev) ? prev : [];
        if (!ordinary.every(entry => {
          const current = rows.find(row => String(row?.id) === String(entry.current.id));
          return current && samePlanVersion(current, entry.requested) && samePlanShape(current, entry.requested);
        })) return prev;
        return rows.map(row => {
          const entry = byId.get(String(row?.id));
          if (!entry) return row;
          const transitionId = transitionIds.get(String(row.id));
          const moved = { ...row, startTime: entry.nextStartTime, lastModified: moveStamps.get(String(row.id)) };
          return transitionId ? { ...moved, transitionId } : moved;
        });
      });
    }

    if (recurring.length) {
      const byTemplate = new Map();
      for (const entry of recurring) {
        const key = String(entry.template.id);
        if (!byTemplate.has(key)) byTemplate.set(key, []);
        byTemplate.get(key).push(entry);
      }
      const now = { value: Date.now() };
      setRecurringTasks(prev => {
        const rows = Array.isArray(prev) ? prev : [];
        if (![...byTemplate.values()].every(entries => {
          const template = rows.find(row => String(row?.id) === String(entries[0].template.id));
          return template && sameTemplateVersion(template, entries[0].requested);
        })) return prev;
        return rows.map(template => {
          const entries = byTemplate.get(String(template?.id));
          if (!entries) return template;
          const exceptions = { ...(template.exceptions || {}) };
          for (const entry of entries) {
            exceptions[entry.dateStr] = {
              ...(exceptions[entry.dateStr] || {}),
              startTime: entry.nextStartTime,
            };
          }
          return { ...template, exceptions, lastModified: freshTaskStamp(template.lastModified, now) };
        });
      });
    }

    if (typeof playUISound === 'function') playUISound('drop');
    return true;
  };

  const resizeTimelineTask = (requestedTask, interval) => {
    const nextInterval = normalizeTimelineInterval(interval);
    if (!nextInterval || !canGroupTask(requestedTask) || isPlanGroupReadonly(requestedTask)
      || typeof requestedTask.date !== 'string' || !validCivilDate(requestedTask.date)) return false;

    const recurring = recurringInstanceInfo(requestedTask);
    if (recurring) {
      if (recurring.dateStr !== requestedTask.date) return false;
      const template = (Array.isArray(recurringTasks) ? recurringTasks : [])
        .find(candidate => String(candidate?.id) === String(recurring.templateId));
      if (!template || isPlanGroupReadonly(template) || !sameTemplateVersion(template, requestedTask)) return false;
      const occurrence = effectiveRecurringOccurrence(template, recurring.dateStr);
      if (occurrence.exception.deleted || occurrence.isAllDay
        || requestedTask.startTime !== occurrence.startTime
        || Number(requestedTask.duration) !== Number(occurrence.duration)) return false;
      if (nextInterval.startTime === occurrence.startTime
        && nextInterval.duration === Number(occurrence.duration)) return false;
      if (typeof setRecurringTasks !== 'function') return false;

      const stamp = freshTaskStamp(template.lastModified, { value: Date.now() });
      pushUndo();
      setRecurringTasks(prev => {
        const rows = Array.isArray(prev) ? prev : [];
        const liveTemplate = rows.find(row => String(row?.id) === String(template.id));
        if (!liveTemplate || isPlanGroupReadonly(liveTemplate)
          || !sameTemplateVersion(liveTemplate, requestedTask)) return prev;
        const liveOccurrence = effectiveRecurringOccurrence(liveTemplate, recurring.dateStr);
        if (liveOccurrence.exception.deleted || liveOccurrence.isAllDay
          || requestedTask.startTime !== liveOccurrence.startTime
          || Number(requestedTask.duration) !== Number(liveOccurrence.duration)) return prev;
        return rows.map(row => {
          if (String(row?.id) !== String(template.id)) return row;
          const exceptions = { ...(row.exceptions || {}) };
          exceptions[recurring.dateStr] = {
            ...(exceptions[recurring.dateStr] || {}),
            startTime: nextInterval.startTime,
            duration: nextInterval.duration,
          };
          return { ...row, exceptions, lastModified: stamp };
        });
      });
    } else {
      const current = (Array.isArray(tasks) ? tasks : [])
        .find(candidate => String(candidate?.id) === String(requestedTask.id));
      if (!current || !validCivilDate(current.date) || !samePlanVersion(current, requestedTask)
        || !samePlanShape(current, requestedTask) || !canGroupTask(current)
        || isPlanGroupReadonly(current) || current.date !== requestedTask.date
        || current.isAllDay || typeof current.startTime !== 'string') return false;
      if (nextInterval.startTime === current.startTime
        && nextInterval.duration === Number(current.duration)) return false;
      if (typeof setTasks !== 'function') return false;

      const stamp = freshTaskStamp(current.lastModified, { value: Date.now() });
      const transitionId = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID() : undefined;
      pushUndo();
      setTasks(prev => {
        const rows = Array.isArray(prev) ? prev : [];
        const live = rows.find(row => String(row?.id) === String(current.id));
        if (!live || !samePlanVersion(live, requestedTask) || !samePlanShape(live, requestedTask)
          || !canGroupTask(live) || isPlanGroupReadonly(live) || live.date !== requestedTask.date
          || live.isAllDay || typeof live.startTime !== 'string') return prev;
        return rows.map(row => {
          if (String(row?.id) !== String(current.id)) return row;
          const resized = { ...row, startTime: nextInterval.startTime, duration: nextInterval.duration, lastModified: stamp };
          return transitionId ? { ...resized, transitionId } : resized;
        });
      });
    }

    if (typeof playUISound === 'function') playUISound('drop');
    return true;
  };

  const deleteTimelineTasks = (requestedTasks) => {
    const prepared = prepareTimelineGroup(requestedTasks);
    if (!prepared) return false;
    const ordinary = prepared.filter(entry => entry.kind === 'ordinary');
    const recurring = prepared.filter(entry => entry.kind === 'recurring');
    if (ordinary.length && (typeof setTasks !== 'function' || typeof setRecycleBin !== 'function')) return false;
    if (recurring.length && typeof setRecurringTasks !== 'function') return false;

    const now = { value: Date.now() };
    const recycleEntries = ordinary.map(entry => {
      const stamp = nextDeletionStamp(entry.current.lastModified, now.value);
      now.value = Math.max(now.value, Date.parse(stamp) + 1);
      return {
        ...entry.current,
        _deletedFrom: 'calendar',
        deletedAt: stamp,
        lastModified: stamp,
      };
    });
    pushUndo();

    if (ordinary.length) {
      const ids = new Set(ordinary.map(entry => String(entry.current.id)));
      setRecycleBin(prev => [...(Array.isArray(prev) ? prev : []), ...recycleEntries]);
      setTasks(prev => {
        const rows = Array.isArray(prev) ? prev : [];
        if (!ordinary.every(entry => {
          const current = rows.find(row => String(row?.id) === String(entry.current.id));
          return current && samePlanVersion(current, entry.requested) && samePlanShape(current, entry.requested);
        })) return prev;
        return rows.filter(row => !ids.has(String(row?.id)));
      });
      if (typeof expandedNotesTaskId === 'string'
        && ids.has(String(expandedNotesTaskId)) && typeof setExpandedNotesTaskId === 'function') {
        setExpandedNotesTaskId(null);
      }
    }

    if (recurring.length) {
      const byTemplate = new Map();
      for (const entry of recurring) {
        const key = String(entry.template.id);
        if (!byTemplate.has(key)) byTemplate.set(key, []);
        byTemplate.get(key).push(entry);
      }
      setRecurringTasks(prev => {
        const rows = Array.isArray(prev) ? prev : [];
        if (![...byTemplate.values()].every(entries => {
          const template = rows.find(row => String(row?.id) === String(entries[0].template.id));
          return template && sameTemplateVersion(template, entries[0].requested);
        })) return prev;
        return rows.map(template => {
          const entries = byTemplate.get(String(template?.id));
          if (!entries) return template;
          const exceptions = { ...(template.exceptions || {}) };
          for (const entry of entries) {
            exceptions[entry.dateStr] = {
              ...(exceptions[entry.dateStr] || {}),
              deleted: true,
            };
          }
          return { ...template, exceptions, lastModified: freshTaskStamp(template.lastModified, now) };
        });
      });
    }

    if (typeof playUISound === 'function') playUISound('swoosh');
    triggerHaptic('success');
    if (onboardingProgress && !onboardingProgress.hasUsedActionButtons && typeof setOnboardingProgress === 'function') {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
    return true;
  };

  const moveToInbox = (id) => {
    pushUndo();
    if (typeof id === 'string' && id.startsWith('recurring-')) return;
    const task = tasks.find(t => t.id === id);
    if (!task || task.imported) return;

    // Shared with the harness's unschedule (utils/inboxMove.js): an
    // Obsidian task records the time this move removes, so a stale read of
    // its still-timed line is told apart from a time typed in the vault.
    const unscheduledTask = toInboxCopy(task);

    setTasks(prev => prev.filter(t => t.id !== id));
    setUnscheduledTasks(prev => [...prev, unscheduledTask]);
    playUISound('slide');
    setUndoToast({ message: 'Moved to inbox', actionable: true });
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  // ── Subtask management ───────────────────────────────────────────────────

  const addSubtask = (taskId, title, isInbox, extraFields = {}) => {
    if (!title.trim()) return;
    pushUndo();
    const newSubtask = {
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      ...extraFields,
    };
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, t => ({ ...t, subtasks: [...(t.subtasks || []), newSubtask] }));
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    }
    if (!onboardingProgress.hasAddedNotes) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
    return newSubtask;
  };

  const toggleSubtask = (taskId, subtaskId, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, completed: !st.completed } : st
      )
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  const deleteSubtask = (taskId, subtaskId, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId)
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  const updateSubtaskTitle = (taskId, subtaskId, newTitle, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, title: newTitle } : st
      )
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  // ── Task deletion ────────────────────────────────────────────────────────

  const moveToRecycleBin = (id, fromInbox = false) => {
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const parsed = parseRecurringId(id);
      if (parsed) {
        setRecurringDeleteConfirm({ taskId: parsed.templateId, dateStr: parsed.dateStr });
      }
      return;
    }

    pushUndo();
    const taskInScheduled = tasks.find(t => t.id === id);
    const taskInInbox = unscheduledTasks.find(t => t.id === id);
    const task = fromInbox ? taskInInbox : (taskInScheduled || taskInInbox);
    const actuallyInInbox = !!taskInInbox && !taskInScheduled;

    if (task) {
      if (expandedNotesTaskId === id) {
        setExpandedNotesTaskId(null);
      }
      // Stamp the bin entry with a FRESH timestamp that is strictly newer than
      // the task's own lastModified, used for BOTH deletedAt and lastModified.
      // This prevents "zombie" resurrection: an old task (lastModified beyond the
      // sync horizon) would otherwise have its recycle-bin entry pruned as a
      // presumed zombie during merge, after which the remote active copy — which
      // carries no tombstone — reconciles straight back into the inbox. A fresh
      // stamp keeps the bin entry alive past the horizon and lets it win the
      // active-vs-recycled reconciliation in both the file and vault sync tiers.
      const deletedStamp = new Date(
        Math.max(Date.now(), (task.lastModified ? Date.parse(task.lastModified) : 0) + 1000)
      ).toISOString();
      const taskWithMeta = {
        ...task,
        _deletedFrom: actuallyInInbox ? 'inbox' : 'calendar',
        deletedAt: deletedStamp,
        lastModified: deletedStamp,
      };
      setRecycleBin(prev => [...prev, taskWithMeta]);
      if (actuallyInInbox) {
        setUnscheduledTasks(prev => prev.filter(t => t.id !== id));
      } else {
        setTasks(prev => prev.filter(t => t.id !== id));
      }
      playUISound('swoosh');
      triggerHaptic('success');
      setUndoToast({ message: 'Task deleted', actionable: true });
      if (!onboardingProgress.hasUsedActionButtons) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
      }
    }
  };

  const deleteRecurringInstance = (mode) => {
    if (!recurringDeleteConfirm) return;
    pushUndo();
    const { taskId, dateStr } = recurringDeleteConfirm;

    if (mode === 'this') {
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, exceptions: { ...t.exceptions, [dateStr]: { deleted: true } }, lastModified: new Date().toISOString() };
      }));
    } else if (mode === 'future') {
      const dayBefore = new Date(dateStr + 'T12:00:00');
      dayBefore.setDate(dayBefore.getDate() - 1);
      const endDate = dateToString(dayBefore);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, recurrence: { ...t.recurrence, endDate }, lastModified: new Date().toISOString() };
      }));
    } else if (mode === 'series') {
      recordDeletedTaskTombstone(taskId);
      setRecurringTasks(prev => prev.filter(t => t.id !== taskId));
    }

    setRecurringDeleteConfirm(null);
  };

  // ── Scheduling ───────────────────────────────────────────────────────────

  const scheduleTaskAtNextSlot = (taskId, isInbox) => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();
    const nextSlotMinutes = Math.ceil((totalMinutes + 1) / 15) * 15;
    const nextSlotTime = minutesToTime(nextSlotMinutes);
    const todayStr = dateToString(now);
    if (isInbox) {
      const task = unscheduledTasks.find(t => t.id === taskId);
      if (!task) return;
      setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
      setTasks(prev => [...prev, { ...stripBucketId(task), startTime: nextSlotTime, date: todayStr, isAllDay: false }]);
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, startTime: nextSlotTime, date: todayStr } : t));
    }
    setFrameNudgeDismissedKey(activeFrameNudgeKey);
    playUISound('tick');
  };

  const manuallyScheduleTask = (taskId) => {
    if (!frameScheduleModal) return;
    const { frameId, dateStr, frame } = frameScheduleModal;
    const task = unscheduledTasks.find(t => t.id === taskId);
    if (!task) return;

    const frameInstance = {
      frameId,
      date: dateStr,
      start: frame.start,
      end: frame.end,
      bufferMinutes: frame.bufferMinutes ?? 5,
    };
    const slots = computeAvailableSlots(frameInstance, new Date(dateStr + 'T12:00:00'));
    const taskDuration = task.duration || 30;

    const slot = slots.find(s => s.minutes >= taskDuration);
    const startTime = slot ? slot.start : frame.start;

    pushUndo();
    const { priority, deadline, ...preserved } = task;
    setTasks(prev => [...prev, {
      ...preserved,
      date: dateStr,
      startTime,
      duration: taskDuration,
      color: task.color || 'bg-blue-500',
      isAllDay: false,
    }]);
    setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
    setFrameScheduleModal(null);
    playUISound('pop');
    setSyncNotification({
      type: 'success',
      title: 'Task Scheduled',
      message: `"${stripWikilinks(task.title)}" placed at ${startTime} in ${frame.label}`,
    });
  };

  // SCHED: give a deadline task a concrete slot on a given day (deadline card
  // → scheduled task). Deadline and priority are stripped, matching what
  // dragging a deadline chip onto the time grid does.
  const scheduleDeadlineTaskAt = (taskId, dateStr, startTime) => {
    const task = unscheduledTasks.find(t => t.id === taskId);
    if (!task) return;
    pushUndo();
    const { priority, deadline, ...preserved } = task;
    setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
    setTasks(prev => [...prev, {
      ...preserved,
      date: dateStr,
      startTime,
      duration: task.duration || 30,
      isAllDay: false,
      lastModified: new Date().toISOString(),
    }]);
    playUISound('pop');
  };

  // ── Focus mode wrappers ──────────────────────────────────────────────────

  const focusCompleteTask = (taskId) => {
    toggleComplete(taskId);
    setFocusCompletedTasks(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
    // Play completion chord only when all tasks are done — consistent with hyperGLANCE.
    // (toggleComplete above plays the 'tick' sound on every toggle.)
    const allDone = focusBlockTasks.every(t => t.completed || t.id === taskId || focusCompletedTasks.has(t.id));
    if (allDone) {
      playFocusSound('complete');
      setTimeout(() => exitFocusModeRef.current?.(true), 500);
    }
  };

  const hgCompleteTask = (taskId) => {
    const fromInbox = !tasks.find(t => t.id === taskId);
    toggleComplete(taskId, fromInbox);
  };

  const focusUpdateTaskNotes = (taskId, notes, isInbox) => {
    updateTaskNotes(taskId, notes, isInbox);
    setFocusBlockTasks(prev => prev.map(t => t.id === taskId ? { ...t, notes } : t));
  };

  const focusAddSubtask = (taskId, title, isInbox) => {
    const newSt = addSubtask(taskId, title, isInbox);
    if (!newSt) return;
    setFocusBlockTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSt] } : t));
  };

  const focusToggleSubtask = (taskId, subtaskId, isInbox) => {
    toggleSubtask(taskId, subtaskId, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).map(st => st.id === subtaskId ? { ...st, completed: !st.completed } : st) };
    }));
  };

  const focusDeleteSubtask = (taskId, subtaskId, isInbox) => {
    deleteSubtask(taskId, subtaskId, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId) };
    }));
  };

  const focusUpdateSubtaskTitle = (taskId, subtaskId, newTitle, isInbox) => {
    updateSubtaskTitle(taskId, subtaskId, newTitle, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).map(st => st.id === subtaskId ? { ...st, title: newTitle } : st) };
    }));
  };

  return {
    // Deadline
    setDeadline,
    postponeDeadlineTask,
    clearDeadline,
    // Create
    addTask,
    createTimelineTask,
    openNewTaskForm,
    openNewAllDayTask,
    openNewInboxTask,
    // Update
    changeTaskColor,
    setTaskEnergy,
    updateTaskNotes,
    updateRecurringTemplate,
    updateRecurrencePattern,
    updateRecurrenceEndCondition,
    // Complete
    toggleComplete,
    // Move
    postponeTask,
    moveTimelineTasks,
    resizeTimelineTask,
    moveToInbox,
    // Subtasks
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    updateSubtaskTitle,
    // Delete
    deleteTimelineTasks,
    moveToRecycleBin,
    deleteRecurringInstance,
    recordDeletedTaskTombstone,
    // Schedule
    scheduleTaskAtNextSlot,
    manuallyScheduleTask,
    scheduleDeadlineTaskAt,
    // HG wrapper
    hgCompleteTask,
    // Focus wrappers
    focusCompleteTask,
    focusUpdateTaskNotes,
    focusAddSubtask,
    focusToggleSubtask,
    focusDeleteSubtask,
    focusUpdateSubtaskTitle,
  };
}
