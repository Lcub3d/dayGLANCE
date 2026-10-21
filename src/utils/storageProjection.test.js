import { describe, it, expect } from 'vitest';
import {
  addSample, projectStorage, shouldWarn, describeTimeLeft, storageTotalBytes, STORAGE_LIMIT_BYTES,
} from './storageProjection.js';

const MB = 1024 * 1024;
// Daily samples from `start`, `days` long, growing by `perDay` bytes from `base`.
const series = (start, days, base, perDay) => Array.from({ length: days }, (_, i) => {
  const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
  return { date: d, bytes: base + i * perDay };
});

describe('addSample', () => {
  it('replaces the same day, keeps order, and stays bounded', () => {
    let s = addSample([], '2026-10-02', 10);
    s = addSample(s, '2026-10-01', 5);
    s = addSample(s, '2026-10-02', 12);
    expect(s).toEqual([{ date: '2026-10-01', bytes: 5 }, { date: '2026-10-02', bytes: 12 }]);
    const long = series('2026-01-01', 200, 0, 1).reduce((acc, x) => addSample(acc, x.date, x.bytes), []);
    expect(long).toHaveLength(120);
    expect(long.at(-1).date).toBe('2026-07-19');
  });

  it('drops malformed samples', () => {
    expect(addSample([null, { date: 'x' }, { date: '2026-10-01', bytes: 1 }], '2026-10-02', 2)).toHaveLength(2);
  });
});

describe('projectStorage', () => {
  it('waits for a week of history', () => {
    expect(projectStorage(series('2026-10-15', 5, MB, 10000), { today: '2026-10-19' })).toEqual({ status: 'pending' });
    expect(projectStorage([], { today: '2026-10-19' })).toEqual({ status: 'pending' });
  });

  it('reads a flat or shrinking store as not growing', () => {
    expect(projectStorage(series('2026-10-01', 19, MB, 0), { today: '2026-10-19' }).status).toBe('flat');
    expect(projectStorage(series('2026-10-01', 19, 2 * MB, -5000), { today: '2026-10-19' }).status).toBe('flat');
  });

  it('projects the days left at the fitted rate, from the current total', () => {
    // 1 MB now growing 10 kB a day: (5 MiB - 1 MiB) / 10 kB ≈ 419 days.
    const s = series('2026-09-20', 30, MB - 29 * 10000, 10000);
    const p = projectStorage(s, { today: '2026-10-19', current: MB });
    expect(p.status).toBe('growing');
    expect(Math.round(p.bytesPerDay)).toBe(10000);
    expect(p.daysLeft).toBe(Math.floor((STORAGE_LIMIT_BYTES - MB) / 10000));
  });

  it('ignores samples older than 90 days', () => {
    const old = series('2026-01-01', 30, 0, 100000); // a steep old trend
    const recent = series('2026-10-01', 19, 3 * MB, 0);
    expect(projectStorage([...old, ...recent], { today: '2026-10-19' }).status).toBe('flat');
  });
});

describe('shouldWarn', () => {
  const growing = (daysLeft) => ({ status: 'growing', daysLeft, bytesPerDay: 1000 });
  it('warns when full within 60 days, or over 80% full', () => {
    expect(shouldWarn(growing(45), { current: MB, today: '2026-10-19' })).toBe(true);
    expect(shouldWarn(growing(400), { current: MB, today: '2026-10-19' })).toBe(false);
    expect(shouldWarn({ status: 'flat' }, { current: 4.5 * MB, today: '2026-10-19' })).toBe(true);
  });

  it('at most once a week', () => {
    expect(shouldWarn(growing(10), { current: MB, today: '2026-10-19', lastWarned: '2026-10-15' })).toBe(false);
    expect(shouldWarn(growing(10), { current: MB, today: '2026-10-22', lastWarned: '2026-10-15' })).toBe(true);
  });
});

describe('describeTimeLeft', () => {
  it('says days under two months, months after', () => {
    expect(describeTimeLeft(0)).toEqual({ unit: 'days', count: 1 });
    expect(describeTimeLeft(45)).toEqual({ unit: 'days', count: 45 });
    expect(describeTimeLeft(400)).toEqual({ unit: 'months', count: 13 });
  });
});

describe('storageTotalBytes', () => {
  it('counts key and value at two bytes a character, like the gauge', () => {
    const entries = [['ab', 'cdef'], ['x', '']];
    const storage = { length: 2, key: (i) => entries[i][0], getItem: (k) => entries.find(e => e[0] === k)[1] };
    expect(storageTotalBytes(storage)).toBe((2 + 4 + 1) * 2);
  });
});
