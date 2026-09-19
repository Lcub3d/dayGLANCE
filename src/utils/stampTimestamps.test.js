import { describe, it, expect, vi } from 'vitest';
import { stampTimestamps } from './stampTimestamps.js';
import { mergeTaskArrays } from '../mergeSync.js';

const ISO = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

describe('stampTimestamps', () => {
  it('stamps a genuinely new task (no prior, no lastModified)', () => {
    const out = stampTimestamps([{ id: 1, title: 'New' }], [], 'NOW');
    expect(out[0].lastModified).toBe('NOW');
  });

  it('preserves lastModified for an unchanged task', () => {
    const prev = [{ id: 1, title: 'A', completed: false, lastModified: ISO(100) }];
    const curr = [{ id: 1, title: 'A', completed: false, lastModified: ISO(100) }];
    expect(stampTimestamps(curr, prev, 'NOW')[0].lastModified).toBe(prev[0].lastModified);
  });

  it('stamps a genuinely changed task (user edited the title)', () => {
    const prev = [{ id: 1, title: 'A', lastModified: ISO(100) }];
    const curr = [{ id: 1, title: 'A edited', lastModified: ISO(100) }];
    expect(stampTimestamps(curr, prev, 'NOW')[0].lastModified).toBe('NOW');
  });

  it('preserves an incoming lastModified for a task new to storage (no re-stamp)', () => {
    const curr = [{ id: 1, title: 'FromCloud', lastModified: ISO(50) }];
    expect(stampTimestamps(curr, [], 'NOW')[0].lastModified).toBe(curr[0].lastModified);
  });

  // ── Regression: the iCloud zombie-resurrection root cause ──────────────────
  // A stale device holds a still-incomplete task. The stored copy lacks default
  // fields (notes/subtasks) that load/merge default into in-memory state. The
  // ONLY difference is that passive normalization — the user did not touch the
  // task. The stamper must NOT bump lastModified, otherwise the fabricated "now"
  // beats a real completion made on another device and the task resurrects.
  it('does NOT re-stamp when the only diff is passive default normalization', () => {
    const stored = [{ id: 1, title: 'Pay rent', completed: false, lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Pay rent', completed: false, notes: '', subtasks: [], lastModified: ISO(100) }];
    const out = stampTimestamps(inMemory, stored, ISO(0));
    expect(out[0].lastModified).toBe(stored[0].lastModified); // NOT ISO(0)
  });

  // ── Regression: cold-open re-stamp on `archived` (day-planner-unscheduled) ───
  // Same class as the tombstonePrunedBefore false-diff: a never-archived task has
  // no `archived` key in storage, but in-memory it carries `archived: false` (from
  // an unarchive elsewhere or a merge). Absent ≡ false, so the stamper must treat
  // them as equal and NOT fabricate a new lastModified on every cold-open.
  it('does NOT re-stamp when storage lacks `archived` but memory has archived:false', () => {
    const stored = [{ id: 1, title: 'Inbox item', completed: false, lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Inbox item', completed: false, notes: '', subtasks: [], archived: false, lastModified: ISO(100) }];
    const out = stampTimestamps(inMemory, stored, ISO(0));
    expect(out[0].lastModified).toBe(stored[0].lastModified); // stable — no false-diff
  });

  it('does NOT re-stamp the reverse: storage has archived:false, memory omits it', () => {
    const stored = [{ id: 1, title: 'Inbox item', archived: false, lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Inbox item', lastModified: ISO(100) }];
    expect(stampTimestamps(inMemory, stored, ISO(0))[0].lastModified).toBe(stored[0].lastModified);
  });

  it('round-trips: store→load leaves archived:false stable across repeated saves (no drift)', () => {
    // Cold-open cycle: state carries archived:false; storage was written without it
    // (older data). First save must not re-stamp, and the item stays stable on the
    // next cycle too (idempotent — never dirties).
    const t0 = ISO(100);
    let stored = [{ id: 1, title: 'Item', completed: false, lastModified: t0 }];
    const inMemory = [{ id: 1, title: 'Item', completed: false, notes: '', subtasks: [], archived: false, lastModified: t0 }];
    for (let cycle = 0; cycle < 3; cycle++) {
      const out = stampTimestamps(inMemory, stored, ISO(0));
      expect(out[0].lastModified).toBe(t0); // never fabricated
      stored = out; // persist and re-load next cycle
    }
  });

  it('a REAL archive still re-stamps (archived:true vs absent is a genuine change)', () => {
    const stored = [{ id: 1, title: 'Item', lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'Item', archived: true, lastModified: ISO(100) }];
    expect(stampTimestamps(inMemory, stored, 'NOW')[0].lastModified).toBe('NOW');
  });

  // ── Round-trip: an archived:true inbox item stays archived and does NOT
  // false-diff once the store also holds archived:true. This is the day-planner-
  // unscheduled store→load→payload path an archived task takes every cycle: the
  // load normalize adds notes/subtasks defaults, the stamper compares, and the
  // item must round-trip byte-identical (archived kept, lastModified stable) so it
  // never re-pushes on an unchanged cycle. Guards against a regression that would
  // strip archived on this path.
  it('round-trips archived:true store→load→save with NO false-diff across cycles', () => {
    const t0 = ISO(100);
    // Store already carries archived:true (written by a prior save).
    let stored = [{ id: 1, title: 'Archived inbox', completed: true, archived: true, lastModified: t0 }];
    for (let cycle = 0; cycle < 3; cycle++) {
      // loadData adds notes/subtasks defaults into in-memory state (App normalize).
      const inMemory = stored.map(t => ({ ...t, notes: t.notes ?? '', subtasks: t.subtasks ?? [] }));
      const out = stampTimestamps(inMemory, stored, ISO(0));
      expect(out[0].archived).toBe(true);          // archived survives the round-trip
      expect(out[0].lastModified).toBe(t0);         // no fabricated timestamp → no re-push
      stored = out;                                 // persist + reload next cycle
    }
  });

  describe('onRestamp diagnostic', () => {
    it('reports the changed fields when an existing task is re-stamped', () => {
      const prev = [{ id: 1, title: 'A', completed: false, lastModified: ISO(100) }];
      const curr = [{ id: 1, title: 'A', completed: true, lastModified: ISO(100) }];
      const calls = [];
      stampTimestamps(curr, prev, 'NOW', (info) => calls.push(info));
      expect(calls).toEqual([{ id: 1, changedKeys: ['completed'] }]);
    });

    it('does NOT fire for unchanged tasks, default-only diffs, or new tasks', () => {
      const calls = [];
      const onRestamp = (info) => calls.push(info);
      // unchanged
      stampTimestamps([{ id: 1, title: 'A', lastModified: ISO(100) }], [{ id: 1, title: 'A', lastModified: ISO(100) }], 'NOW', onRestamp);
      // default-only diff (the resurrection vector — must stay silent)
      stampTimestamps([{ id: 2, title: 'B', notes: '', subtasks: [], lastModified: ISO(100) }], [{ id: 2, title: 'B', lastModified: ISO(100) }], 'NOW', onRestamp);
      // archived absent-vs-false (the cold-open re-stamp we fixed — must stay silent)
      stampTimestamps([{ id: 4, title: 'D', archived: false, lastModified: ISO(100) }], [{ id: 4, title: 'D', lastModified: ISO(100) }], 'NOW', onRestamp);
      // new task
      stampTimestamps([{ id: 3, title: 'C' }], [], 'NOW', onRestamp);
      expect(calls).toEqual([]);
    });
  });

  it('a completion made elsewhere survives a stale device sync (end-to-end)', () => {
    // Device B (online) completed the task 30 min ago, bumping its lastModified.
    const remoteCompleted = [{ id: 1, title: 'Pay rent', completed: true, completedAt: '2026-06-26', lastModified: ISO(30) }];

    // Stale device A: stored copy is old/incomplete; in-memory copy is the same
    // task with default fields normalized in (no real user edit).
    const storedStale = [{ id: 1, title: 'Pay rent', completed: false, lastModified: ISO(100) }];
    const inMemoryStale = [{ id: 1, title: 'Pay rent', completed: false, notes: '', subtasks: [], lastModified: ISO(100) }];

    // Device A builds its sync payload (stamps), then merges the remote in.
    const stampedLocal = stampTimestamps(inMemoryStale, storedStale, ISO(0));
    const { merged } = mergeTaskArrays(stampedLocal, remoteCompleted, {});

    // The completion must win — the stale incomplete copy must not resurrect it.
    expect(merged).toHaveLength(1);
    expect(merged[0].completed).toBe(true);
  });
});

// ── Regression: the phantom re-stamp (2026-09-06 field finding) ─────────────
// Scheduling a task from the inbox strips its `priority` key; a re-parse of an
// untimed Obsidian line carries `priority: 0`. Absent and 0 are the same state
// ("none"). Read as a change, the presence flip re-stamped a scheduled task on
// every phone scanning a stale vault copy, and the fabricated timestamp beat a
// real completion made on the desktop under DB-tier last-write-wins.
describe('stampTimestamps — priority presence is not an edit', () => {
  it('does NOT re-stamp when the stored copy has no priority key and the merged copy says 0', () => {
    const stored = [{ id: 'obsidian-dg-8w230vhc', title: 'Re-arm SSE nudges on Mac', startTime: '14:00', completed: false, lastModified: ISO(100) }];
    const inMemory = [{ ...stored[0], priority: 0 }];
    const keys = [];
    const out = stampTimestamps(inMemory, stored, ISO(0), (info) => keys.push(info));
    expect(out[0].lastModified).toBe(stored[0].lastModified);
    expect(keys).toEqual([]);
  });

  it('does NOT re-stamp the reverse flip either (stored 0, merged copy without the key)', () => {
    const stored = [{ id: 1, title: 'A', priority: 0, lastModified: ISO(100) }];
    const inMemory = [{ id: 1, title: 'A', lastModified: ISO(100) }];
    expect(stampTimestamps(inMemory, stored, ISO(0))[0].lastModified).toBe(stored[0].lastModified);
  });

  it('still stamps a real priority edit', () => {
    // Frozen clock: the stamp is "now" as the function reads it, and the
    // expected value was "now" as the test read it a moment earlier. On CI
    // those straddled a millisecond boundary (2026-09-08, run 1201) and the
    // two ISO strings differed by 1 ms.
    vi.useFakeTimers({ now: new Date('2026-09-08T04:41:17.556Z') });
    try {
      const stored = [{ id: 1, title: 'A', lastModified: ISO(100) }];
      const inMemory = [{ id: 1, title: 'A', priority: 2, lastModified: ISO(100) }];
      expect(stampTimestamps(inMemory, stored, ISO(0))[0].lastModified).toBe('2026-09-08T04:41:17.556Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('stampTimestamps — gaining an originalPlan is not an edit', () => {
  // originalPlan (see utils/originalPlan.js) is written by the persist pass, not
  // by the user. If its appearance counted as a change it would re-stamp
  // lastModified, and a fabricated stamp outranks a real completion made
  // elsewhere — the resurrection bug this whole module exists to prevent.
  const plan = { date: '2026-09-17', startTime: '09:00', duration: 60 };

  it('does NOT re-stamp when the stored copy predates the field', () => {
    const stored = { id: 1, title: 'Report', date: '2026-09-17', startTime: '09:00', lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, originalPlan: plan }], [stored], 'NOW');
    expect(out[0].lastModified).toBe(stored.lastModified);
  });

  it('does NOT re-stamp the reverse flip either', () => {
    const stored = { id: 1, title: 'Report', originalPlan: plan, lastModified: ISO(60) };
    const { originalPlan: _drop, ...withoutPlan } = stored;
    const out = stampTimestamps([withoutPlan], [stored], 'NOW');
    expect(out[0].lastModified).toBe(stored.lastModified);
  });

  it('still persists the field, it just does not claim the task was edited', () => {
    const stored = { id: 1, title: 'Report', lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, originalPlan: plan }], [stored], 'NOW');
    expect(out[0].originalPlan).toEqual(plan);
  });

  it('a real edit alongside a new originalPlan still stamps', () => {
    const stored = { id: 1, title: 'Report', lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, title: 'Report v2', originalPlan: plan }], [stored], 'NOW');
    expect(out[0].lastModified).toBe('NOW');
  });

  it('a completion elsewhere survives a device that is only adding the field', () => {
    // The end-to-end shape of the resurrection bug, aimed at this field.
    const shared = { id: 1, title: 'Report', date: '2026-09-17', startTime: '09:00', completed: false, lastModified: ISO(120) };
    const completedElsewhere = { ...shared, completed: true, lastModified: ISO(5) };
    const staleDevice = stampTimestamps([{ ...shared, originalPlan: plan }], [shared], ISO(0));
    const { merged } = mergeTaskArrays(staleDevice, [completedElsewhere], {});
    expect(merged).toHaveLength(1);
    expect(merged[0].completed).toBe(true);
  });
});

describe('stampTimestamps — starring IS an edit, but absent and null are not', () => {
  // Unlike archived and originalPlan, a star is a deliberate user action and has
  // to re-stamp so it wins on other devices. Only the absent/null pair is
  // canonicalised, because both mean "not starred".
  const DAY = '2026-09-18';

  it('stamps a real star', () => {
    const stored = { id: 1, title: 'Report', date: DAY, lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, starredDate: DAY }], [stored], 'NOW');
    expect(out[0].lastModified).toBe('NOW');
  });

  it('stamps a real unstar', () => {
    const stored = { id: 1, title: 'Report', date: DAY, starredDate: DAY, lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, starredDate: null }], [stored], 'NOW');
    expect(out[0].lastModified).toBe('NOW');
  });

  it('does NOT re-stamp when storage omits the key and memory says null', () => {
    const stored = { id: 1, title: 'Report', date: DAY, lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, starredDate: null }], [stored], 'NOW');
    expect(out[0].lastModified).toBe(stored.lastModified);
  });

  it('does NOT re-stamp the reverse flip either', () => {
    const stored = { id: 1, title: 'Report', date: DAY, starredDate: null, lastModified: ISO(60) };
    const { starredDate: _drop, ...without } = stored;
    const out = stampTimestamps([without], [stored], 'NOW');
    expect(out[0].lastModified).toBe(stored.lastModified);
  });
});

describe('stampTimestamps — a deferral count changing is not an edit', () => {
  // The increment itself rides a reschedule, which stamps on its own. What this
  // guards is the count moving ALONE, which happens when a merge takes a higher
  // value from another device: nobody edited anything here, and a fabricated
  // stamp would outrank a real completion made elsewhere.
  it('does NOT re-stamp when only the count rose', () => {
    const stored = { id: 1, title: 'Report', date: '2026-09-19', startTime: '09:00', deferrals: 2, lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, deferrals: 5 }], [stored], 'NOW');
    expect(out[0].lastModified).toBe(stored.lastModified);
  });

  it('does NOT re-stamp when the stored copy predates the field', () => {
    const stored = { id: 1, title: 'Report', date: '2026-09-19', startTime: '09:00', lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, deferrals: 1 }], [stored], 'NOW');
    expect(out[0].lastModified).toBe(stored.lastModified);
  });

  it('still persists the count, it just does not claim the task was edited', () => {
    const stored = { id: 1, title: 'Report', lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, deferrals: 3 }], [stored], 'NOW');
    expect(out[0].deferrals).toBe(3);
  });

  it('the reschedule that caused it still stamps, as it always did', () => {
    const stored = { id: 1, title: 'Report', date: '2026-09-19', startTime: '09:00', lastModified: ISO(60) };
    const out = stampTimestamps([{ ...stored, startTime: '16:00', deferrals: 1 }], [stored], 'NOW');
    expect(out[0].lastModified).toBe('NOW');
  });

  it('a completion elsewhere survives a device that is only raising a count', () => {
    const shared = { id: 1, title: 'Report', date: '2026-09-19', startTime: '09:00', completed: false, deferrals: 1, lastModified: ISO(120) };
    const completedElsewhere = { ...shared, completed: true, lastModified: ISO(5) };
    const staleDevice = stampTimestamps([{ ...shared, deferrals: 4 }], [shared], ISO(0));
    const { merged } = mergeTaskArrays(staleDevice, [completedElsewhere], {});
    expect(merged).toHaveLength(1);
    expect(merged[0].completed).toBe(true);
  });
});
