import { describe, it, expect } from 'vitest';
import {
  DIAL_FRAME_MAX_DEPTH,
  computeDialFrames,
  dialCurrentFrame,
  dialFrameAvailableMinutes,
  dialFrameRadii,
  muteDialColor,
  muteDialColorWith,
  muteDialFrameColor,
  projectDialSnapshot,
} from './dayDial.js';
import { frameColorToHex } from './colorUtils.js';
import { buildScheduleSections } from './widgetDayProjection.js';

// docs/day-dial-frames-spec.html: the enclosure, its colour, the hub's
// current frame and the Frames percentage.

const frame = (over) => ({ frameId: 'f', label: 'Frame', color: 'bg-blue-200', start: '09:00', end: '12:00', ...over });
const block = (startMin, endMin) => ({ startMin, endMin });

describe('frame geometry', () => {
  it('is the spec at the widget band: 126 and 153, 3.2 in per level, 1.8 wide', () => {
    const top = dialFrameRadii(129, 151, 0);
    expect(top.inner).toBeCloseTo(126, 10);
    expect(top.outer).toBeCloseTo(153, 10);
    expect(top.width).toBeCloseTo(1.8, 10);
    const nested = dialFrameRadii(129, 151, 1);
    expect(nested.inner).toBeCloseTo(129.2, 10);
    expect(nested.outer).toBeCloseTo(149.8, 10);
  });

  it('caps the depth, so a deeper frame draws at the deepest level', () => {
    expect(DIAL_FRAME_MAX_DEPTH).toBe(1);
    expect(dialFrameRadii(129, 151, 3)).toEqual(dialFrameRadii(129, 151, 1));
  });

  it('scales with the band: the in-app dial keeps the proportions', () => {
    const app = dialFrameRadii(300, 385, 0);
    expect((300 - app.inner) / 85).toBeCloseTo(3 / 22, 10);
    expect((app.outer - 385) / 85).toBeCloseTo(2 / 22, 10);
    expect(app.width / 85).toBeCloseTo(1.8 / 22, 10);
  });
});

describe('frame colour', () => {
  it('resolves the editor pastel classes to their family, not the fallback blue', () => {
    expect(frameColorToHex('bg-rose-200')).toBe('#f43f5e');
    expect(frameColorToHex('bg-amber-200')).toBe('#f59e0b');
    expect(frameColorToHex(undefined)).toBe('#6366f1');
  });

  it('muteDialColor is the parameterised mute at its old constants', () => {
    for (const hex of ['#3b82f6', '#ef4444', '#22c55e', '#000000', '#ffffff']) {
      expect(muteDialColorWith(hex, 0.5, 0.73)).toBe(muteDialColor(hex));
    }
  });

  it('the ring is softer than the title: same hue, lower saturation and lightness', () => {
    const lum = (hex) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0);
    const ring = muteDialFrameColor('#f43f5e');
    const title = muteDialColor('#f43f5e');
    expect(ring).not.toBe(title);
    expect(lum(ring)).toBeLessThan(lum(title));
  });

  it('the widget sections now carry the frame colour', () => {
    const sections = buildScheduleSections({
      scheduled: [], frames: [frame({ color: 'bg-rose-200' })], frameAvailableMinutes: () => 60, serialize: (t) => t,
    });
    expect(sections[0].colorHex).toBe('#f43f5e');
  });
});

describe('computeDialFrames', () => {
  it('nests by containment, capped, and orders by start', () => {
    const { frames } = computeDialFrames([
      frame({ frameId: 'outer', start: '09:00', end: '17:00' }),
      frame({ frameId: 'mid', start: '10:00', end: '12:00' }),
      frame({ frameId: 'inner', start: '10:30', end: '11:00' }),
    ]);
    expect(frames.map((f) => [f.id, f.depth])).toEqual([['outer', 0], ['mid', 1], ['inner', 1]]);
  });

  it('overlap without containment leaves both at the top level', () => {
    const { frames } = computeDialFrames([
      frame({ frameId: 'a', start: '09:00', end: '11:00' }),
      frame({ frameId: 'b', start: '10:00', end: '12:00' }),
    ]);
    expect(frames.map((f) => f.depth)).toEqual([0, 0]);
  });

  it('an identical span nests the later frame inside the earlier', () => {
    const { frames } = computeDialFrames([frame({ frameId: 'a' }), frame({ frameId: 'b' })]);
    expect(frames.map((f) => [f.id, f.depth])).toEqual([['a', 0], ['b', 1]]);
  });

  it('drops a frame that does not end after it starts, and clamps to the day', () => {
    const { frames } = computeDialFrames([
      frame({ frameId: 'midnight', start: '22:00', end: '01:00' }),
      frame({ frameId: 'late', start: '23:00', end: '24:30' }),
    ]);
    expect(frames.map((f) => [f.id, f.startMin, f.endMin])).toEqual([['late', 1380, 1440]]);
  });

  it('percent: framed block minutes over top-level frame minutes, blocks merged', () => {
    const { percent } = computeDialFrames(
      [frame({ start: '09:00', end: '11:00' }), frame({ frameId: 'in', start: '09:30', end: '10:00' })],
      // Two lanes over 09:00–10:00 count once; the part outside the frame does not count.
      [block(540, 600), block(560, 600), block(650, 700)],
    );
    // 60 + 10 of 120.
    expect(percent).toBe(58);
  });

  it('an overlap does not count a minute twice in the denominator', () => {
    const { percent } = computeDialFrames(
      [frame({ frameId: 'a', start: '09:00', end: '11:00' }), frame({ frameId: 'b', start: '10:00', end: '12:00' })],
      [block(540, 720)],
    );
    expect(percent).toBe(100);
  });

  it('a frame with nothing in it is 0 %, and a day without frames has no number', () => {
    expect(computeDialFrames([frame()], []).percent).toBe(0);
    expect(computeDialFrames([], [block(0, 60)]).percent).toBeNull();
    expect(computeDialFrames(null).percent).toBeNull();
  });
});

describe('the hub’s frame', () => {
  const { frames } = computeDialFrames([
    frame({ frameId: 'day', start: '09:00', end: '17:00', slots: [{ start: '09:00', end: '10:00' }, { start: '15:00', end: '16:00' }] }),
    frame({ frameId: 'focus', start: '13:00', end: '14:00', slots: [{ start: '13:00', end: '14:00' }] }),
  ]);

  it('is the innermost frame now is inside, and none outside or without a clock', () => {
    expect(dialCurrentFrame(frames, 800)?.id).toBe('focus');
    expect(dialCurrentFrame(frames, 700)?.id).toBe('day');
    expect(dialCurrentFrame(frames, 1020)).toBeNull();
    expect(dialCurrentFrame(frames, null)).toBeNull();
  });

  it('available is the free slots from now on', () => {
    const day = frames[0];
    expect(dialFrameAvailableMinutes(day, 540)).toBe(120);
    expect(dialFrameAvailableMinutes(day, 570)).toBe(90);
    expect(dialFrameAvailableMinutes(day, 700)).toBe(60);
    expect(dialFrameAvailableMinutes(day, 1000)).toBe(0);
  });
});

describe('projectDialSnapshot frames', () => {
  const dayTasks = [{ id: 1, title: 'Deep', startTime: '09:00', duration: 60, color: 'bg-blue-500' }];

  it('ships the frames and the percentage, slots as minute pairs', () => {
    const snap = projectDialSnapshot({
      date: '2026-09-21', dayTasks,
      frames: [frame({ label: 'Morning', color: 'bg-teal-200', slots: [{ start: '10:00', end: '12:00' }] })],
    });
    expect(snap.frames).toEqual([{
      name: 'Morning', colorHex: '#14b8a6', startMin: 540, endMin: 720, depth: 0, slots: [[600, 720]],
    }]);
    expect(snap.totals.framesPercent).toBe(33);
  });

  it('a day without frames ships an empty list and no percentage', () => {
    const snap = projectDialSnapshot({ date: '2026-09-21', dayTasks });
    expect(snap.frames).toEqual([]);
    expect(snap.totals.framesPercent).toBeNull();
  });
});
