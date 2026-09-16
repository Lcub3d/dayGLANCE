import { describe, it, expect } from 'vitest';
import { resetRoutineCompletionsForToday, rolloverRemovedTodayRoutineIds, sanitizeMergedRoutineCompletions, startOfTodayIso } from './useRoutines.js';
import { mergeRoutineCompletions } from '../mergeSync.js';

const TODAY = '2026-07-03';
const MIDNIGHT = '2026-07-03T00:00:00.000Z'; // local-midnight stand-in for the tests
const YESTERDAY = '2026-07-02';
const YESTERDAY_TS = '2026-07-02T21:00:00.000Z';
const TODAY_MORNING_TS = '2026-07-03T09:00:00.000Z';

describe('resetRoutineCompletionsForToday', () => {
  it("drops a prior-day completion and stamps a midnight tombstone (the added-already-completed bug)", () => {
    const { completions, timestamps } = resetRoutineCompletionsForToday(
      { chip1: YESTERDAY }, { chip1: YESTERDAY_TS }, TODAY, MIDNIGHT,
    );
    // Completion cleared for the new day...
    expect(completions.chip1).toBeUndefined();
    // ...but a tombstone timestamp remains, and it out-dates the stale completion.
    expect(timestamps.chip1).toBe(MIDNIGHT);
    expect(new Date(timestamps.chip1).getTime()).toBeGreaterThan(new Date(YESTERDAY_TS).getTime());
  });

  it("keeps a genuine completion made today, with its real timestamp", () => {
    const { completions, timestamps } = resetRoutineCompletionsForToday(
      { chip1: TODAY }, { chip1: TODAY_MORNING_TS }, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBe(TODAY);
    expect(timestamps.chip1).toBe(TODAY_MORNING_TS);
  });

  it("tombstone does not clobber a completion made earlier today on another device", () => {
    // Local device has only yesterday's data (was closed overnight); it emits a
    // midnight tombstone. A completion made today at 09:00 (on another device)
    // has a later timestamp, so it must still win the LWW merge.
    const { timestamps } = resetRoutineCompletionsForToday(
      { chip1: YESTERDAY }, { chip1: YESTERDAY_TS }, TODAY, MIDNIGHT,
    );
    expect(new Date(TODAY_MORNING_TS).getTime()).toBeGreaterThan(new Date(timestamps.chip1).getTime());
  });

  it("resets a prior-day completion that has no timestamp (legacy data)", () => {
    const { completions, timestamps } = resetRoutineCompletionsForToday(
      { chip1: YESTERDAY }, {}, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBeUndefined();
    expect(timestamps.chip1).toBe(MIDNIGHT);
  });

  it("handles empty maps", () => {
    expect(resetRoutineCompletionsForToday({}, {}, TODAY, MIDNIGHT)).toEqual({ completions: {}, timestamps: {} });
  });
});

describe('startOfTodayIso', () => {
  it('returns local midnight of the given day', () => {
    const iso = startOfTodayIso(new Date('2026-07-03T14:30:00'));
    const d = new Date(iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

describe('sanitizeMergedRoutineCompletions (#1196 symptom 2 — sync-apply)', () => {
  it('drops a stale prior-day completion and raises its timestamp to the midnight tombstone', () => {
    const { completions, timestamps } = sanitizeMergedRoutineCompletions(
      { chip1: YESTERDAY }, { chip1: YESTERDAY_TS }, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBeUndefined(); // never renders as done today
    expect(timestamps.chip1).toBe(MIDNIGHT);   // and the heal wins the next LWW merge
  });

  it("keeps today's completions verbatim", () => {
    const { completions, timestamps } = sanitizeMergedRoutineCompletions(
      { chip1: TODAY }, { chip1: TODAY_MORNING_TS }, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBe(TODAY);
    expect(timestamps.chip1).toBe(TODAY_MORNING_TS);
  });

  it('passes un-complete markers through VERBATIM — never downgrades their recency', () => {
    // An un-complete made today at 09:00 (timestamp present, completion absent)
    // must keep its real timestamp: rewriting it to midnight would let a stale
    // remote complete from 08:00 win the next merge and resurrect the completion.
    const { completions, timestamps } = sanitizeMergedRoutineCompletions(
      {}, { chip1: TODAY_MORNING_TS }, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBeUndefined();
    expect(timestamps.chip1).toBe(TODAY_MORNING_TS);
  });

  it('bumps a stale completion whose timestamp is already past midnight by 1ms — never keeps it verbatim', () => {
    // Inconsistent pair (yesterday-dated completion, today-stamped ts — clock skew,
    // a cross-midnight write, or a peer whose day rolled earlier): the completion
    // is dropped and the tombstone lands one millisecond AFTER the stale stamp.
    // Keeping the stamp verbatim is the losing move: the merge resolves equal
    // timestamps in favour of presence, so the vault's copy re-admits the
    // completion on every pull and the engine re-pushes it every cycle.
    const { completions, timestamps } = sanitizeMergedRoutineCompletions(
      { chip1: YESTERDAY }, { chip1: TODAY_MORNING_TS }, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBeUndefined();
    expect(timestamps.chip1).toBe(new Date(new Date(TODAY_MORNING_TS).getTime() + 1).toISOString());
    expect(timestamps.chip1 > TODAY_MORNING_TS).toBe(true);
  });

  it('bumps a stale completion stamped exactly at midnight past the tombstone', () => {
    const { timestamps } = sanitizeMergedRoutineCompletions(
      { chip1: YESTERDAY }, { chip1: MIDNIGHT }, TODAY, MIDNIGHT,
    );
    expect(timestamps.chip1).toBe('2026-07-03T00:00:00.001Z');
  });

  it('falls back to midnight for an unparseable stale timestamp', () => {
    const { timestamps } = sanitizeMergedRoutineCompletions(
      { chip1: YESTERDAY }, { chip1: 'not-a-date' }, TODAY, MIDNIGHT,
    );
    expect(timestamps.chip1).toBe(MIDNIGHT);
  });

  it('converges the pull → sanitize → push cycle instead of re-pushing the stale completion forever', () => {
    // Regression for the one-write-per-pull loop: the vault holds a prior-day
    // completion whose stamp is at/after local midnight, this device holds the
    // sanitized (absent) copy at the SAME stamp. Each engine cycle merges the
    // vault row into the mirror (mergeRoutineCompletions), pushes the merged
    // mirror, then commits it through the sanitizer. Before the fix the merge
    // re-admitted the completion at the tie every cycle and every push carried
    // it back to the vault. After the fix the first sanitize out-dates the stale
    // stamp, the next merge keeps it dropped, and the pushes stop changing.
    const T = TODAY_MORNING_TS;
    let vaultC = { chip1: YESTERDAY }, vaultTs = { chip1: T };
    let localC = {}, localTs = { chip1: T };
    const pushed = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      const m = mergeRoutineCompletions(localC, vaultC, localTs, vaultTs);
      vaultC = m.merged; vaultTs = m.mergedTimestamps;   // push: the merged mirror
      pushed.push(m.merged);
      const s = sanitizeMergedRoutineCompletions(m.merged, m.mergedTimestamps, TODAY, MIDNIGHT);
      localC = s.completions; localTs = s.timestamps;    // commit: sanitized state
    }
    // Cycle 0 may still carry the stale completion (the tie); from cycle 1 on the
    // vault holds the dropped state and stays there.
    expect(pushed[1]).toEqual({});
    expect(pushed[2]).toEqual({});
    expect(pushed[3]).toEqual({});
    expect(vaultTs.chip1 > T).toBe(true);
    // And the second cycle onward is a no-op merge in BOTH directions — nothing
    // dirty to push, nothing to re-apply.
    const settled = mergeRoutineCompletions(localC, vaultC, localTs, vaultTs);
    expect(settled.localChanged).toBe(false);
    expect(settled.remoteChanged).toBe(false);
  });

  it('tolerates a stale completion with no timestamp at all (legacy data)', () => {
    const { completions, timestamps } = sanitizeMergedRoutineCompletions(
      { chip1: YESTERDAY }, {}, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBeUndefined();
    expect(timestamps.chip1).toBe(MIDNIGHT);
  });

  it('mixed payload: filters per-entry, leaves unrelated timestamps untouched', () => {
    const { completions, timestamps } = sanitizeMergedRoutineCompletions(
      { done: TODAY, stale: YESTERDAY },
      { done: TODAY_MORNING_TS, stale: YESTERDAY_TS, marker: TODAY_MORNING_TS },
      TODAY, MIDNIGHT,
    );
    expect(completions).toEqual({ done: TODAY });
    expect(timestamps).toEqual({ done: TODAY_MORNING_TS, stale: MIDNIGHT, marker: TODAY_MORNING_TS });
  });
});

describe('rolloverRemovedTodayRoutineIds', () => {
  it('keeps every existing receipt and stamps a midnight receipt per cleared chip', () => {
    const existing = { 'mid-day': YESTERDAY_TS, old: '2026-05-01T00:00:00.000Z' };
    const rolled = rolloverRemovedTodayRoutineIds(existing, [{ id: 'a' }, { id: 42 }], MIDNIGHT);
    expect(rolled).toEqual({ ...existing, a: MIDNIGHT, '42': MIDNIGHT });
    // Pure: the input map is untouched.
    expect(existing).toEqual({ 'mid-day': YESTERDAY_TS, old: '2026-05-01T00:00:00.000Z' });
  });

  it('a cleared chip that already had a mid-day receipt is re-stamped at midnight (the rollover is the later event)', () => {
    const rolled = rolloverRemovedTodayRoutineIds({ a: YESTERDAY_TS }, [{ id: 'a' }], MIDNIGHT);
    expect(rolled).toEqual({ a: MIDNIGHT });
  });

  it('with nothing stored and nothing cleared the result is an empty map, never a wipe of a peer-held receipt', () => {
    expect(rolloverRemovedTodayRoutineIds(undefined, undefined, MIDNIGHT)).toEqual({});
    expect(rolloverRemovedTodayRoutineIds({ keep: YESTERDAY_TS }, [], MIDNIGHT)).toEqual({ keep: YESTERDAY_TS });
  });
});
