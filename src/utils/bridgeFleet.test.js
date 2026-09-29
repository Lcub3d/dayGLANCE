import { describe, it, expect } from 'vitest';
import { rememberBridgeCopies, deriveBridgeFleet, fleetBehindKey, COPY_STATUS_TTL_MS } from './bridgeFleet.js';

const NOW = Date.parse('2026-09-29T03:00:00Z');
const row = (over = {}) => ({
  v: 1, kind: 'copy', deviceId: 'd1', name: 'laptop', platform: 'mac', pluginVersion: '0.9.2',
  generation: 'gen-new', pairedAt: '2026-09-28T01:59:41Z', stale: false, held: 0, ts: new Date(NOW - 60_000).toISOString(), ...over,
});

describe('rememberBridgeCopies (the copy status rows as they pass)', () => {
  it('keeps the latest row per copy and forgets a tombstoned one', () => {
    let m = rememberBridgeCopies({}, [{ deviceId: 'd1', row: row() }, { deviceId: 'd2', row: row({ deviceId: 'd2', name: 'windows' }) }]);
    expect(Object.keys(m).sort()).toEqual(['d1', 'd2']);
    m = rememberBridgeCopies(m, [{ deviceId: 'd1', row: row({ held: 3 }) }, { deviceId: 'd2', row: null }]);
    expect(m.d1.held).toBe(3);
    expect(m.d2).toBeUndefined();
    // Junk never lands.
    expect(rememberBridgeCopies(m, [{ deviceId: 'd3', row: { kind: 'observation' } }, { deviceId: '', row: row() }]).d3).toBeUndefined();
  });
});

describe('deriveBridgeFleet (what every device shows)', () => {
  const meta = { generation: 'gen-new' };
  it("a copy is behind by its own verdict, or by a generation that differs from the vault's", () => {
    const fleet = deriveBridgeFleet({
      d1: row(),
      d2: row({ deviceId: 'd2', name: 'windows', generation: 'gen-old', pairedAt: '2026-08-29T00:00:00Z', stale: true, held: 12 }),
      d3: row({ deviceId: 'd3', name: 'linux', generation: 'gen-old', stale: false }),   // an older build: no verdict, but it names its generation
    }, meta, NOW);
    expect(fleet.current.map((c) => c.name)).toEqual(['laptop']);
    expect(fleet.behind.map((c) => c.name)).toEqual(['linux', 'windows']);
    expect(fleet.behind.find((c) => c.name === 'windows').held).toBe(12);
    expect(fleetBehindKey(fleet)).toBe('d2:12|d3:0');
    expect(fleetBehindKey(deriveBridgeFleet({ d1: row() }, meta, NOW))).toBe(null);
  });
  it('without a meta row only the verdict counts, and a copy not renewed for a week is gone', () => {
    const fleet = deriveBridgeFleet({
      d1: row({ generation: 'gen-old' }),
      d2: row({ deviceId: 'd2', name: 'gone', ts: new Date(NOW - COPY_STATUS_TTL_MS - 1).toISOString() }),
      d3: row({ deviceId: 'd3', name: 'phone', platform: 'ios', stale: true }),
    }, null, NOW);
    expect(fleet.copies.map((c) => c.name)).toEqual(['laptop', 'phone']);
    expect(fleet.behind.map((c) => c.name)).toEqual(['phone']);
  });
  it('names a copy by its name, else its platform, else its id; ignores rows without a usable time', () => {
    const fleet = deriveBridgeFleet({
      a: row({ name: '  ', platform: 'android' }),
      b: row({ name: null, platform: null }),
      c: row({ ts: 'never' }),
    }, null, NOW);
    expect(fleet.copies.map((c) => c.name)).toEqual(['android', 'b']);
  });
});
