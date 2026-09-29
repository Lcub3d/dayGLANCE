import { describe, it, expect } from 'vitest';
import {
  recordSentIntents, pruneSentIntents, selectDeliveryProbes, deliveryVerdict,
  DELIVERY_WAIT_MS, DELIVERY_CHECK_EVERY_MS, SENT_RETAIN_MS, SENT_CAP, DELIVERY_PROBES_PER_CHECK,
} from './bridgeDelivery.js';

const NOW = Date.parse('2026-09-29T03:00:00Z');
const at = (agoMs) => new Date(NOW - agoMs).toISOString();

describe('the sent-intent memory', () => {
  it('records acknowledged ids, drops the aged and the oldest beyond the cap', () => {
    let sent = recordSentIntents({}, ['a', 'b'], NOW - 1000);
    sent = recordSentIntents(sent, ['c'], NOW);
    expect(Object.keys(sent).sort()).toEqual(['a', 'b', 'c']);
    expect(pruneSentIntents({ old: at(SENT_RETAIN_MS + 1), fresh: at(1) }, NOW)).toEqual({ fresh: at(1) });
    const many = Object.fromEntries(Array.from({ length: SENT_CAP + 5 }, (_, i) => [`i${i}`, at(1000 * (SENT_CAP + 5 - i))]));
    const kept = pruneSentIntents(many, NOW);
    expect(Object.keys(kept)).toHaveLength(SENT_CAP);
    expect(kept.i0).toBeUndefined();            // the oldest went
    expect(kept[`i${SENT_CAP + 4}`]).toBeDefined();
  });
});

describe('selectDeliveryProbes (when to ask, and about which)', () => {
  it('asks only once an id has waited past the threshold, at most every check interval, oldest first, a few at a time', () => {
    expect(selectDeliveryProbes({ a: at(DELIVERY_WAIT_MS - 1) }, NOW, 0)).toEqual({ due: false, ids: [] });
    expect(selectDeliveryProbes({ a: at(DELIVERY_WAIT_MS) }, NOW, NOW - DELIVERY_CHECK_EVERY_MS + 1)).toEqual({ due: false, ids: [] });
    const sent = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`i${i}`, at(DELIVERY_WAIT_MS + 1000 * (9 - i))]));
    const probes = selectDeliveryProbes(sent, NOW, NOW - DELIVERY_CHECK_EVERY_MS);
    expect(probes.due).toBe(true);
    expect(probes.ids).toEqual(['i0', 'i1', 'i2', 'i3', 'i4'].slice(0, DELIVERY_PROBES_PER_CHECK));
  });
});

describe('deliveryVerdict (the safety net)', () => {
  it('alarms only when rows are still present AND a copy is applying', () => {
    expect(deliveryVerdict({ present: ['a'], leaseUntilMs: NOW + 60_000, nowMs: NOW })).toEqual({ waiting: 1, leaseLive: true, alarm: true });
    // No live lease: no Obsidian is open anywhere; the neutral waiting state, never an alarm.
    expect(deliveryVerdict({ present: ['a'], leaseUntilMs: NOW - 1, nowMs: NOW })).toEqual({ waiting: 1, leaseLive: false, alarm: false });
    expect(deliveryVerdict({ present: ['a'], leaseUntilMs: null, nowMs: NOW }).alarm).toBe(false);
    expect(deliveryVerdict({ present: [], leaseUntilMs: NOW + 60_000, nowMs: NOW })).toEqual({ waiting: 0, leaseLive: true, alarm: false });
  });
});
