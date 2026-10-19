import { describe, expect, it } from 'vitest';
import { latestSyncedAt } from './launcherHeartbeat.js';

describe('latestSyncedAt', () => {
  it('takes the latest valid stamp and ignores the rest', () => {
    expect(latestSyncedAt('2026-10-19T10:00:00.000Z', null, '2026-10-19T12:30:00.000Z', 'nope', undefined)).toBe('2026-10-19T12:30:00.000Z');
    expect(latestSyncedAt(null, undefined, '')).toBeNull();
    expect(latestSyncedAt()).toBeNull();
    expect(latestSyncedAt('2026-10-19T10:00:00-06:00')).toBe('2026-10-19T16:00:00.000Z');
  });
});
