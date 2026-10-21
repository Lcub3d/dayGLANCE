import { useEffect } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { writeItem } from '../utils/storageWrites.js';
import {
  addSample, projectStorage, shouldWarn, readSamples, storageTotalBytes,
  STORAGE_SAMPLES_KEY, STORAGE_WARNED_KEY, WARN_DAYS,
} from '../utils/storageProjection.js';

// One sample of the local-storage total per day, and a warning at most once a
// week when it is close to full (utils/storageProjection.js, #2141). Runs once
// the data has loaded: the app reloads every night, so that is a daily sample.
// The tray never writes.
export default function useStorageProjection({ dataLoaded, isTrayMode, setUndoToast, t, storage = globalThis.localStorage, now = () => new Date() }) {
  useEffect(() => {
    if (isTrayMode || !dataLoaded || !storage) return;
    const today = dateToString(now());
    const current = storageTotalBytes(storage);
    const samples = addSample(readSamples(storage), today, current);
    writeItem(STORAGE_SAMPLES_KEY, JSON.stringify(samples));
    const projection = projectStorage(samples, { today, current });
    let lastWarned = null;
    try { lastWarned = storage.getItem(STORAGE_WARNED_KEY); } catch { /* treat as never */ }
    if (!shouldWarn(projection, { current, today, lastWarned })) return;
    const message = projection.status === 'growing' && projection.daysLeft <= WARN_DAYS
      ? t('storage.projectionWarningSoon', { count: Math.max(1, projection.daysLeft) })
      : t('storage.projectionWarningFull');
    setUndoToast({ message, kind: 'warning' });
    writeItem(STORAGE_WARNED_KEY, today);
    // Once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded]);
}
