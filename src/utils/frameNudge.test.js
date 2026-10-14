import { describe, it, expect } from 'vitest';
import { planFrameNudge, resolveFrameNudgeAnswer } from './frameNudge.js';

const frame = { frameId: 'f1', label: 'Deep work', start: '09:00', end: '12:00', energyLevel: 'high' };
const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

describe('planFrameNudge', () => {
  const base = { frames: [frame], gapMinutes: 120, inboxTasks: [{ id: 1, title: 'Write', duration: 30 }], todayTasks: [] };

  it('refuses outside any frame', () => {
    expect(planFrameNudge({ ...base, nowMin: at('13:00') }).status).toBe('no-frame');
  });

  it('refuses when the frame has 30 minutes or less left', () => {
    expect(planFrameNudge({ ...base, nowMin: at('11:30') }).status).toBe('frame-ending');
    expect(planFrameNudge({ ...base, nowMin: at('11:29') }).status).toBe('ok');
  });

  it('refuses when the next scheduled task leaves under 15 minutes', () => {
    expect(planFrameNudge({ ...base, nowMin: at('10:00'), gapMinutes: 10 }).status).toBe('no-free-time');
  });

  it('reports no-fit, not success, when every task is longer than the slot', () => {
    // 45 min left in the frame, plenty of calendar gap: the 60-minute task cannot fit.
    const plan = planFrameNudge({ ...base, nowMin: at('11:15'), inboxTasks: [{ id: 1, title: 'Long', duration: 60 }] });
    expect(plan.status).toBe('no-fit');
    expect(plan.effectiveMinutes).toBe(45);
  });

  it('caps the slot at the gap to the next scheduled task', () => {
    const plan = planFrameNudge({ ...base, nowMin: at('09:00'), gapMinutes: 20, inboxTasks: [{ id: 1, title: 'Write', duration: 30 }] });
    expect(plan.status).toBe('no-fit');
    expect(plan.effectiveMinutes).toBe(20);
  });

  it('always offers tasks without a duration', () => {
    const plan = planFrameNudge({ ...base, nowMin: at('11:15'), inboxTasks: [{ id: 2, title: 'Open-ended' }] });
    expect(plan.status).toBe('ok');
    expect(plan.candidates.map(c => c.task.id)).toEqual([2]);
  });

  it('offers today tasks only once their slot has passed, and never completed ones', () => {
    const todayTasks = [
      { id: 'past', startTime: '08:00', duration: 30 },
      { id: 'now', startTime: '09:45', duration: 30 },
      { id: 'later', startTime: '11:00', duration: 15 },
      { id: 'done', startTime: '08:00', duration: 15, completed: true },
    ];
    const plan = planFrameNudge({ ...base, nowMin: at('10:00'), inboxTasks: [], todayTasks });
    expect(plan.candidates).toEqual([{ task: todayTasks[0], isInbox: false }]);
  });

  it('picks the frame that contains now when several are listed out of order', () => {
    const later = { ...frame, frameId: 'f2', start: '13:00', end: '17:00' };
    expect(planFrameNudge({ ...base, frames: [later, frame], nowMin: at('14:00') }).frame.frameId).toBe('f2');
  });
});

describe('resolveFrameNudgeAnswer', () => {
  const candidates = [
    { id: 17, title: 'Numeric id', duration: 30, isInbox: true },
    { id: 'abc', title: 'Long one', duration: 90, isInbox: false },
  ];

  it('returns the candidate own id, so a string echo of a numeric id still starts the task', () => {
    expect(resolveFrameNudgeAnswer({ taskId: '17', reason: 'fits' }, candidates, 60))
      .toEqual({ taskId: 17, taskTitle: 'Numeric id', reason: 'fits', isInbox: true });
  });

  it('returns null for a missing, unknown, or oversized pick', () => {
    expect(resolveFrameNudgeAnswer({}, candidates, 60)).toBeNull();
    expect(resolveFrameNudgeAnswer(null, candidates, 60)).toBeNull();
    expect(resolveFrameNudgeAnswer({ taskId: 'nope' }, candidates, 60)).toBeNull();
    expect(resolveFrameNudgeAnswer({ taskId: 'abc' }, candidates, 60)).toBeNull();
  });
});
