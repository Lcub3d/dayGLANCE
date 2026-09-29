import React, { useState } from 'react';
import { Loader, X } from 'lucide-react';
import NotesSubtasksPanel from '../NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { renderFormattedText, renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { extractWikilinks } from '../../utils/taskUtils.js';
import useDailyNoteDraft from '../../hooks/useDailyNoteDraft.js';

// JOBO's notes sidebar on wide screens: the day's Daily Note above, the
// selected task's notes and subtasks below.
//
// Both edit in place, the way a task's notes do: click to edit, and leaving
// the field (or Shift+Enter, or Esc) saves. The Daily Note edits through
// useDailyNoteDraft, the Daily Notes modal's own rules: the editor mounts
// when editing starts, reads the note fresh from Obsidian then, and writes
// back only a change to what it read, so a note changed in the vault while
// the sidebar sat open is never overwritten by the sidebar's older copy.
// The task's notes are the same panel a timeline card opens, which saves
// through the app's own actions.
export const SIDEBAR_WIDTH = 'w-[calc((100%-4rem)/3)] min-w-80';

function DailyNoteEditor({ date, note, onSave, template, loadFresh, onDone, darkMode, textSecondary, t }) {
  const { text, setText, loading, persist, savedOnCloseRef } = useDailyNoteDraft({ dateStr: date, note, onSave, template, loadFresh });
  const finish = () => {
    savedOnCloseRef.current = true;
    persist(text);
    onDone();
  };
  if (loading) {
    return (
      <div data-jobo-daily-note-loading className="flex items-center justify-center py-6">
        <Loader size={18} className={`animate-spin ${textSecondary}`} aria-label={t('common.loading')} />
      </div>
    );
  }
  return (
    <textarea
      data-jobo-daily-note-editor
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' && event.shiftKey) || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      placeholder={t('planner.notesPlaceholder')}
      aria-label={t('common.dailyNote')}
      className={`w-full min-h-[8rem] flex-1 ${darkMode ? 'bg-gray-700 text-gray-100 border-gray-600 placeholder:text-gray-500' : 'bg-stone-50 text-stone-900 border-stone-300 placeholder:text-stone-400'} text-sm px-3 py-2.5 rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 resize-none`}
      autoFocus
    />
  );
}

export default function JoboNotesSidebar({ date, task, onClearTask, t, headerAction = null, headerInset = 0 }) {
  const {
    darkMode, borderClass, textPrimary, textSecondary, unscheduledTasks,
    dailyNotes, updateDailyNote, dailyNoteTemplate, loadDailyNoteFresh,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
  } = useDayPlannerCtx();
  const { aiConfig, aiSubtasksLoadingForTask, generateAISubtasks } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx() || {};
  const noteText = dailyNotes?.[date]?.text || '';
  // Editing belongs to one date: moving to another day leaves the editor,
  // which saves on its way out.
  const [editingDate, setEditingDate] = useState(null);
  const editing = editingDate === date && typeof updateDailyNote === 'function';
  const wikilinks = task ? extractWikilinks(task.title) : [];
  const hasWiki = wikilinks.length > 0;
  const heading = `text-xs font-semibold uppercase tracking-wide ${textSecondary}`;

  return (
    // A third of the view, the same width as Plan and as Do. The view is the
    // 4rem hour gutter plus three equal columns, and JoboView's grid gives
    // Plan (with the gutter) 50% + 2rem of what is left: so this is exactly
    // one column. Never narrower than the old fixed 20rem.
    <aside data-jobo-notes-sidebar className={`${SIDEBAR_WIDTH} flex-shrink-0 border-l ${borderClass} flex flex-col min-h-0`} aria-label={t('task.notes')}>
      {/* The same height as the Plan and Do header row (py-1 around the h-7
          button, then the border), and inset by the Do side's scrollbar
          width (headerInset), so the sidebar button lands exactly where it
          sat in the Do header before the sidebar opened. */}
      <div data-jobo-sidebar-header className={`px-3 py-1 border-b ${borderClass} flex items-center justify-end flex-shrink-0`}
        style={headerInset ? { paddingRight: `calc(0.75rem + ${headerInset}px)` } : undefined}>
        {headerAction}
      </div>
      <section className={`flex flex-col min-h-0 max-h-[50%] border-b ${borderClass} p-3`}>
        <h3 className={`${heading} mb-2`}>{t('common.dailyNote')}</h3>
        {editing ? (
          <DailyNoteEditor key={date} date={date} note={dailyNotes?.[date]} onSave={updateDailyNote}
            template={dailyNoteTemplate} loadFresh={loadDailyNoteFresh} onDone={() => setEditingDate(null)}
            darkMode={darkMode} textSecondary={textSecondary} t={t} />
        ) : (
          <div
            data-jobo-daily-note
            role="button"
            tabIndex={0}
            onClick={() => setEditingDate(date)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setEditingDate(date); } }}
            className={`text-sm whitespace-pre-wrap cursor-text overflow-y-auto p-3 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-50 hover:bg-stone-100'} ${noteText ? textPrimary : textSecondary}`}
          >
            {noteText ? renderFormattedText(noteText) : t('jobo.view.dailyNoteEmpty')}
          </div>
        )}
      </section>
      <section className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h3 className={heading}>{t('task.notes')}</h3>
          {task && (
            <button type="button" onClick={onClearTask}
              className={`p-1 rounded-lg ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'} ${textSecondary}`}
              aria-label={t('common.close')} title={t('common.close')}>
              <X size={14} />
            </button>
          )}
        </div>
        {task ? (
          <div data-jobo-sidebar-task={task.id}>
            <div className={`flex items-center gap-2 mb-2 text-sm font-semibold ${textPrimary} min-w-0`}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} aria-hidden="true" />
              <span className="truncate">{renderTitleWithoutTags(task.title)}</span>
            </div>
            <div className={`${task.color || 'bg-blue-500'} rounded-lg`}>
              <NotesSubtasksPanel
                key={task.id}
                task={task}
                isInbox={(unscheduledTasks || []).some((candidate) => candidate.id === task.id)}
                darkMode={darkMode}
                updateTaskNotes={updateTaskNotes}
                addSubtask={addSubtask}
                toggleSubtask={toggleSubtask}
                deleteSubtask={deleteSubtask}
                updateSubtaskTitle={updateSubtaskTitle}
                compact={false}
                aiConfig={aiConfig}
                aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                onGenerateSubtasks={generateAISubtasks}
                wikilinks={hasWiki ? wikilinks : undefined}
                onLoadWikiNote={hasWiki ? loadWikiNote : undefined}
                onSaveWikiNote={hasWiki ? saveWikiNote : undefined}
                onOpenInObsidian={hasWiki ? openInObsidian : undefined}
              />
            </div>
          </div>
        ) : (
          <p className={`text-sm ${textSecondary}`}>{t('jobo.view.selectForNotes')}</p>
        )}
      </section>
    </aside>
  );
}
