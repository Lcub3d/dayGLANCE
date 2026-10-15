import { describe, it, expect } from 'vitest';
import { restoreFrames } from './undoFrames.js';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const frame = (over = {}) => ({ id: 'f1', name: 'Deep work', start: '09:00', end: '11:00', lastModified: '2026-10-14T11:00:00.000Z', ...over });

describe('restoreFrames', () => {
  it('brings back the content the step changed, stamped as a fresh edit', () => {
    const before = frame();
    const after = frame({ exceptions: { '2026-10-14': { deleted: true } }, lastModified: '2026-10-14T11:30:00.000Z' });
    const [restored] = restoreFrames([after], [before], NOW);
    expect(restored.exceptions).toBeUndefined();
    expect(restored.start).toBe('09:00');
    // Newer than the version it replaces, so last-writer-wins keeps the undo.
    expect(Date.parse(restored.lastModified)).toBeGreaterThan(Date.parse(after.lastModified));
    expect(restored.lastModified).toBe(new Date(NOW).toISOString());
  });

  it('stamps past the current version even when the clock is behind it', () => {
    const after = frame({ start: '10:00', lastModified: '2026-10-14T13:00:00.000Z' });
    const [restored] = restoreFrames([after], [frame()], NOW);
    expect(restored.start).toBe('09:00');
    expect(restored.lastModified).toBe('2026-10-14T13:00:00.001Z');
  });

  it('leaves frames the step did not change alone, stamp included', () => {
    const untouched = frame({ id: 'f2' });
    const current = [frame({ start: '10:00' }), untouched];
    const next = restoreFrames(current, [frame(), { ...untouched }], NOW);
    expect(next[1]).toBe(untouched);
  });

  it('ignores a difference in the stamp alone', () => {
    const current = [frame({ lastModified: '2026-10-14T11:59:00.000Z' })];
    expect(restoreFrames(current, [frame()], NOW)).toBe(current);
  });

  it('keeps a frame added since and does not resurrect one deleted since', () => {
    const added = frame({ id: 'new' });
    const next = restoreFrames([added], [frame({ id: 'gone' })], NOW);
    expect(next).toEqual([added]);
  });
});
