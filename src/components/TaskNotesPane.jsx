import React from 'react';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { extractWikilinks } from '../utils/taskUtils.js';

// One task's notes and subtasks in a side pane: its title in its colour,
// then the app's own notes panel, saving through the app's own actions and
// opening a linked vault note where the title has one. JOBO's notes sidebar
// and the Project Planner's both show a selected task this way.
// `autoFocus` false keeps the keyboard where it is (the planner moves its
// selection with the arrow keys); JOBO's sidebar focuses an empty note.
// Bumping `focusNoteRequest` puts the cursor in the note (the planner's E).
export default function TaskNotesPane({ task, autoFocus = true, focusNoteRequest = 0 }) {
  const {
    darkMode, textPrimary, unscheduledTasks,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
  } = useDayPlannerCtx();
  const { aiConfig, aiSubtasksLoadingForTask, generateAISubtasks } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx() || {};
  const wikilinks = extractWikilinks(task.title);
  const hasWiki = wikilinks.length > 0;
  return (
    <div data-task-notes-pane={task.id}>
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
          noAutoFocus={!autoFocus}
          focusNoteRequest={focusNoteRequest}
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
  );
}
