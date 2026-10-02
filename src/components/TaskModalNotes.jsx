import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { extractWikilinks } from '../utils/taskUtils.js';
import { applyDraftEdit, hasNotesContent, modalNotesTarget } from '../utils/taskModalNotes.js';

// Shown or hidden from a button, hidden at first, remembered on this device
// like the PLANNER's notes sidebar.
export const TASK_MODAL_NOTES_KEY = 'dg-task-modal-notes';

/**
 * The New/Edit Task modals' notes & subtasks, on desktop and phone: the
 * app's own notes panel (formatting, Shift+Enter, a linked vault note),
 * behind a button. See utils/taskModalNotes.js for what it edits.
 */
export default function TaskModalNotes({ newTask, setNewTask, editingTask }) {
  const { t } = useTranslation();
  const {
    darkMode, borderClass, textSecondary, hoverBg,
    tasks, unscheduledTasks, recurringTasks,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
  } = useDayPlannerCtx();
  const { aiConfig, aiSubtasksLoadingForTask, generateAISubtasks } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx() || {};
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(TASK_MODAL_NOTES_KEY) === '1'; } catch { return false; }
  });
  const toggle = () => setOpen((was) => {
    try { localStorage.setItem(TASK_MODAL_NOTES_KEY, was ? '0' : '1'); } catch { /* not remembered */ }
    return !was;
  });

  const target = modalNotesTarget({
    editingTask, schedulingId: newTask?.schedulingFromInboxId,
    tasks, unscheduledTasks, recurringTasks,
  });
  const isDraft = target?.kind === 'draft';

  // The draft is this panel's while newTask carries its key.
  const keyRef = useRef(null);
  if (!keyRef.current) keyRef.current = `draft-${crypto.randomUUID()}`;
  const draftKey = keyRef.current;
  useEffect(() => {
    if (isDraft) setNewTask((prev) => (prev.notesDraftKey === draftKey ? prev : { ...prev, notesDraftKey: draftKey }));
  }, [isDraft, draftKey, setNewTask]);
  const draft = (edit) => setNewTask((prev) => applyDraftEdit(prev, draftKey, edit));

  if (!target) return null;

  const task = isDraft
    ? { id: draftKey, title: newTask.title || '', notes: newTask.notes || '', subtasks: newTask.subtasks || [] }
    : target.task;
  // A new task's title is still being typed: its links are read once it exists.
  const wikilinks = isDraft ? [] : extractWikilinks(task.title || '');
  const hasWiki = wikilinks.length > 0;
  const actions = isDraft
    ? {
      updateTaskNotes: (_id, notes) => draft({ type: 'notes', notes }),
      addSubtask: (_id, title) => {
        if (!title.trim()) return undefined;
        const subtask = { id: crypto.randomUUID(), title: title.trim(), completed: false };
        draft({ type: 'addSubtask', subtask });
        return subtask;
      },
      toggleSubtask: (_id, subtaskId) => draft({ type: 'toggleSubtask', id: subtaskId }),
      deleteSubtask: (_id, subtaskId) => draft({ type: 'deleteSubtask', id: subtaskId }),
      updateSubtaskTitle: (_id, subtaskId, title) => draft({ type: 'renameSubtask', id: subtaskId, title }),
    }
    : { updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle };

  return (
    <div data-task-modal-notes={isDraft ? 'draft' : 'task'}>
      <button
        type="button"
        data-task-modal-notes-toggle
        onClick={toggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border ${borderClass} ${textSecondary} ${hoverBg}`}
      >
        <FileText size={14} />
        <span className="flex-1 text-left">{t('sched.notesSubtasks')}</span>
        {hasNotesContent(task) && <span data-task-modal-notes-dot className="w-2 h-2 rounded-full bg-blue-500" aria-hidden="true" />}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <NotesSubtasksPanel
          key={task.id}
          task={task}
          isInbox={isDraft ? false : target.isInbox}
          darkMode={darkMode}
          noAutoFocus
          {...actions}
          // Generating subtasks writes to a saved task, so a draft has none.
          aiConfig={isDraft ? undefined : aiConfig}
          aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
          onGenerateSubtasks={generateAISubtasks}
          wikilinks={hasWiki ? wikilinks : undefined}
          onLoadWikiNote={hasWiki ? loadWikiNote : undefined}
          onSaveWikiNote={hasWiki ? saveWikiNote : undefined}
          onOpenInObsidian={hasWiki ? openInObsidian : undefined}
        />
      )}
    </div>
  );
}
