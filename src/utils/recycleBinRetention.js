// Automatic emptying of the Recycle Bin (#2141).
//
// The bin was only ever emptied by hand, so everything deleted stayed in the
// stored (and synced) data for as long as the app was used. The setting
// removes bin items deleted more than N days ago, through the same tombstone
// path as "Empty bin": a permanent deletion has to write `deletedTaskIds`
// first, or the next sync brings the tasks back.

export const BIN_AUTO_EMPTY_KEY = 'day-planner-recycle-bin-auto-empty-days';
export const BIN_AUTO_EMPTY_CHOICES = [0, 7, 30, 90];
const NEW_INSTALL_DEFAULT = 30;

/**
 * The setting's initial value. A saved choice wins. Without one, a fresh
 * install starts at 30 days, while a device that already holds data starts
 * off: silently purging the bin of someone who never chose to would be a
 * surprise, and an irreversible one. The caller persists the result, so the
 * decision is made once per device.
 */
export function readBinAutoEmptyDays(storage = localStorage) {
  try {
    const saved = storage.getItem(BIN_AUTO_EMPTY_KEY);
    if (saved !== null) {
      const days = JSON.parse(saved);
      return BIN_AUTO_EMPTY_CHOICES.includes(days) ? days : 0;
    }
    const hasData = storage.getItem('day-planner-tasks') !== null
      || storage.getItem('day-planner-unscheduled') !== null
      || storage.getItem('day-planner-recycle-bin') !== null;
    return hasData ? 0 : NEW_INSTALL_DEFAULT;
  } catch {
    return 0;
  }
}

/**
 * Bin items deleted more than `days` days before `now`. An item without a
 * readable `deletedAt` never expires: no stamp is no information, and a guess
 * here deletes for good.
 */
export function expiredBinItems(recycleBin, days, now = Date.now()) {
  if (!days || !Array.isArray(recycleBin)) return [];
  const cutoff = now - days * 86400000;
  return recycleBin.filter((item) => {
    const at = Date.parse(item?.deletedAt);
    return Number.isFinite(at) && at < cutoff;
  });
}
