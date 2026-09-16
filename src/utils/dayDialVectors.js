// Test vectors for the Day Dial geometry, as data.
//
// dayDial.js is the authority on where everything on the dial goes, and its
// suite (dayDial.test.js) proves it. A native port of that geometry — the
// Swift home-screen widget first, Kotlin if Android follows — has to agree
// with it on every angle, radius and path, and the only way two
// implementations stay in agreement over time is to run against the same
// numbers. This module produces those numbers: a curated set of inputs, drawn
// from the suite's own cases plus the widget spec's geometry, evaluated
// through the real functions and serialised to
// dayglance-ios/TestFixtures/dayDial.vectors.json.
//
// The file is committed, and dayDialVectors.test.js fails when it drifts from
// what this module now produces, so a geometry change here cannot ship
// without also updating what the ports are checked against. Refresh with
// `npm run ios:vectors`.
//
// Two sections. `geometry` is pure arithmetic and portable: the port
// implements these. `sky` is what the JS side derives and SHIPS in the
// widget snapshot (computeSkySnapshot & the bands it samples); the port
// consumes, never re-solves, this — see docs/day-dial-widget-handoff.md §4 —
// and the vectors are here so what it consumes is pinned too. The sky
// section reads the host clock's zone, which is why the generator and the
// drift test both run under VECTORS_TIMEZONE.

import { getSunTimes } from './solar.js';
import {
  DIAL_DAY_MINUTES,
  DIAL_LANE_GAP,
  assignDialLanes,
  computeDaylightBand,
  computeDialModel,
  computeDialRoutines,
  computeMoonBand,
  computeSkySnapshot,
  dialAngle,
  dialArcPath,
  dialIntensity,
  dialLaneBand,
  dialPoint,
  dialSectorPath,
  dialTicks,
  findDialFocusBlock,
  initialDialSelection,
  moonPhasePath,
  muteDialColor,
  padDialSegment,
  stepDialSelection,
} from './dayDial.js';

export const VECTORS_TIMEZONE = 'America/Denver';
export const VECTORS_PATH = 'dayglance-ios/TestFixtures/dayDial.vectors.json';
export const VECTORS_FORMAT = 'dayDial.vectors/1';

// The web dial's viewBox radii (DayDial.jsx) and the widget spec's
// (docs/day-dial-widget-spec.html) — both sets, so a port targeting either
// canvas finds its own numbers.
const WEB = { cx: 500, cy: 500, rInner: 300, rEdge: 385, rBezel: 424 };
const SPEC = { cx: 182, cy: 189, rBlock: 140, wBlock: 22, rSky: 119, rTickIn: 155, rTickOut: 166 };

const MINUTES = [0, 1, 15, 90, 337, 360, 540, 660, 720, 750, 1080, 1231, 1380, 1439, 1440];

const task = (over = {}) => ({
  id: 1, title: 'Deep work', startTime: '09:00', duration: 60,
  isAllDay: false, completed: false, ...over,
});

// Every numeric token of an SVG path, so a port can compare coordinates
// without writing an SVG parser.
const pathNumbers = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

const geometry = () => ({
  dialAngle: {
    description: 'Minutes past midnight → radians, midnight at the top, clockwise.',
    cases: MINUTES.map((min) => ({ input: { min }, expected: { radians: dialAngle(min) } })),
  },

  dialPoint: {
    description: 'Point at radius r for a minute-of-day; y grows downward (SVG / UIKit).',
    cases: [
      ...MINUTES.map((min) => ({ cx: WEB.cx, cy: WEB.cy, r: WEB.rEdge, min })),
      ...MINUTES.map((min) => ({ cx: SPEC.cx, cy: SPEC.cy, r: SPEC.rBlock, min })),
      { cx: SPEC.cx, cy: SPEC.cy, r: SPEC.rSky, min: 337 },
      { cx: 0, cy: 0, r: 1, min: 360 },
    ].map((input) => ({ input, expected: dialPoint(input.cx, input.cy, input.r, input.min) })),
  },

  dialArcPath: {
    description: 'Stroke-only arc path; largeArc flips past half a revolution. `numbers` is every numeric token of `d` in order.',
    cases: [
      { cx: WEB.cx, cy: WEB.cy, r: WEB.rEdge, startMin: 540, endMin: 660 },
      { cx: WEB.cx, cy: WEB.cy, r: WEB.rEdge, startMin: 0, endMin: 800 },
      { cx: WEB.cx, cy: WEB.cy, r: WEB.rEdge, startMin: 0, endMin: 720 },
      { cx: WEB.cx, cy: WEB.cy, r: WEB.rEdge, startMin: 0, endMin: 721 },
      { cx: SPEC.cx, cy: SPEC.cy, r: SPEC.rBlock, startMin: 600, endMin: 750 },
      { cx: SPEC.cx, cy: SPEC.cy, r: SPEC.rSky, startMin: 1380, endMin: 1440 },
    ].map((input) => {
      const d = dialArcPath(input.cx, input.cy, input.r, input.startMin, input.endMin);
      return { input, expected: { d, numbers: pathNumbers(d) } };
    }),
  },

  dialSectorPath: {
    description: 'Closed annular sector: outer arc clockwise, inner arc back counter-clockwise.',
    cases: [
      { cx: WEB.cx, cy: WEB.cy, rInner: 305, rOuter: WEB.rEdge, startMin: 540, endMin: 660 },
      { cx: WEB.cx, cy: WEB.cy, rInner: WEB.rInner, rOuter: WEB.rEdge, startMin: 0, endMin: 900 },
      { cx: WEB.cx, cy: WEB.cy, rInner: 282, rOuter: 302, startMin: 337, endMin: 341 },
      { cx: SPEC.cx, cy: SPEC.cy, rInner: SPEC.rBlock - SPEC.wBlock / 2, rOuter: SPEC.rBlock + SPEC.wBlock / 2, startMin: 600, endMin: 750 },
    ].map((input) => {
      const d = dialSectorPath(input.cx, input.cy, input.rInner, input.rOuter, input.startMin, input.endMin);
      return { input, expected: { d, numbers: pathNumbers(d) } };
    }),
  },

  dialTicks: {
    description: 'The bezel schedule: a tick every 5 minutes, classified hour / quarter / minor.',
    cases: [{ input: {}, expected: dialTicks() }],
  },

  dialIntensity: {
    description: 'Opacity and edge weight by block duration; saturates at 180 minutes.',
    cases: [5, 12, 15, 30, 45, 60, 90, 120, 150, 180, 240, 600]
      .map((durationMin) => ({ input: { durationMin }, expected: dialIntensity(durationMin) })),
  },

  padDialSegment: {
    description: 'Inter-block breathing room; the pad yields on slivers and a flagged side stays flush.',
    cases: [
      { startMin: 540, endMin: 660 },
      { startMin: 540, endMin: 552 },
      { startMin: 540, endMin: 545 },
      { startMin: 1380, endMin: 1440, gapMin: 3, padStart: true, padEnd: false },
      { startMin: 0, endMin: 420, gapMin: 3, padStart: false, padEnd: true },
      { startMin: 600, endMin: 750, gapMin: 6, padStart: true, padEnd: true },
    ].map((input) => ({
      input,
      expected: padDialSegment(input.startMin, input.endMin, ...(input.gapMin === undefined ? [] : [input.gapMin, input.padStart, input.padEnd])),
    })),
  },

  dialLaneBand: {
    description: `Radial band of one lane inside the ring; DIAL_LANE_GAP is ${DIAL_LANE_GAP}.`,
    cases: [1, 2, 3, 4].flatMap((laneCount) =>
      Array.from({ length: laneCount }, (_, lane) => ({ rInner: WEB.rInner, rOuter: WEB.rEdge, lane, laneCount })))
      .concat([{ rInner: 404, rOuter: 432, lane: 0, laneCount: 2 }, { rInner: 404, rOuter: 432, lane: 1, laneCount: 2 }])
      .map((input) => ({ input, expected: dialLaneBand(input.rInner, input.rOuter, input.lane, input.laneCount) })),
  },

  assignDialLanes: {
    description: 'Concentric lane packing for overlapping blocks (startMin-sorted input).',
    cases: [
      [{ id: 'a', startMin: 540, endMin: 600 }, { id: 'b', startMin: 600, endMin: 660 }],
      [{ id: 'a', startMin: 540, endMin: 660 }, { id: 'b', startMin: 570, endMin: 630 }],
      [{ id: 'a', startMin: 0, endMin: 90 }, { id: 'b', startMin: 30, endMin: 90 }, { id: 'c', startMin: 60, endMin: 120 }, { id: 'd', startMin: 200, endMin: 260 }],
    ].map((blocks) => ({ input: { blocks }, expected: assignDialLanes(blocks) })),
  },

  computeDialModel: {
    description: 'Tasks + day window → ring blocks (with energy kind, lanes, midnight clipping), all-day items, sleep segments and totals.',
    cases: [
      {
        name: 'categorised, sorted, all-day and unscheduled left off the ring',
        dayTasks: [
          task({ id: 2, title: 'Lunch #break', startTime: '12:30', duration: 45 }),
          task({ id: 1, title: 'Team sync', startTime: '14:00', duration: 60 }),
          task({ id: 3, title: 'All-day thing', isAllDay: true }),
          task({ id: 4, title: 'Unscheduled', startTime: null }),
        ],
      },
      {
        name: 'imported calendar events are not completable',
        dayTasks: [task({ id: 1, imported: true }), task({ id: 2, startTime: '11:00', imported: true, isTaskCalendar: true })],
      },
      { name: 'clipped at midnight, true end kept', dayTasks: [task({ startTime: '23:00', duration: 120 })] },
      {
        name: 'last night\'s overrun carried into this morning',
        dayTasks: [task({ id: 1, startTime: '09:00', duration: 60 })],
        prevDayTasks: [
          task({ id: 'y1', title: 'Late session', startTime: '23:00', duration: 150 }),
          task({ id: 'y2', title: 'Dinner', startTime: '19:00', duration: 60 }),
        ],
      },
      {
        name: 'carried block laned against the morning',
        dayTasks: [task({ id: 1, startTime: '00:30', duration: 60 })],
        prevDayTasks: [task({ id: 'y1', startTime: '23:00', duration: 150 })],
      },
      { name: 'sleep from a full window', dayTasks: [task()], dayWindow: { start: '07:00', stop: '22:30' } },
      { name: 'no sleep without a full window', dayTasks: [task()], dayWindow: { start: '07:00', stop: null } },
      {
        name: 'the widget spec\'s dense day',
        dayTasks: [
          [385, 35, 'Morning routine'], [435, 45, 'Email #admin'], [480, 60, 'Standup #work'],
          [540, 60, 'Planning #work'], [600, 150, 'Write API documentation #work'],
          [750, 60, 'Lunch'], [810, 60, 'Review #work'], [870, 45, 'Expenses #admin'],
          [915, 120, 'Deep work #work'], [1035, 45, 'Walk'], [1080, 60, 'Errands'],
          [1140, 45, 'Calls #admin'], [1185, 105, 'Dinner with friends'], [1290, 40, 'Evening routine'],
        ].map(([s, d, title], i) => task({
          id: i + 1, title, startTime: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, duration: d,
        })),
        dayWindow: { start: '06:25', stop: '22:30' },
      },
    ].map(({ name, dayTasks, dayWindow = null, prevDayTasks = null }) => ({
      name,
      input: { dayTasks, dayWindow, prevDayTasks },
      expected: computeDialModel(dayTasks, dayWindow, prevDayTasks),
    })),
  },

  computeDialRoutines: {
    description: 'Routines → bars on the outer track; all-day and zero-length routines are skipped.',
    cases: [
      {
        routines: [
          { id: 'r1', name: 'Stretch', startTime: '07:00', duration: 15 },
          { id: 'r2', name: 'Journal', startTime: '21:00', duration: 30 },
          { id: 'r3', name: 'Vitamins', isAllDay: true },
          { id: 'r4', name: 'Late', startTime: '23:45', duration: 30 },
        ],
        completions: { r1: true },
      },
    ].map((input) => ({ input, expected: computeDialRoutines(input.routines, input.completions) })),
  },

  muteDialColor: {
    description: 'Any task colour → the dial\'s pastel-emissive family; greys collapse to one neutral; junk falls back.',
    cases: ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#8b5cf6', '#4f46e5',
      '#111111', '#ffffff', '#808080', '#6f6f9e', '#4ec9b0', '#5b7fa8', '#5f6b8f', '#a08a5b', '#8a6ba8',
      'not-a-color', null, '#abc']
      .map((hex) => ({ input: { hex }, expected: { hex: muteDialColor(hex) } })),
  },

  moonPhasePath: {
    description: 'Lit portion of a moon disc as a path; `terminatorRx` is the second arc\'s x-radius, the whole shape in one number.',
    cases: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.4, -0.2].flatMap((fraction) =>
      [true, false].flatMap((waxing) => [false, true].map((mirror) => ({ r: 10, fraction, waxing, mirror }))))
      .map((input) => {
        const d = moonPhasePath(input.r, input.fraction, input.waxing, input.mirror);
        const arcs = d.split('A');
        return {
          input,
          expected: {
            d,
            limbSweep: Number(arcs[1].trim().split(/\s+/)[4]),
            terminatorRx: Number(arcs[2].trim().split(/\s+/)[0]),
            terminatorSweep: Number(arcs[2].trim().split(/\s+/)[4]),
          },
        };
      }),
  },

  findDialFocusBlock: {
    description: 'The running block at nowMin, or the next one up, with the phase the hub speaks.',
    cases: (() => {
      const blocks = computeDialModel([
        task({ id: 1, startTime: '09:00', duration: 60 }),
        task({ id: 2, startTime: '11:00', duration: 30 }),
      ]).blocks;
      return [0, 539, 540, 599, 600, 660, 689, 690, 1439].map((nowMin) => ({
        input: { blocks, nowMin }, expected: findDialFocusBlock(blocks, nowMin),
      }));
    })(),
  },

  dialSelection: {
    description: 'Keyboard-walk entry point and stepping; included because a port with a focus ring needs the same order.',
    cases: (() => {
      const blocks = computeDialModel([
        task({ id: 1, startTime: '09:00', duration: 60 }),
        task({ id: 2, startTime: '11:00', duration: 30 }),
        task({ id: 3, startTime: '15:00', duration: 90 }),
      ]).blocks;
      return [
        { input: { op: 'initial', blocks, nowMin: null }, expected: initialDialSelection(blocks, null) },
        { input: { op: 'initial', blocks, nowMin: 660 }, expected: initialDialSelection(blocks, 660) },
        { input: { op: 'initial', blocks, nowMin: 1300 }, expected: initialDialSelection(blocks, 1300) },
        { input: { op: 'step', blocks, currentId: 1, delta: 1 }, expected: stepDialSelection(blocks, 1, 1) },
        { input: { op: 'step', blocks, currentId: 3, delta: 1 }, expected: stepDialSelection(blocks, 3, 1) },
        { input: { op: 'step', blocks, currentId: 1, delta: -1 }, expected: stepDialSelection(blocks, 1, -1) },
      ];
    })(),
  },
});

// Denver is the site the bands were designed against (see dayDial.test.js).
const DENVER = { lat: 39.7392, lon: -104.9903 };
const TROMSO = { lat: 69.65, lon: 18.95 };
// Built INSIDE sky(), never at module scope: a local-time Date fixes its
// instant against whatever zone is current when it is constructed, and the
// module may well be imported before the caller pins TZ (a static import in a
// test file runs before its beforeAll). Constructing them at call time is
// what makes the fixture the same on every machine.
const skyDates = () => [
  ['2026-03-20', new Date(2026, 2, 20, 12)],
  ['2026-06-21', new Date(2026, 5, 21, 12)],
  ['2026-09-10', new Date(2026, 8, 10, 12)],
  ['2026-12-21', new Date(2026, 11, 21, 12)],
];

const sky = () => ({
  ...((SKY_DATES) => ({
  getSunTimes: {
    description: 'Rise/set in local clock minutes; polar days carry a flag and null minutes.',
    cases: [
      ...SKY_DATES.map(([date, d]) => ({ input: { date, site: 'Denver', ...DENVER }, expected: getSunTimes(d, DENVER.lat, DENVER.lon) })),
      { input: { date: '2026-06-21', site: 'Tromsø', ...TROMSO }, expected: getSunTimes(new Date(2026, 5, 21, 12), TROMSO.lat, TROMSO.lon) },
      { input: { date: '2026-12-21', site: 'Tromsø', ...TROMSO }, expected: getSunTimes(new Date(2026, 11, 21, 12), TROMSO.lat, TROMSO.lon) },
    ],
  },
  computeSkySnapshot: {
    description: 'What the widget snapshot ships under `sky`: 24 hourly sun/moon strengths, rise/set, moon phase and glyph minute.',
    cases: [
      ...SKY_DATES.map(([date, d]) => ({ input: { date, site: 'Denver', ...DENVER }, expected: computeSkySnapshot(d, DENVER) })),
      { input: { date: '2026-12-21', site: 'Tromsø', ...TROMSO }, expected: computeSkySnapshot(new Date(2026, 11, 21, 12), TROMSO) },
      { input: { date: '2026-06-21', site: 'nowhere', lat: null, lon: null }, expected: computeSkySnapshot(new Date(2026, 5, 21, 12), null) },
    ],
  },
  computeDaylightBand: {
    description: 'The in-app daylight band at 4-minute steps (no UV scaling); the hourly `sky.hours[].sun` is this, sampled.',
    cases: SKY_DATES.slice(1, 3).map(([date, d]) => ({
      input: { date, site: 'Denver', ...DENVER },
      expected: computeDaylightBand(d, DENVER, getSunTimes(d, DENVER.lat, DENVER.lon)),
    })),
  },
  computeMoonBand: {
    description: 'The in-app moon band, clipped to the hours the sun is down; `sky.hours[].moon` is this, sampled.',
    cases: SKY_DATES.slice(1, 3).map(([date, d]) => ({
      input: { date, site: 'Denver', ...DENVER },
      expected: computeMoonBand(d, DENVER, getSunTimes(d, DENVER.lat, DENVER.lon)),
    })),
  },
  }))(skyDates()),
});

/**
 * Build the whole fixture. Deterministic given the code and the host clock's
 * zone; callers pin process.env.TZ to VECTORS_TIMEZONE first.
 */
export function buildDialVectors() {
  const g = geometry();
  const s = sky();
  const count = (section) => Object.values(section).reduce((n, f) => n + f.cases.length, 0);
  return {
    format: VECTORS_FORMAT,
    source: 'src/utils/dayDial.js',
    generatedBy: 'npm run ios:vectors (scripts/export-dial-vectors.mjs)',
    timezone: VECTORS_TIMEZONE,
    dayMinutes: DIAL_DAY_MINUTES,
    // How close is close enough for a port comparing doubles.
    tolerance: { coordinate: 0.001, radians: 1e-9, opacity: 0.0005, strength: 0.0005 },
    counts: { geometry: count(g), sky: count(s) },
    geometry: g,
    sky: s,
  };
}
