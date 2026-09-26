import { describe, it, expect } from 'vitest';
import { nextAlarmWithinTomorrow, alarmHHMM, dialAlarmMark } from './nextAlarm.js';

// Local-time epoch ms on a fixed base day (Aug 2) + day offset.
const at = (dayOffset, h, m) => new Date(2026, 7, 2 + dayOffset, h, m, 0, 0).getTime();

describe('nextAlarmWithinTomorrow', () => {
  const now = at(0, 22, 30); // 10:30pm tonight

  it('an alarm tomorrow morning passes through', () => {
    expect(nextAlarmWithinTomorrow(now, at(1, 6, 30))).toBe(at(1, 6, 30));
  });

  it('an alarm later tonight passes through', () => {
    expect(nextAlarmWithinTomorrow(now, at(0, 23, 45))).toBe(at(0, 23, 45));
  });

  it('the end of tomorrow is inclusive; the day after is out', () => {
    expect(nextAlarmWithinTomorrow(now, at(1, 23, 59))).toBe(at(1, 23, 59));
    expect(nextAlarmWithinTomorrow(now, at(2, 0, 30))).toBeNull();
  });

  it('null, absent, or past alarms yield null', () => {
    expect(nextAlarmWithinTomorrow(now, null)).toBeNull();
    expect(nextAlarmWithinTomorrow(now, 0)).toBeNull();
    expect(nextAlarmWithinTomorrow(now, at(0, 8, 0))).toBeNull(); // this morning
  });
});

describe('alarmHHMM', () => {
  it('formats padded local HH:MM', () => {
    expect(alarmHHMM(at(1, 6, 5))).toBe('06:05');
    expect(alarmHHMM(at(1, 23, 45))).toBe('23:45');
  });
});

// The Day Dial's alarm mark. The Kotlin port (DialAlarm.kt) is held to these
// same cases in DialAlarmTest.kt.
describe('dialAlarmMark', () => {
  const from = 18 * 60;

  it('tomorrow morning: nothing during the day, the 00 mark from the evening on', () => {
    expect(dialAlarmMark(at(0, 14, 0), at(1, 6, 30), from)).toBeNull();
    expect(dialAlarmMark(at(0, 17, 59), at(1, 6, 30), from)).toBeNull();
    expect(dialAlarmMark(at(0, 18, 0), at(1, 6, 30), from)).toEqual({ mode: 'tomorrow', min: 0, hhmm: '06:30' });
    expect(dialAlarmMark(at(0, 23, 1), at(1, 6, 30), from)).toEqual({ mode: 'tomorrow', min: 0, hhmm: '06:30' });
  });

  it('after midnight the mark moves to the real time until it rings', () => {
    expect(dialAlarmMark(at(1, 0, 40), at(1, 6, 30), from)).toEqual({ mode: 'today', min: 390, hhmm: '06:30' });
    expect(dialAlarmMark(at(1, 6, 29), at(1, 6, 30), from)).toEqual({ mode: 'today', min: 390, hhmm: '06:30' });
    expect(dialAlarmMark(at(1, 6, 30), at(1, 6, 30), from)).toBeNull();
  });

  it('an alarm later today shows at its time, whatever the hour', () => {
    expect(dialAlarmMark(at(0, 10, 0), at(0, 14, 15), from)).toEqual({ mode: 'today', min: 855, hhmm: '14:15' });
  });

  it('"always" (from 00:00) shows tomorrow\'s all day; further out never shows', () => {
    expect(dialAlarmMark(at(0, 9, 0), at(1, 6, 30), 0)).toEqual({ mode: 'tomorrow', min: 0, hhmm: '06:30' });
    expect(dialAlarmMark(at(0, 22, 0), at(2, 6, 30), 0)).toBeNull();
  });

  it('no alarm, or one already rung, is no mark', () => {
    expect(dialAlarmMark(at(0, 22, 0), null, from)).toBeNull();
    expect(dialAlarmMark(at(0, 22, 0), at(0, 21, 0), from)).toBeNull();
  });
});
