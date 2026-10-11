import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseICS, expandMultiDayEvent, filterByDateWindow } from '../utils/icsParser.js';

const DELETED_TASK_IDS = 'day-planner-deleted-task-ids';
const isReplaced = (task, asTaskCalendar) => task.importSource === 'file' &&
  (asTaskCalendar ? task.isTaskCalendar : task.imported && !task.isTaskCalendar);

// The two import modes replace separate file-backed subsets. A uid retained by
// the new file must never receive a deletion marker.
export function planCalendarFileImport(tasks, importedTasks, asTaskCalendar, tombstones, nowIso, storedTasks = []) {
  const importedIds = new Set([...importedTasks, ...tasks.filter(task => !isReplaced(task, asTaskCalendar))]
    .map(task => String(task.id)));
  const removed = tasks.filter(task => isReplaced(task, asTaskCalendar) && !importedIds.has(String(task.id)));
  // saveData stamps the persisted copy, not necessarily the live state. Use
  // both to order an explicit deletion/restore after every known local copy.
  const latestStamp = new Map();
  for (const task of [...storedTasks, ...tasks]) {
    const id = String(task.id);
    latestStamp.set(id, Math.max(latestStamp.get(id) || 0, Date.parse(task.lastModified) || 0));
  }
  const deletedTaskIds = { ...tombstones };
  for (const task of removed) {
    // The merge only deletes on a STRICTLY newer timestamp, including when
    // import, save and replacement all occur in the same millisecond.
    deletedTaskIds[task.id] = new Date(Math.max(
      Date.parse(nowIso), latestStamp.get(String(task.id)) || 0,
      Date.parse(tombstones[task.id]) || 0,
    ) + 1).toISOString();
  }
  const restoredTasks = importedTasks.map(task => {
    const deletedAt = Date.parse(tombstones[task.id]);
    // Re-import is an explicit restore. Keep the tombstone for stale peers,
    // but let this copy survive the outbound filter, which runs BEFORE stamps.
    return Number.isFinite(deletedAt)
      ? { ...task, lastModified: new Date(Math.max(
        Date.parse(nowIso), deletedAt, latestStamp.get(String(task.id)) || 0,
      ) + 1).toISOString() }
      : task;
  });
  return { deletedTaskIds, removed, importedTasks: restoredTasks };
}

export default function useCalendarFileImport({
  tasks, setTasks, pendingImportFile, setPendingImportFile, setShowImportModal,
  importColor, setImportColor, syncRetentionDays, setSyncNotification, t,
}) {
  const generation = useRef(0);
  const selection = useRef(null);
  const activeReader = useRef(null);
  const [readyImport, setReadyImport] = useState(null);

  const invalidate = () => {
    generation.current += 1;
    const reader = activeReader.current;
    activeReader.current = null;
    if (reader?.readyState === 1) reader.abort();
  };
  useEffect(() => () => invalidate(), []);

  const fail = () => setSyncNotification({
    type: 'error', title: t('sync.icalImportTitle'), message: t('settings.syncFailed'),
  });

  // Commit against the latest rendered tasks, before persistence/sync effects.
  // Storage writes stay out of React's replayable state updater. If tombstones
  // cannot be saved, leave the existing tasks and the selection available.
  useLayoutEffect(() => {
    if (!readyImport || readyImport.generation !== generation.current || readyImport.file !== selection.current) return;
    const { importedTasks, asTaskCalendar } = readyImport;
    let plan;
    try {
      const tombstones = JSON.parse(localStorage.getItem(DELETED_TASK_IDS) || '{}');
      if (!tombstones || Array.isArray(tombstones) || typeof tombstones !== 'object') throw new Error('Invalid task tombstones');
      const storedTasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
      if (!Array.isArray(storedTasks)) throw new Error('Invalid stored tasks');
      plan = planCalendarFileImport(tasks, importedTasks, asTaskCalendar, tombstones, new Date().toISOString(), storedTasks);
      if (plan.removed.length) localStorage.setItem(DELETED_TASK_IDS, JSON.stringify(plan.deletedTaskIds));
    } catch {
      setReadyImport(null);
      setSyncNotification({ type: 'error', title: t('sync.icalImportTitle'), message: t('settings.syncFailed') });
      return;
    }
    setTasks(prev => [...prev.filter(task => !isReplaced(task, asTaskCalendar)), ...plan.importedTasks]);
    selection.current = null;
    setReadyImport(null);
    setPendingImportFile(null);
    setShowImportModal(false);
    const count = importedTasks.length;
    setSyncNotification({
      type: count > 0 ? 'success' : 'info',
      title: t('sync.icalImportTitle'),
      message: count > 0 ? t('sync.icalImportedCount', { count }) : t('sync.icalImportEmpty'),
    });
  }, [readyImport, tasks, setTasks, setPendingImportFile, setShowImportModal, setSyncNotification, t]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    invalidate();
    selection.current = file;
    setReadyImport(null);
    setPendingImportFile(file);
    setImportColor('bg-gray-600');
    setShowImportModal(true);
    event.target.value = '';
  };

  const cancelImport = () => {
    invalidate();
    selection.current = null;
    setReadyImport(null);
    setShowImportModal(false);
    setPendingImportFile(null);
  };

  const processImportFile = (asTaskCalendar) => {
    if (!pendingImportFile || pendingImportFile !== selection.current) return;
    invalidate();
    setReadyImport(null);
    const currentGeneration = generation.current;
    const reader = new FileReader();
    activeReader.current = reader;
    const isCurrent = () => currentGeneration === generation.current &&
      selection.current === pendingImportFile && activeReader.current === reader;
    reader.onload = (event) => {
      if (!isCurrent()) return;
      activeReader.current = null;
      try {
        const events = parseICS(event.target.result);
        const freshCompletedUids = new Set(JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]'));
        const allImported = events.flatMap(event => expandMultiDayEvent(event, {
          asTaskCalendar, freshCompletedUids, color: importColor, importSource: 'file',
        }));
        setReadyImport({ generation: currentGeneration, file: pendingImportFile, asTaskCalendar,
          importedTasks: filterByDateWindow(allImported, syncRetentionDays) });
      } catch { fail(); }
    };
    reader.onerror = () => {
      if (!isCurrent()) return;
      activeReader.current = null;
      fail();
    };
    try {
      reader.readAsText(pendingImportFile);
    } catch {
      if (!isCurrent()) return;
      activeReader.current = null;
      fail();
    }
  };

  return { handleFileUpload, processImportFile, cancelImport };
}
