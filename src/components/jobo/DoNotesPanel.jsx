import React from 'react';
import NotesSubtasksPanel from '../NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { extractWikilinks } from '../../utils/taskUtils.js';

// The linked task's own notes and subtasks, opened from a Do card: the same
// panel a timeline card floats below itself, in the task's colour. A
// completed Plan card fades, so after the fact the Do side is where the
// task's notes are easiest to reach. The notes are the task's, written
// through the app's own actions; the ledger record gains nothing.
export default function DoNotesPanel({ task, above, height }) {
  const {
    darkMode, unscheduledTasks,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
  } = useDayPlannerCtx();
  const { aiConfig, aiSubtasksLoadingForTask, generateAISubtasks } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx() || {};
  const isInbox = (unscheduledTasks || []).some((candidate) => candidate.id === task.id);
  const wikilinks = extractWikilinks(task.title);
  const hasWiki = wikilinks.length > 0;

  return (
    <div
      data-jobo-notes
      className="absolute left-0 right-0 z-40"
      style={above ? { bottom: `${height}px` } : { top: `${height}px` }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={`${task.color || 'bg-blue-500'} rounded-lg shadow-lg ${above ? 'mb-1' : 'mt-1'}`}>
        <NotesSubtasksPanel
          task={task}
          isInbox={isInbox}
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
  );
}
