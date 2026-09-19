import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dayOfWeekFor, frameAppliesTo, frameInstancesForDate } from './frameInstances.js';
import { FRAME_ID_PREFIX, frameWireId, toFrameObject, buildFrames } from './mcpFrames.js';
import { buildDayBlocks } from './mcpReadModel.js';

// 2026-09-19 is a Saturday (day 6); 2026-09-21 a Monday (day 1).
const SAT = '2026-09-19';
const MON = '2026-09-21';

const F = (over = {}) => ({
  id: 'f1', label: 'Deep work', enabled: true, days: [1, 2, 3, 4, 5],
  start: '09:00', end: '12:00', color: 'blue',
  tagAffinity: ['#writing'], energyLevel: 'high', bufferMinutes: 5, ...over,
});

const T = (over = {}) => ({
  id: 't1', title: 'Task', date: MON, startTime: '10:00', duration: 60, isAllDay: false, ...over,
});

const R = (over = {}) => ({
  id: 'r1', name: 'Morning pages', startTime: '09:30', duration: 30, isAllDay: false, ...over,
});

const state = (over = {}) => ({
  frames: [F()], tasks: [], recurringTasks: [],
  routines: [], routinesDate: MON, routineCompletions: {}, routinesEnabled: true,
  todayDate: MON, nowMinutes: 0, ...over,
});

describe('frameInstancesForDate', () => {
  it('resolves a weekday rule', () => {
    expect(frameInstancesForDate([F()], MON)).toHaveLength(1);
    expect(frameInstancesForDate([F()], SAT)).toHaveLength(0);
  });

  it('honours enabled', () => {
    expect(frameInstancesForDate([F({ enabled: false })], MON)).toEqual([]);
  });

  it('honours singleDate, which overrides the weekday rule entirely', () => {
    const pinned = F({ singleDate: SAT, days: [1, 2, 3, 4, 5] });
    expect(frameInstancesForDate([pinned], SAT)).toHaveLength(1);
    // Monday is in `days`, but singleDate wins.
    expect(frameInstancesForDate([pinned], MON)).toHaveLength(0);
  });

  it('applies a per-date start/end exception', () => {
    const withException = F({ exceptions: { [MON]: { start: '10:00', end: '11:00' } } });
    const [inst] = frameInstancesForDate([withException], MON);
    expect([inst.start, inst.end]).toEqual(['10:00', '11:00']);
    // Other dates are untouched.
    expect(frameInstancesForDate([withException], '2026-09-22')[0].start).toBe('09:00');
  });

  it('drops an instance deleted for that date only', () => {
    const withDelete = F({ exceptions: { [MON]: { deleted: true } } });
    expect(frameInstancesForDate([withDelete], MON)).toEqual([]);
    expect(frameInstancesForDate([withDelete], '2026-09-22')).toHaveLength(1);
  });

  it('defaults bufferMinutes to 5, energyLevel to medium, tagAffinity to []', () => {
    const bare = { id: 'f2', label: 'Bare', enabled: true, days: [1], start: '09:00', end: '10:00' };
    expect(frameInstancesForDate([bare], MON)[0]).toMatchObject({
      bufferMinutes: 5, energyLevel: 'medium', tagAffinity: [],
    });
  });

  it('keeps an explicit bufferMinutes of 0 rather than defaulting it', () => {
    // ?? not ||, so a deliberate zero-buffer frame is not silently given 5.
    expect(frameInstancesForDate([F({ bufferMinutes: 0 })], MON)[0].bufferMinutes).toBe(0);
  });

  it('tolerates a malformed date and a missing days array', () => {
    expect(dayOfWeekFor('nonsense')).toBeNull();
    expect(frameInstancesForDate([F()], 'nonsense')).toEqual([]);
    expect(frameAppliesTo(F({ days: undefined }), MON, 1)).toBe(false);
  });
});

describe('frame objects', () => {
  it('namespaces the id by frame AND date', () => {
    // A frame recurs, so the id has to say which instance this is.
    expect(frameWireId('f1', MON)).toBe('frame-f1-2026-09-21');
    expect(frameWireId('f1', MON).startsWith(FRAME_ID_PREFIX)).toBe(true);
  });

  it('carries affinity, energy, buffer and the free slots', () => {
    const [inst] = frameInstancesForDate([F()], MON);
    expect(toFrameObject(inst, [{ start: '09:00', end: '12:00', minutes: 180 }])).toEqual({
      id: 'frame-f1-2026-09-21',
      type: 'frame',
      label: 'Deep work',
      date: MON,
      start: '09:00',
      end: '12:00',
      energy_level: 'high',
      buffer_minutes: 5,
      tag_affinity: ['#writing'],
      available_minutes: 180,
      available_slots: [{ start: '09:00', end: '12:00', minutes: 180 }],
      read_only: true,
    });
  });

  it('sums available_minutes across split slots', () => {
    const [inst] = frameInstancesForDate([F()], MON);
    const obj = toFrameObject(inst, [
      { start: '09:00', end: '10:00', minutes: 60 },
      { start: '11:00', end: '12:00', minutes: 60 },
    ]);
    expect(obj.available_minutes).toBe(120);
  });
});

describe('buildFrames availability', () => {
  it('reports the whole frame free on an empty day', () => {
    const [f] = buildFrames(state(), MON);
    expect(f.available_minutes).toBe(180);
  });

  it('subtracts a task, with the frame buffer applied', () => {
    // 10:00-11:00 task, 5-minute buffer: free is 09:00-09:55 and 11:05-12:00.
    const [f] = buildFrames(state({ tasks: [T()] }), MON);
    expect(f.available_slots).toEqual([
      { start: '09:00', end: '09:55', minutes: 55 },
      { start: '11:05', end: '12:00', minutes: 55 },
    ]);
  });

  it('subtracts a ROUTINE, which is the whole point of the occupancy work', () => {
    const [f] = buildFrames(state({ routines: [R()] }), MON);
    expect(f.available_minutes).toBeLessThan(180);
    expect(f.available_slots.some((s) => s.start === '09:00' && s.end === '09:25')).toBe(true);
  });

  it('clips today to the current minute', () => {
    const [f] = buildFrames(state({ nowMinutes: 10 * 60 + 30 }), MON);
    expect(f.available_slots).toEqual([{ start: '10:30', end: '12:00', minutes: 90 }]);
  });

  it('reports a past date as fully spent', () => {
    const [f] = buildFrames(state({ todayDate: '2026-09-22' }), MON);
    expect(f.available_minutes).toBe(0);
  });

  it('does not clip a future date', () => {
    const [f] = buildFrames(state({ todayDate: '2026-09-20', nowMinutes: 23 * 60 }), MON);
    expect(f.available_minutes).toBe(180);
  });

  it('ignores tasks on other dates', () => {
    const [f] = buildFrames(state({ tasks: [T({ date: '2026-09-22' })] }), MON);
    expect(f.available_minutes).toBe(180);
  });

  it('returns [] for a date with no frames and for a missing date', () => {
    expect(buildFrames(state(), SAT)).toEqual([]);
    expect(buildFrames(state(), undefined)).toEqual([]);
    expect(buildFrames(undefined, MON)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Availability must not leak calendar data the user declined to share.
// ---------------------------------------------------------------------------
describe('device calendar events follow the consent tier', () => {
  const nativeDay = state({ tasks: [T({ id: 'n1', _native: true, startTime: '10:00', duration: 60 })] });

  it('ignores _native events without the calendar tier', () => {
    // Counting them would shrink available_minutes around meetings the caller
    // cannot see, letting it infer both their existence and their span by
    // comparing free time against the blocks it IS allowed to read.
    const [f] = buildFrames(nativeDay, MON, { includeNative: false });
    expect(f.available_minutes).toBe(180);
  });

  it('counts _native events under the calendar tier', () => {
    const [f] = buildFrames(nativeDay, MON, { includeNative: true });
    expect(f.available_minutes).toBeLessThan(180);
  });

  it('matches what get_day reports for the same tier', () => {
    // The invariant: availability describes exactly the data the tier
    // permits, so free time and visible blocks never tell different stories.
    const withoutTier = buildDayBlocks(nativeDay, { date: MON });
    expect(withoutTier.blocks.some((b) => b.type === 'device_calendar_event')).toBe(false);
    expect(withoutTier.frames[0].available_minutes).toBe(180);

    const withTier = buildDayBlocks(nativeDay, { date: MON, include_native: true });
    expect(withTier.blocks.some((b) => b.type === 'device_calendar_event')).toBe(true);
    expect(withTier.frames[0].available_minutes).toBeLessThan(180);
  });
});

// ---------------------------------------------------------------------------
// Same leak as routines, same shape of defence.
// ---------------------------------------------------------------------------
describe('frame ownership is scoped BEFORE the bridge', () => {
  const mine = F({ id: 'mine', label: 'My frame', ownerSyncId: 'user-me' });
  const theirs = F({ id: 'theirs', label: 'Their frame', ownerSyncId: 'user-other' });

  const ownedBy = (item, syncId) => !item.ownerSyncId || item.ownerSyncId === syncId;
  const isVisibleForUser = (t) => {
    const assigned = t.assignedUserSyncIds ?? [];
    return assigned.length === 0 || assigned.includes('user-me');
  };

  it('does not surface a frame owned by another user', () => {
    const scoped = [mine, theirs].filter((f) => ownedBy(f, 'user-me'));
    expect(buildFrames(state({ frames: scoped }), MON).map((f) => f.label)).toEqual(['My frame']);
  });

  it('proves isVisibleForUser cannot do this job for frames either', () => {
    // Frames carry ownerSyncId, not assignedUserSyncIds, so the predicate
    // every other slice uses admits BOTH.
    expect([mine, theirs].filter(isVisibleForUser)).toHaveLength(2);
    expect([mine, theirs].filter((f) => ownedBy(f, 'user-me'))).toHaveLength(1);
  });

  it('pins App.jsx to the SCOPED memo for frames', () => {
    // The mutation this guards: `frames: myFrames` becoming `frames: gtdFrames`
    // in the useMcpBridge call. That edit lives in wiring no unit test here can
    // reach, and it leaks one member's frames to another with the suite green.
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
    const bridgeCall = app.slice(app.indexOf('useMcpBridge({'));
    const framesArg = /\n\s*frames:\s*(\w+),/.exec(bridgeCall);
    expect(framesArg).not.toBeNull();
    expect(framesArg[1]).toBe('myFrames');
    expect(framesArg[1]).not.toBe('gtdFrames');
  });

  it('pins the frame wrapper in App.jsx to an owner-scoped list', () => {
    // The UI path has the same exposure: getFrameInstancesForDate must filter
    // by ownedBy before handing the roster to the pure module, which by
    // contract does not scope.
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
    const wrapper = app.slice(app.indexOf('const getFrameInstancesForDate'), app.indexOf('const getFrameInstancesForDate') + 500);
    expect(wrapper).toContain('ownedBy(f, meUserSyncId)');
  });
});

describe('frames in the get_day envelope', () => {
  it('rides alongside blocks rather than inside them', () => {
    const day = buildDayBlocks(state({ tasks: [T()] }), { date: MON });
    // A frame is a window, not work. Existing callers iterating `blocks` must
    // not start seeing them.
    expect(day.blocks.every((b) => b.type !== 'frame')).toBe(true);
    expect(day.frames.map((f) => f.type)).toEqual(['frame']);
  });

  it('is present and empty on a day with no frames', () => {
    // An absent key and an empty array read differently to a model: absent
    // invites "frames are unsupported", empty says "none today".
    expect(buildDayBlocks(state(), { date: SAT }).frames).toEqual([]);
  });
});
