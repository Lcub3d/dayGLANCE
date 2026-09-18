import { describe, it, expect } from 'vitest';
import { msUntilMidnightRefresh, MIDNIGHT_REFRESH_OFFSET_SECONDS } from './midnightRefresh.js';

const localTime = (y, m, d, h, min, s, ms = 0) => new Date(y, m - 1, d, h, min, s, ms);

describe('msUntilMidnightRefresh', () => {
  it('targets 00:00:30 local of the next day', () => {
    const now = localTime(2026, 9, 17, 19, 30, 0);
    const fireAt = new Date(now.getTime() + msUntilMidnightRefresh(now));
    expect(fireAt.getDate()).toBe(18);
    expect([fireAt.getHours(), fireAt.getMinutes(), fireAt.getSeconds(), fireAt.getMilliseconds()])
      .toEqual([0, 0, MIDNIGHT_REFRESH_OFFSET_SECONDS, 0]);
  });

  it('waits past the worst-case first clock tick after midnight (15s cadence) so the rollover runs first', () => {
    expect(MIDNIGHT_REFRESH_OFFSET_SECONDS).toBeGreaterThan(15);
  });

  it('just before the target still fires the SAME night, not 24h later', () => {
    // 23:59:59.500 → the next 00:00:30 is 30.5s away, not a day and 30s.
    const now = localTime(2026, 9, 17, 23, 59, 59, 500);
    expect(msUntilMidnightRefresh(now)).toBe(30_500);
  });

  it('just after the target schedules the following night', () => {
    // 00:00:31 → the next 00:00:30 is tomorrow's.
    const now = localTime(2026, 9, 18, 0, 0, 31);
    const fireAt = new Date(now.getTime() + msUntilMidnightRefresh(now));
    expect(fireAt.getDate()).toBe(19);
    expect(fireAt.getSeconds()).toBe(MIDNIGHT_REFRESH_OFFSET_SECONDS);
  });

  it('lands on the local clock time across a DST change', () => {
    // Whatever zone the test runs in, the target is defined by local
    // setDate/setHours, so it is always local 00:00:30 of the next calendar day.
    const now = localTime(2026, 11, 1, 12, 0, 0); // US DST ends 2026-11-01
    const fireAt = new Date(now.getTime() + msUntilMidnightRefresh(now));
    expect(fireAt.getDate()).toBe(2);
    expect([fireAt.getHours(), fireAt.getMinutes(), fireAt.getSeconds()]).toEqual([0, 0, MIDNIGHT_REFRESH_OFFSET_SECONDS]);
  });
});
