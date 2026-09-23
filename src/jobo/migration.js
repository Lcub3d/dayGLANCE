// JOBO prototype/legacy normalization boundary. Public access is via core.js.

import { own, plain } from './internal/json.js';
import { civilMinute } from './internal/civilTime.js';
import { DO_PROGRESS, DO_TIMING, createDoRecord } from './record.js';

const LEGACY_PROGRESS_TO_PROGRESS = Object.freeze({
  started: DO_PROGRESS.STARTED,
  partial: DO_PROGRESS.PARTIAL,
  mostly: DO_PROGRESS.MOSTLY,
  complete: DO_PROGRESS.COMPLETED,
});

/**
 * Prototype-import boundary. Current canonical Do rows do not pass through
 * migration; the importer uses this for prototype progress and timing values.
 */
export function migrateLegacyDoRecord(record) {
  if (!plain(record)) throw new TypeError('Legacy Do record must be a plain object');
  const progress = LEGACY_PROGRESS_TO_PROGRESS[record.progress];
  if (!progress) throw new TypeError('Unknown legacy Do progress');

  const migrated = { ...record, progress };

  // Prototype rows predate the explicit Timed / Untimed discriminant.
  if (!own(migrated, 'timing')) {
    try {
      const duration = civilMinute(migrated.endDate, migrated.endTime)
        - civilMinute(migrated.date, migrated.startTime);
      if (duration > 0) {
        migrated.timing = DO_TIMING.TIMED;
      } else if (duration === 0 && migrated.source === 'completion') {
        migrated.timing = DO_TIMING.UNTIMED;
        migrated.startTime = null;
        migrated.endDate = null;
        migrated.endTime = null;
      }
    } catch {
      // createDoRecord below remains the strict validation boundary.
    }
  }

  return createDoRecord(migrated);
}

