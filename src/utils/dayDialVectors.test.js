import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDialVectors, VECTORS_PATH, VECTORS_TIMEZONE } from './dayDialVectors.js';

// The committed fixture is what the native geometry ports are tested against
// (docs/day-dial-widget-handoff.md §7). It must always be what dayDial.js
// produces NOW, or a geometry change can ship with the ports still passing
// against yesterday's numbers.

const fixtureUrl = new URL(`../../${VECTORS_PATH}`, import.meta.url);

// The sky section depends on the host clock's zone (getSunTimes reports local
// minutes; the elevation math reads the offset). Pin, and put it back so no
// other file in this worker inherits Denver.
let previousTZ;
beforeAll(() => { previousTZ = process.env.TZ; process.env.TZ = VECTORS_TIMEZONE; });
afterAll(() => {
  if (previousTZ === undefined) delete process.env.TZ;
  else process.env.TZ = previousTZ;
});

describe('dayDial vectors fixture', () => {
  it('matches what dayDial.js produces now (refresh with `npm run ios:vectors`)', () => {
    const committed = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
    expect(buildDialVectors()).toEqual(committed);
  });

  it('covers every geometry function the Swift port implements', () => {
    const { geometry } = buildDialVectors();
    for (const fn of [
      'dialAngle', 'dialPoint', 'dialArcPath', 'dialSectorPath', 'dialTicks', 'dialIntensity',
      'padDialSegment', 'dialLaneBand', 'assignDialLanes', 'computeDialModel', 'computeDialRoutines',
      'muteDialColor', 'moonPhasePath', 'findDialFocusBlock',
    ]) {
      expect(geometry[fn]?.cases.length, fn).toBeGreaterThan(0);
    }
  });

  it('pins what the snapshot ships under `sky`, and only from a real location', () => {
    const { sky } = buildDialVectors();
    const denver = sky.computeSkySnapshot.cases.find((c) => c.input.site === 'Denver');
    expect(denver.expected.hours).toHaveLength(24);
    expect(sky.computeSkySnapshot.cases.find((c) => c.input.site === 'nowhere').expected).toBeNull();
  });

  it('pins the wire shape of the snapshot\'s `dial` field', () => {
    const { snapshot } = buildDialVectors();
    const dense = snapshot.projectDialSnapshot.cases[0].expected;
    expect(dense.blocks.length).toBeGreaterThan(15);
    expect(new Set(dense.blocks.map((b) => b.type))).toEqual(new Set(['task', 'event', 'routine', 'sleep']));
    expect(dense.blocks.some((b) => b.completed === true)).toBe(true);
  });

  it('is serialisable without loss: every number survives a JSON round trip', () => {
    const v = buildDialVectors();
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});
