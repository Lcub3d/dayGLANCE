// The guide is optional: native onboarding, editing and navigation win.
// Keep this decision pure so startup and all three context boundaries are tested.
const CORE_SURFACES = [
  'showWelcome', 'showSettings', 'showAddTask', 'mobileEditingTask',
  'mobileEditingNativeEvent', 'editingTaskId', 'expandedNotesTaskId',
  'dailyNotesModalDate', 'showSpotlight', 'showShortcutHelp', 'showHelpModal',
  'showMonthView', 'showDayDial', 'showBucketList', 'showMobileDailySummary',
  'showIncompleteTasks', 'showTimePicker', 'showDatePicker', 'showColorPicker',
  'showDeadlinePicker', 'deadlinePickerTaskId', 'showRecurrencePicker',
  'showRecurrenceEndDatePicker', 'recurringDeleteConfirm', 'taskContextMenu',
  'timelineContextMenu', 'expandedTaskMenu', 'draggedTask', 'isResizing',
  'mobileDragTaskIdState',
];
const FEATURE_SURFACES = [
  'showLifePlanner', 'showGoalsDashboard', 'showWeeklyReview', 'showVoiceInput',
  'showFocusMode', 'showRoutinesDashboard', 'showHabitModal', 'showFramesModal',
  'showRescheduleModal', 'frameAdjustModal', 'frameScheduleModal',
  'quickAddFrameModal', 'showRemindersSettings', 'focusLogModalDate',
];
const SYNC_SURFACES = [
  'showBackupMenu', 'showRestoreConfirm', 'showImportModal', 'syncNotification',
  'showAutoBackupManager', 'autoBackupRestoreConfirm', 'showStorageBreakdown',
  'showIntentActivityLog', 'showEmptyBinConfirm', 'showMobileRecycleBin',
  'cloudSyncConflict',
];

export function isPlanningGuideBlocked(ctx = {}, features = {}, sync = {}) {
  if (!ctx.dataLoaded || !ctx.initialWelcomeChecked) return true;
  if (ctx.isPhone && ctx.isLandscape) return true;
  if (ctx.isMobile && ctx.mobileActiveTab === 'settings') return true;
  return CORE_SURFACES.some(key => !!ctx[key]) ||
    FEATURE_SURFACES.some(key => !!features[key]) ||
    SYNC_SURFACES.some(key => !!sync[key]);
}

// Some nested editors/sheets own local state rather than one of the app contexts.
// Check the real DOM immediately before an automatic prompt, not just at mount.
export function isPlanningGuideDOMBusy(doc) {
  if (doc.visibilityState !== 'visible') return true;
  const active = doc.activeElement;
  if (active?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName)) return true;
  return [...doc.querySelectorAll('[role="dialog"], [aria-modal="true"], [role="menu"], [data-month-day-sheet], .sched-notes-panel')]
    .some(el => !el.closest('[data-planning-choices]') && el.getClientRects().length > 0);
}
