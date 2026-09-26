// GLANCEahead's "next alarm" line — the bedtime question is "when am I waking
// up?", so the device's next alarm clock is only relevant while it rings
// before the END OF TOMORROW (GLANCEahead is a tomorrow preview; an alarm set
// for next Saturday is not an answer). Android-only in practice: iOS has no
// API for reading the user's Clock alarms.

/**
 * @param {number} nowMs epoch ms "now"
 * @param {number|null} alarmMs epoch ms of the device's next alarm clock
 * @returns {number|null} alarmMs when it rings after now and before the end
 *   of tomorrow (local time), else null
 */
export function nextAlarmWithinTomorrow(nowMs, alarmMs) {
  if (!alarmMs || alarmMs <= nowMs) return null;
  const end = new Date(nowMs);
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  return alarmMs <= end.getTime() ? alarmMs : null;
}

/** 'HH:MM' of an epoch-ms instant, ready for the app's formatTime. */
export function alarmHHMM(alarmMs) {
  const d = new Date(alarmMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * TEMPORARY diagnostic: one line describing the bridge's next-alarm reading
 * (nativeGetNextAlarmDebug), e.g.
 * "alarm debug: Sat 06:30 · com.google.android.deskclock · accepted".
 */
export function formatAlarmDebug(debug, formatTime = (hhmm) => hhmm) {
  if (!debug) return '';
  const when = debug.triggerTime
    ? `${new Date(debug.triggerTime).toLocaleDateString(undefined, { weekday: 'short' })} ${formatTime(alarmHHMM(debug.triggerTime))}`
    : 'no alarm';
  const creator = debug.creatorPackage
    || (debug.hasShowIntent ? 'creator hidden' : 'no show intent');
  const uid = debug.creatorUid != null ? ` (uid ${debug.creatorUid})` : '';
  const uidPkgs = debug.uidPackages?.length ? ` [${debug.uidPackages.join(', ')}]` : '';
  const verdict = debug.triggerTime ? ` · ${debug.accepted ? 'accepted' : 'rejected'}` : '';
  return `alarm debug: ${when} · ${creator}${uid}${uidPkgs}${verdict}`;
}
