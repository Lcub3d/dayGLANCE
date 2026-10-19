import { useState } from 'react';
import { writeItem } from '../utils/storageWrites.js';

export default function useRecycleBin({
  recycleBin,
  setRecycleBin,
  pushUndo,
  setTasks,
  setUnscheduledTasks,
  playUISound,
  onStorageFull,
}) {
  const [showEmptyBinConfirm, setShowEmptyBinConfirm] = useState(false);
  const [showMobileRecycleBin, setShowMobileRecycleBin] = useState(false);

  const undeleteTask = (id) => {
    pushUndo({ key: 'restored', taskId: id });
    const task = recycleBin.find(t => t.id === id);
    if (task) {
      // Drop the deletion metadata and re-stamp lastModified to "now" so the
      // restore wins against the bin entry on other devices (whose deletedAt is
      // the deletion-time stamp). Without a fresher lastModified the cross-list
      // reconciliation would just send the task straight back to the bin.
      const { _deletedFrom, deletedAt, ...rest } = task;
      const cleanTask = { ...rest, lastModified: new Date().toISOString() };

      if (_deletedFrom === 'inbox') {
        setUnscheduledTasks(prev => [...prev, cleanTask]);
      } else {
        setTasks(prev => [...prev, cleanTask]);
      }

      setRecycleBin(prev => prev.filter(t => t.id !== id));
      playUISound('restore');
    }
  };

  const emptyRecycleBin = () => {
    setShowEmptyBinConfirm(true);
  };

  const confirmEmptyBin = () => {
    // Record tombstones for permanently deleted tasks (prevents resurrection during merge sync).
    // PROVENANCE (see utils/retiredTaskIds.js): user-pressed delete — intent
    // known, no successor — so deletedTaskIds, never retiredTaskIds (the
    // commit-that-renames' channel) or deletedObsidianKeys (the detector's).
    let tombstones = {};
    try { tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}') || {}; } catch { tombstones = {}; }
    const now = new Date().toISOString();
    recycleBin.forEach(t => { tombstones[String(t.id)] = now; });
    // The tombstones are what license the deletion on other devices, so a bin
    // emptied without them comes back on the next sync. When they cannot be
    // written (storage full), stop before anything is removed and say so,
    // rather than throwing out of the handler halfway (#2139).
    if (!writeItem('day-planner-deleted-task-ids', JSON.stringify(tombstones))) {
      setShowEmptyBinConfirm(false);
      onStorageFull?.();
      return;
    }
    pushUndo({ key: 'binEmptied' });
    // Deindex permanently deleted tasks from Spotlight so they don't linger.
    try {
      const ids = recycleBin.map(t => String(t.id));
      if (ids.length > 0) window.DayGlanceNative?.deindexSpotlight?.(JSON.stringify(ids));
    } catch (_) {}
    setRecycleBin([]);
    setShowEmptyBinConfirm(false);
    setShowMobileRecycleBin(false);
    playUISound('crumple');
  };

  return {
    showEmptyBinConfirm,
    setShowEmptyBinConfirm,
    showMobileRecycleBin,
    setShowMobileRecycleBin,
    undeleteTask,
    emptyRecycleBin,
    confirmEmptyBin,
  };
}
