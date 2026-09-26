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

// ── The Day Dial's alarm mark (Android) ──────────────────────────────────────
// Design (Sep 24): the next clock-app alarm rides the dial as a hairline.
//   - Before midnight, for tomorrow's alarm: the line sits at 00 and the time
//     is written beside the "00" label with an arrow (= tomorrow).
//   - After midnight: the line moves to the alarm's real time, icon only, so
//     it sits inside the declared sleep and the gap between planned wake and
//     the alarm reads at a glance.
// Only from a time of day on (dial layer prefs, `fromMin`): during the day
// tomorrow's alarm is noise. An alarm today is shown until it rings, whatever
// the time, because by then the evening that started its window has passed.
// Mirrored in Kotlin (widget/dial/DialAlarm.kt) for the home-screen widget;
// the cases in nextAlarm.test.js are its spec too.

/**
 * @param {number} nowMs      epoch ms "now"
 * @param {number|null} alarmMs  the device's next clock-app alarm
 * @param {number} fromMin    minute of day from which tomorrow's alarm shows
 * @returns {null | {mode: 'tomorrow'|'today', min: number, hhmm: string}}
 *   `min` is where the line goes: 0 for tomorrow, the alarm's minute today.
 */
export function dialAlarmMark(nowMs, alarmMs, fromMin) {
  if (!alarmMs || alarmMs <= nowMs) return null;
  const now = new Date(nowMs);
  const alarm = new Date(alarmMs);
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = dayStart(now);
  const alarmDay = dayStart(alarm);
  const hhmm = alarmHHMM(alarmMs);
  const alarmMin = alarm.getHours() * 60 + alarm.getMinutes();
  if (alarmDay === today) return { mode: 'today', min: alarmMin, hhmm };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  if (alarmDay !== tomorrow) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= fromMin ? { mode: 'tomorrow', min: 0, hhmm } : null;
}
