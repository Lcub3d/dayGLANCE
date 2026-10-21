import { dateToString } from '../utils/taskUtils.js';
import { hasNativeCalendar } from '../utils/nativeCalendar.js';
import { stampTimestamps } from '../utils/stampTimestamps.js';
import { stampOriginalPlan, applyBaselines } from '../utils/originalPlan.js';
import { stampDeferrals, applyDeferrals } from '../utils/deferrals.js';
import { inBookkeepingWindow, markBookkeepingChange } from '../utils/localEditStamp.js';
import { stampPlanTrail, applyPlanTrail } from '../utils/planTrail.js';
import { rolloverRemovedTodayRoutineIds, startOfTodayIso } from './useRoutines.js';

// Read-only CalDAV/ICS-subscription events (importSource 'sync', non-task,
// non-file) are ephemeral remote data, re-fetched live each session. On devices
// with a native calendar source (macOS EventKit / mobile bridge) that live fetch
// is disabled, so any such events lingering in storage — from an earlier build or
// a cloud merge — must be dropped rather than shown as stale gray duplicates of
// the native events. ICS file imports ('file') and CalDAV task-calendar to-dos
// (isTaskCalendar) are first-class user data and are always kept.
const isSubscriptionImport = (t) =>
  !t._native && t.imported && !t.isTaskCalendar && t.importSource !== 'file';

// The tray popup must never write to localStorage — it holds a snapshot of
// state as of the last reload and would overwrite fresher main-window data
// (same invariant as useSaveOnChange.js). loadData's normalization write-back
// runs on every tray mount and reload, so it needs the guard too: the tray
// still reads and normalizes for its own render, it just never persists.
import { isTrayMode } from '../utils/trayMode.js';
import { repairLoadedGhostRows } from '../utils/obsidianGhostRows.js';
import { recordLoadFailure, isLoadProtected } from '../utils/loadFailures.js';
import { writeItem, getWriteFailures } from '../utils/storageWrites.js';
import { stripProjectRefs, stripGoalRefs } from '../utils/referentialIntegrity.js';

// What the save pass last wrote, per key (#2140). Every change used to
// re-serialize every bucket, re-parse and re-stamp all five task-shaped arrays
// and rewrite ~25 keys, so one checkbox cost time in proportion to the whole
// dataset. A bucket is now skipped when BOTH hold:
//   - its inputs are the same values as last pass (state slices are replaced,
//     never mutated, so identity is change), and
//   - storage still holds exactly the string this pass wrote there.
// The second check is what keeps this safe: an apply, a restore or any other
// writer that changes a key behind the pass's back makes it mismatch, and the
// bucket is rebuilt and written exactly as before. Given the same inputs and
// the same stored copy, rebuilding would produce the same string, so a skip
// never changes what is stored.
const lastWritten = new Map(); // storage key -> { inputs: any[], value: string }
const sameInputs = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

export default function useDataPersistence({
  // setters for loadData
  setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks,
  setDarkMode, setSyncUrl, setTaskCalendarUrl, setCompletedTaskUids,
  setDailyNotes, setRoutineDefinitions, setTodayRoutines, setRoutinesDate,
  setRemovedTodayRoutineIds, setHabits, setHabitLogs, setHabitsEnabled,
  setRoutinesEnabled, setGoals, setProjects, setAreas, setGoalsProjectsEnabled, setDataLoaded,
  setUnscheduledOrderTimestamp,
  // values for saveData
  tasks, unscheduledTasks, recycleBin, recurringTasks, todayRoutines,
  darkMode, syncUrl, taskCalendarUrl, syncRetentionDays, completedTaskUids,
  routineDefinitions, routinesDate, removedTodayRoutineIds,
  habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames,
  goals, projects, areas, goalsProjectsEnabled,
  unscheduledOrderTimestamp,
  cloudSyncConfig, cloudSyncInitialDoneRef, suppressTimestampRef,
  setUndoToast,
  t,
  isRemoteApply = () => false,
}) {
  const readStored = (storageKey) => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  };

  // Stamp lastModified on tasks that changed since last save. `prevTasks` lets a
  // caller that has already parsed the stored copy hand it in rather than paying
  // for a second parse of the whole array.
  const stampTaskTimestamps = (currentTasks, storageKey, prevTasks) => {
    if (suppressTimestampRef.current) return currentTasks;
    const prev = prevTasks ?? readStored(storageKey);
    // Opt-in diagnostic: set localStorage 'dayglance-debug-stamp' = '1' to log
    // which fields trip a re-stamp. Use it to catch a phantom re-stamp (a default
    // or unexpected field, not a real edit) if task resurrection ever recurs.
    let onRestamp;
    try {
      if (localStorage.getItem('dayglance-debug-stamp') === '1') {
        onRestamp = ({ id, changedKeys }) =>
          console.warn(`[stamp] re-stamped ${storageKey} ${id} — changed:`, changedKeys);
      }
    } catch { /* ignore */ }
    return stampTimestamps(currentTasks, prev, new Date().toISOString(), onRestamp);
  };

  // Every bucket is read on its own (#2138). A key that is absent is "no data";
  // a key that is present but unreadable is recorded in utils/loadFailures.js,
  // which keeps the save pass from writing empty state over it. One bad key no
  // longer takes the keys after it down with it.
  //
  // `bucket` runs one section and records its keys on a throw. `writeBack` is
  // the normalization write-back: best-effort, because the normalized copy is
  // slightly larger than the stored one and a store at its quota rejects it.
  // Losing the write-back costs nothing — stampTimestamps' normalizeField treats
  // the defaults it adds as equal to their absence — whereas letting it throw
  // used to abort the whole load.
  const loadData = () => {
    const bucket = (keys, run) => {
      try {
        run();
      } catch (error) {
        for (const key of keys) {
          let raw;
          try { raw = localStorage.getItem(key); } catch { raw = undefined; }
          // Only a key that holds something can be unreadable; an absent key
          // that a section tripped over is still absent, and saving it is safe.
          if (raw !== null) recordLoadFailure(key, error, raw);
        }
      }
    };
    const writeBack = (key, value) => {
      if (isTrayMode) return;
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.warn(`[load] normalization write-back skipped for ${key}:`, error);
      }
    };
    // Deletion tombstones decide the boot self-heal (#2137): a row that still
    // points at a deleted project or goal is invisible state (the Inbox hides
    // "project tasks"; a project whose goal is gone sits in neither the goal's
    // list nor the standalone one). Only a TOMBSTONE makes a reference dangling
    // — never an id missing from the local lists (utils/referentialIntegrity.js
    // has the reasoning). Both reads are guarded: a corrupt tombstone map is
    // "no information", so nothing is stripped on its word.
    const readTombstones = (key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch { return {}; }
    };
    const deletedProjectIds = readTombstones('day-planner-deleted-project-ids');
    const deletedGoalIds = readTombstones('day-planner-deleted-goal-ids');
    const parseTaskList = (key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw).map(t => ({
        ...t,
        notes: t.notes ?? '',
        subtasks: t.subtasks ?? []
      }));
      // Repair before the write-back below so the save pass finds storage in
      // step with state and cannot read the repair as a user edit (which would
      // re-stamp lastModified). Unstamped on purpose: every device derives the
      // same repair from the same tombstone, so a tie in last-writer-wins
      // converges instead of flipping.
      return stripProjectRefs(parsed, deletedProjectIds);
    };

    // Parse existing data and normalize defaults so localStorage and React
    // state stay in sync.  Without this write-back, stampTaskTimestamps detects
    // the added defaults as "changes" and re-stamps lastModified on every task
    // at app load, making stale local tasks win during the initial cloud merge.
    // `null` means the list could not be read: its state is left alone.
    let parsedTasks = null;
    bucket(['day-planner-tasks'], () => {
      parsedTasks = parseTaskList('day-planner-tasks');
      if (localStorage.getItem('day-planner-tasks')) writeBack('day-planner-tasks', JSON.stringify(parsedTasks));
    });
    let parsedUnscheduled = null;
    bucket(['day-planner-unscheduled'], () => {
      parsedUnscheduled = parseTaskList('day-planner-unscheduled');
      if (localStorage.getItem('day-planner-unscheduled')) writeBack('day-planner-unscheduled', JSON.stringify(parsedUnscheduled));
    });

    // Load tasks normally; preserve any _native events already queued by Effect B
    // if it raced ahead of loadData in React's state update batch. On native-
    // calendar devices, drop any persisted subscription imports so they don't
    // linger as stale duplicates of the live EventKit/bridge events.
    const loadedTasks = parsedTasks && hasNativeCalendar() ? parsedTasks.filter(t => !isSubscriptionImport(t)) : parsedTasks;
    const loadedUnscheduled = parsedUnscheduled ? parsedUnscheduled.filter(t => !t.imported) : null;
    // Ghost-row self-repair at boot (utils/obsidianGhostRows.js): if this
    // device minted mangled duplicates while running a pre-block-id build,
    // its first launch after updating contains them here — the sync
    // ingresses only fire when something syncs, and a local-only install
    // would otherwise never repair. The tray never persists (read snapshot).
    // The repair only runs when both lists were read; it is a repair, so
    // failing it falls back to the lists as stored rather than to nothing.
    let ghostRepaired = { tasks: loadedTasks, unscheduledTasks: loadedUnscheduled };
    if (loadedTasks && loadedUnscheduled) {
      try {
        ghostRepaired = repairLoadedGhostRows(loadedTasks, loadedUnscheduled, { persist: !isTrayMode });
      } catch (error) {
        console.error('[load] ghost-row repair skipped:', error);
      }
    }
    if (ghostRepaired.tasks) setTasks(prev => [...ghostRepaired.tasks, ...prev.filter(t => t._native)]);
    if (ghostRepaired.unscheduledTasks) setUnscheduledTasks(ghostRepaired.unscheduledTasks);

    bucket(['day-planner-recycle-bin'], () => {
      const recycleBinData = localStorage.getItem('day-planner-recycle-bin');
      if (!recycleBinData) return;
      const parsedBin = JSON.parse(recycleBinData);
      const prunedBin = stripProjectRefs(parsedBin, deletedProjectIds);
      if (prunedBin !== parsedBin) writeBack('day-planner-recycle-bin', JSON.stringify(prunedBin));
      setRecycleBin(prunedBin);
    });

    // The theme is not reloaded here: App reads its preference at start
    // (utils/themePref.js), and setting it from the resolved value would
    // turn a 'system' preference into an explicit one on every load.
    bucket(['day-planner-sync-url'], () => {
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      // Migrate from JSON-stringified format (e.g. "\"https://...\"") to plain string
      if (syncUrlData) setSyncUrl(syncUrlData.startsWith('"') ? JSON.parse(syncUrlData) : syncUrlData);
    });
    bucket(['day-planner-task-calendar-url'], () => {
      const taskCalendarUrlData = localStorage.getItem('day-planner-task-calendar-url');
      if (taskCalendarUrlData) {
        setTaskCalendarUrl(taskCalendarUrlData.startsWith('"') ? JSON.parse(taskCalendarUrlData) : taskCalendarUrlData);
      }
    });
    bucket(['day-planner-task-completed-uids'], () => {
      const completedTaskUidsData = localStorage.getItem('day-planner-task-completed-uids');
      if (completedTaskUidsData) setCompletedTaskUids(new Set(JSON.parse(completedTaskUidsData)));
    });
    // App's useState initializer has already read the notes (and recorded a
    // failure there if they were unreadable); this re-read keeps a reload of
    // loadData in step with storage.
    bucket(['day-planner-daily-notes'], () => {
      const dailyNotesData = localStorage.getItem('day-planner-daily-notes');
      if (dailyNotesData) setDailyNotes(JSON.parse(dailyNotesData));
    });
    bucket(['day-planner-recurring-tasks'], () => {
      const recurringTasksData = localStorage.getItem('day-planner-recurring-tasks');
      if (!recurringTasksData) return;
      const parsedRecurring = JSON.parse(recurringTasksData);
      const prunedRecurring = stripProjectRefs(parsedRecurring, deletedProjectIds);
      if (prunedRecurring !== parsedRecurring) writeBack('day-planner-recurring-tasks', JSON.stringify(prunedRecurring));
      setRecurringTasks(prunedRecurring);
    });

    // Load routines
    bucket(['day-planner-routine-definitions'], () => {
      const routineDefsData = localStorage.getItem('day-planner-routine-definitions');
      if (routineDefsData) setRoutineDefinitions(JSON.parse(routineDefsData));
    });
    bucket(['day-planner-today-routines', 'day-planner-removed-today-routine-ids'], () => {
      const todayRoutinesData = localStorage.getItem('day-planner-today-routines');
      const routinesDateData = localStorage.getItem('day-planner-routines-date');
      const todayStr = dateToString(new Date());
      if (routinesDateData && routinesDateData === todayStr && todayRoutinesData) {
        setTodayRoutines(JSON.parse(todayRoutinesData));
        setRoutinesDate(todayStr);
        const removedData = localStorage.getItem('day-planner-removed-today-routine-ids');
        if (removedData) setRemovedTodayRoutineIds(JSON.parse(removedData));
      } else {
        // A new day since the last save: clear the chips, but KEEP the removal
        // receipts and stamp one at local midnight for each cleared chip,
        // exactly as the open-across-midnight rollover does (useRoutines.js).
        // Wiping the map here pushed an empty bundle that the vault's grow-only
        // merge undid on the next pull: one pointless write per launch, and
        // two code paths disagreeing about the same day boundary.
        let storedRemoved = {};
        let storedChips = [];
        try {
          storedRemoved = JSON.parse(localStorage.getItem('day-planner-removed-today-routine-ids') || '{}') || {};
        } catch (_) { storedRemoved = {}; }
        try {
          storedChips = JSON.parse(todayRoutinesData || '[]') || [];
        } catch (_) { storedChips = []; }
        const rolled = rolloverRemovedTodayRoutineIds(storedRemoved, storedChips, startOfTodayIso());
        markBookkeepingChange();
        setTodayRoutines([]);
        setRoutinesDate(todayStr);
        setRemovedTodayRoutineIds(rolled);
        writeBack('day-planner-removed-today-routine-ids', JSON.stringify(rolled));
      }
    });

    // Load habit tracking data
    bucket(['day-planner-habits'], () => {
      const habitsData = localStorage.getItem('day-planner-habits');
      if (habitsData) {
        const parsedHabits = JSON.parse(habitsData).map(h =>
          h.scheduledDays ? h : { ...h, scheduledDays: [0, 1, 2, 3, 4, 5, 6] }
        );
        writeBack('day-planner-habits', JSON.stringify(parsedHabits));
        setHabits(parsedHabits);
      }
    });
    bucket(['day-planner-habit-logs'], () => {
      const habitLogsData = localStorage.getItem('day-planner-habit-logs');
      if (habitLogsData) setHabitLogs(JSON.parse(habitLogsData));
    });
    bucket(['day-planner-habits-enabled'], () => {
      const habitsEnabledData = localStorage.getItem('day-planner-habits-enabled');
      if (habitsEnabledData !== null) setHabitsEnabled(JSON.parse(habitsEnabledData));
    });
    bucket(['day-planner-routines-enabled'], () => {
      const routinesEnabledData = localStorage.getItem('day-planner-routines-enabled');
      if (routinesEnabledData !== null) setRoutinesEnabled(JSON.parse(routinesEnabledData));
    });

    // Load unscheduled task order timestamp
    bucket(['day-planner-unscheduled-order-ts'], () => {
      const orderTsData = localStorage.getItem('day-planner-unscheduled-order-ts');
      if (orderTsData) setUnscheduledOrderTimestamp(orderTsData);
    });

    // Load goals and projects
    bucket(['day-planner-goals'], () => {
      const goalsData = localStorage.getItem('day-planner-goals');
      if (goalsData) setGoals(JSON.parse(goalsData));
    });
    bucket(['day-planner-projects'], () => {
      const projectsData = localStorage.getItem('day-planner-projects');
      if (!projectsData) return;
      const parsedProjects = JSON.parse(projectsData);
      // Same tombstone-only repair as the task lists, for a project whose goal
      // was deleted (it would otherwise belong to neither the goal's list nor
      // the standalone one). Repaired before state is set and written back, so
      // the persist pass does not re-stamp it as an edit.
      const prunedProjects = stripGoalRefs(parsedProjects, deletedGoalIds);
      if (prunedProjects !== parsedProjects) writeBack('day-planner-projects', JSON.stringify(prunedProjects));
      setProjects(prunedProjects);
    });
    bucket(['day-planner-areas'], () => {
      const areasData = localStorage.getItem('day-planner-areas');
      if (areasData) setAreas(JSON.parse(areasData));
    });
    bucket(['day-planner-goals-projects-enabled'], () => {
      const goalsProjectsEnabledData = localStorage.getItem('day-planner-goals-projects-enabled');
      if (goalsProjectsEnabledData !== null) setGoalsProjectsEnabled(JSON.parse(goalsProjectsEnabledData));
    });
    // Loaded, though not necessarily in full: whatever could not be read is
    // protected (utils/loadFailures.js) and the banner says so.
    setDataLoaded(true);
  };

  const saveData = () => {
    // Write each key individually so a QuotaExceededError on one key does not
    // leave earlier keys updated and later keys stale (partial-write corruption).
    let quotaHit = false;
    const safeSet = (key, value, inputs = null) => {
      // A bucket that failed to load holds data this state never saw; writing
      // state over it is how one corrupt key used to wipe a store (#2138).
      if (isLoadProtected(key)) return;
      // writeItem records a quota failure for the persistent banner (#2139);
      // the toast is the immediate notice for the action that hit it. A failed
      // write is not remembered, so the next pass tries the bucket again.
      if (writeItem(key, value)) {
        if (inputs) lastWritten.set(key, { inputs, value });
        else lastWritten.delete(key);
      } else {
        lastWritten.delete(key);
        if (!quotaHit && getWriteFailures().includes(key)) {
          quotaHit = true;
          setUndoToast({ message: t('backup.storageFull'), kind: 'warning' });
        }
      }
    };
    // True when `key` can be skipped this pass (see lastWritten above).
    const unchanged = (key, inputs) => {
      const last = lastWritten.get(key);
      if (!last || !sameInputs(last.inputs, inputs)) return false;
      let stored;
      try { stored = localStorage.getItem(key); } catch { return false; }
      return stored === last.value;
    };
    // Write `key` from `build()` unless its inputs and stored copy are as this
    // pass left them.
    const saveBucket = (key, inputs, build) => {
      if (unchanged(key, inputs)) return;
      safeSet(key, build(), inputs);
    };

    // Never persist _native events; on native-calendar devices also drop ephemeral
    // subscription imports so they don't reappear (stale) on the next reload.
    // Record the schedule a task is first given (utils/originalPlan.js). This is
    // the one place that sees both the new state and the stored copy it replaces,
    // which is what distinguishes a task being SCHEDULED from one being
    // rescheduled, so the capture rides here rather than at the dozen-odd sites
    // that assign a date and time.
    //
    // The result must go back into React STATE and not only to storage. State is
    // what buildSyncPayload pushes and what applyEngineData hands to
    // preserveStickyFields, so a baseline that exists only in storage is invisible
    // to both: the vault never receives it, and the next apply writes state back
    // over storage and erases it. That is not theoretical — it is what made a real
    // vault-synced install report 0 of 626 tasks with a baseline.
    //
    // Enriching in place (applyBaselines) rather than writing `liveTasks` back
    // wholesale, because that array is filtered and would drop the native rows.
    // The write-back re-runs this effect once; the second pass finds every task
    // already carrying a baseline, stampOriginalPlan returns the SAME array, and
    // nothing further happens. suppressTimestampRef covers it as before: while
    // remote data is being applied this device witnessed no scheduling.
    // The whole task pipeline (baselines, deferrals, plan trail, stamps) reads
    // the stored copy and the live list, and is skipped with the bucket when
    // neither has moved since this pass wrote it (#2140).
    const taskInputs = [tasks, suppressTimestampRef.current, hasNativeCalendar()];
    if (!unchanged('day-planner-tasks', taskInputs)) {
      const prevStoredTasks = readStored('day-planner-tasks');
      const liveTasks = tasks.filter(t => !t._native && !(hasNativeCalendar() && isSubscriptionImport(t)));
      //
      // `deferrals` (utils/deferrals.js) rides the same pass and the same reasoning:
      // this is the only place that sees the schedule a task HAD next to the one it
      // has now, which is what tells a slip from a fresh plan. Suppressed during a
      // remote apply for the same reason as the baseline — a reschedule made on
      // another device is that device's to count, and counting it again here would
      // inflate every task on every sync.
      const plannedTasks = suppressTimestampRef.current
        ? liveTasks
        : stampOriginalPlan(liveTasks, prevStoredTasks);
      const countedTasks = suppressTimestampRef.current
        ? plannedTasks
        : stampDeferrals(plannedTasks, prevStoredTasks);
      // `planTrail` (utils/planTrail.js) records WHERE each of those slips landed,
      // off the same comparison and under the same suppression. Stamped from
      // `countedTasks` so a task that gains both in one pass keeps them: reading
      // `plannedTasks` here would build the trail on a copy without the new count
      // and then overwrite it.
      const trailedTasks = suppressTimestampRef.current
        ? countedTasks
        : stampPlanTrail(countedTasks, prevStoredTasks);
      if (plannedTasks !== liveTasks) setTasks(prev => applyBaselines(prev, plannedTasks));
      if (countedTasks !== plannedTasks) setTasks(prev => applyDeferrals(prev, countedTasks));
      if (trailedTasks !== countedTasks) setTasks(prev => applyPlanTrail(prev, trailedTasks));
      const stampedTasks = stampTaskTimestamps(trailedTasks, 'day-planner-tasks', prevStoredTasks);
      safeSet('day-planner-tasks', JSON.stringify(stampedTasks), taskInputs);
    }

    // The other task-shaped arrays are stamped against their own stored copy;
    // the suppress flag is an input because it decides whether they stamp.
    const suppressed = suppressTimestampRef.current;
    saveBucket('day-planner-unscheduled', [unscheduledTasks, suppressed],
      () => JSON.stringify(stampTaskTimestamps(unscheduledTasks, 'day-planner-unscheduled')));
    saveBucket('day-planner-recycle-bin', [recycleBin, suppressed],
      () => JSON.stringify(stampTaskTimestamps(recycleBin, 'day-planner-recycle-bin')));
    saveBucket('day-planner-recurring-tasks', [recurringTasks, suppressed],
      () => JSON.stringify(stampTaskTimestamps(recurringTasks, 'day-planner-recurring-tasks')));
    saveBucket('day-planner-today-routines', [todayRoutines, suppressed],
      () => JSON.stringify(stampTaskTimestamps(todayRoutines, 'day-planner-today-routines')));

    // Prune completedTaskUids to the retention window to prevent unbounded growth.
    // UIDs have the format "icalUid::YYYY-MM-DD"; discard entries whose date is
    // older than syncRetentionDays (same window used for task import). The
    // cutoff moves with the clock, so today's date is one of the inputs.
    saveBucket('day-planner-task-completed-uids', [completedTaskUids, syncRetentionDays, dateToString(new Date())], () => {
      const uidCutoff = syncRetentionDays > 0 ? new Date(Date.now() - syncRetentionDays * 86400000) : null;
      const prunedUids = [...completedTaskUids].filter(uid => {
        if (!uidCutoff) return true;
        const m = uid.match(/::(\d{4}-\d{2}-\d{2})$/);
        return !m || new Date(m[1]) >= uidCutoff;
      });
      return JSON.stringify(prunedUids);
    });

    const json = (value) => () => JSON.stringify(value);
    saveBucket('day-planner-darkmode', [darkMode], json(darkMode));
    saveBucket('day-planner-sync-url', [syncUrl], () => syncUrl);
    saveBucket('day-planner-task-calendar-url', [taskCalendarUrl], () => taskCalendarUrl);
    saveBucket('day-planner-sync-retention-days', [syncRetentionDays], json(syncRetentionDays));
    saveBucket('day-planner-routine-definitions', [routineDefinitions], json(routineDefinitions));
    saveBucket('day-planner-routines-date', [routinesDate], () => routinesDate);
    saveBucket('day-planner-removed-today-routine-ids', [removedTodayRoutineIds], json(removedTodayRoutineIds));
    saveBucket('day-planner-habits', [habits], json(habits));
    saveBucket('day-planner-habit-logs', [habitLogs], json(habitLogs));
    saveBucket('day-planner-habits-enabled', [habitsEnabled], json(habitsEnabled));
    saveBucket('day-planner-routines-enabled', [routinesEnabled], json(routinesEnabled));
    saveBucket('day-planner-gtd-frames', [gtdFrames], json(gtdFrames));
    saveBucket('day-planner-goals', [goals], json(goals));
    saveBucket('day-planner-projects', [projects], json(projects));
    saveBucket('day-planner-areas', [areas], json(areas));
    saveBucket('day-planner-goals-projects-enabled', [goalsProjectsEnabled], json(goalsProjectsEnabled));
    if (unscheduledOrderTimestamp) saveBucket('day-planner-unscheduled-order-ts', [unscheduledOrderTimestamp], () => unscheduledOrderTimestamp);
    // Only update local-modified after initial cloud sync has run,
    // otherwise the initial loadData() sets it to "now" and overwrites remote
    if (!cloudSyncConfig?.enabled || cloudSyncInitialDoneRef.current) {
      safeSet('day-planner-cloud-sync-local-modified', new Date().toISOString());
      // When this device itself last changed its data, as opposed to taking a
      // change in from a transport (an apply re-persists too) or doing the
      // clock-driven bookkeeping every device does at once (the day rollover,
      // utils/localEditStamp.js). The snapshot file tiers write at once for a
      // change made here and wait for the folder to catch up with one that
      // arrived by another road (sync/snapshotFileSync.js, LOCAL_EDIT_KEY).
      if (!isRemoteApply() && !inBookkeepingWindow()) safeSet('day-planner-local-edit-at', new Date().toISOString());
    }
  };

  return { loadData, saveData, stampTaskTimestamps };
}
