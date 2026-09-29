import { describe, it, expect } from 'vitest';
import { createLifeNode, flattenLifeSources, withNotebookOrder, projectNativeNodes, validateLifeValue } from './entities.js';
import { sources } from './entities.fixtures.js';
import { lifeNodesGraph } from '../jobu/lifeNodeStore.js';
import { readLifeSchedule, scheduleOwner, validSchedule, withLifeSchedule } from './schedule.js';
import { buildLifeGantt, civilDay, ganttGeometry, ganttWindow, shiftGanttMonth } from './gantt.js';
const node = (id, extra = {}) => createLifeNode({ id, title: id, type: 'wish', ...extra });
const free = (id, startDate, targetDate, extra = {}) => node(id, { details: { schedule: { startDate, targetDate } }, ...extra });
const rows = (nodes, extra = {}) => buildLifeGantt({ graph: lifeNodesGraph(nodes, extra), nodes,
  goals: projectNativeNodes(nodes, 'goal'), projects: projectNativeNodes(nodes, 'project'), ...extra });

describe('LifeMap schedule owners', () => {
  it('does not turn creation dates into planned dates', () => {
    const n = node('g', { type: 'goal', bindings: { goalId: 'g' }, details: { goal: { id: 'g', createdAt: '2026-01-01' } } });
    expect(readLifeSchedule(n)).toMatchObject({ source: 'goal', startDate: null, targetDate: null });
    expect(ganttGeometry(readLifeSchedule(n), ganttWindow('2026-01-01', 12))).toBeNull();
  });
  it.each([['2026-02-30', null], ['2026-04-10', '2026-04-09'], [0, null], [false, null], [{}, null]])('rejects invalid dates %j / %j', (startDate, targetDate) => {
    expect(validSchedule({ startDate, targetDate })).toBe(false);
    expect(() => withLifeSchedule(node('a'), { startDate, targetDate })).toThrow('scheduleDate');
  });
  it('clears only the owned dates without altering any other facet or identity', () => {
    const n = node('p', { type: 'project', parentIds: ['parent'], position: { x: 100, y: 200 }, bindings: { projectId: 'p' },
      details: { project: { id: 'p', startDate: '2026-01-01', targetDate: '2027-01-01', custom: { keep: true } }, wish: { purpose: 'why' } } });
    const original = structuredClone(n);
    const changed = withLifeSchedule(n, { startDate: '', targetDate: '2028-02-29' });
    expect(changed.details.project).toEqual({ id: 'p', targetDate: '2028-02-29', custom: { keep: true } });
    expect(changed).toMatchObject({ id: 'p', parentIds: ['parent'], position: { x: 100, y: 200 }, bindings: { projectId: 'p' } });
    expect(n).toEqual(original);
    expect(withLifeSchedule(free('a', '2026-01-01', null), { startDate: '', targetDate: '' }).details).toEqual({});
  });
  it('reads legacy invalid native dates without repairing or fabricating them', () => {
    const n = node('g', { bindings: { goalId: 'g' }, details: { goal: { startDate: '2026-06-01', targetDate: '2026-01-01' } } });
    expect(readLifeSchedule(n).invalid).toBe(true);
    expect(ganttGeometry(readLifeSchedule(n), ganttWindow('2026-01-01', 12))).toBeNull();
  });
  it('reuses the cumulative notebook dates and keeps derived stages read-only', () => {
    const input = sources(), nodes = withNotebookOrder(flattenLifeSources(input), input.document);
    const vision = nodes.find(n => n.details.vision), bound = nodes.find(n => n.bindings.goalId === 'g');
    const stage = nodes.find(n => n.bindings.stageId === 'a-second');
    expect(readLifeSchedule(vision, nodes)).toMatchObject({ source: 'vision', editable: false, startDate: '2026-09-20', targetDate: '2029-09-20' });
    expect(readLifeSchedule(bound, nodes)).toMatchObject({ source: 'goal', editable: true, targetDate: '2027-09-20' });
    expect(readLifeSchedule(stage, nodes)).toMatchObject({ source: 'stage', editable: false, startDate: '2027-09-20', targetDate: '2029-09-20' });
    expect(() => withLifeSchedule(stage, { startDate: '2026-01-01' })).toThrow('scheduleDerived');
    expect(readLifeSchedule(stage, [stage]).invalid).toBe(true);
  });
  it('requires an owner pointer to an existing facet, never another set of dates', () => {
    const n = node('a', { bindings: { goalId: 'g' }, details: { goal: {}, project: {}, schedule: { owner: 'goal' } } });
    expect(scheduleOwner({ ...n, type: 'project', bindings: { ...n.bindings, projectId: 'p' } })).toBe('goal');
    expect(() => validateLifeValue('lifeNode', { ...n, details: { schedule: { owner: 'goal' } } })).toThrow('format');
    expect(() => validateLifeValue('lifeNode', { ...n, details: { ...n.details, schedule: { owner: 'goal', startDate: '2026-01-01' } } })).toThrow('format');
  });
});

describe('civil-day Gantt viewport', () => {
  it('uses calendar days independent of DST and timezone', () => {
    expect(civilDay('2026-03-09') - civilDay('2026-03-08')).toBe(1);
    expect(civilDay('2026-11-02') - civilDay('2026-11-01')).toBe(1);
    expect(civilDay('2028-03-01') - civilDay('2028-02-28')).toBe(2);
    expect(shiftGanttMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(ganttWindow('2028-02-29', 1).right - ganttWindow('2028-02-29', 1).left).toBe(29);
  });
  it('represents deadline-only and one-day work as a milestone, not an invented start', () => {
    const range = ganttWindow('2026-09-01', 1);
    expect(ganttGeometry({ targetDate: '2026-09-15' }, range)).toMatchObject({ milestone: true, openEnded: false });
    expect(ganttGeometry({ startDate: '2026-09-15', targetDate: '2026-09-15' }, range).milestone).toBe(true);
    expect(ganttGeometry({}, range)).toBeNull();
  });
  it('clips inclusive endpoints, keeps open-ended work and excludes offscreen bars', () => {
    const range = ganttWindow('2026-09-01', 1);
    expect(ganttGeometry({ startDate: '2026-08-01', targetDate: '2026-10-10' }, range))
      .toMatchObject({ leftPct: 0, widthPct: 100, clippedLeft: true, clippedRight: true });
    expect(ganttGeometry({ startDate: '2026-09-01', targetDate: '2026-09-30' }, range).widthPct).toBe(100);
    expect(ganttGeometry({ startDate: '2026-08-01' }, range)).toMatchObject({ openEnded: true, widthPct: 100 });
    expect(ganttGeometry({ targetDate: '2026-10-01' }, range)).toBeNull();
    expect(ganttGeometry({ startDate: '2026-08-01', targetDate: '2026-08-31' }, range)).toBeNull();
  });
  it('can inspect the last valid date without overflowing the date domain', () => {
    const range = ganttWindow('9999-12-31', 60);
    expect(range.monthTicks).toHaveLength(61);
    expect(ganttGeometry({ targetDate: '9999-12-31' }, range)).not.toBeNull();
    expect(() => ganttWindow('bad-date', 12)).toThrow('scheduleDate');
  });
});

describe('one Gantt projection of the existing graph', () => {
  it('retains undated ideas and summarizes children without writing parent dates', () => {
    const nodes = [node('w'), free('a', '2026-01-01', '2026-03-01', { parentIds: ['w'] }), free('b', null, '2026-05-01', { parentIds: ['a'] }), node('loose')];
    const before = structuredClone(nodes), open = rows(nodes);
    expect(open.map(r => r.id)).toEqual(['w', 'a', 'b', 'loose']);
    expect(open[0].schedule).toMatchObject({ summary: true, startDate: '2026-01-01', targetDate: '2026-05-01' });
    expect(rows(nodes, { collapsed: new Set(['a']) }).map(r => r.id)).toEqual(['w', 'a', 'loose']);
    expect(rows(nodes, { collapsed: new Set(['w']) })[0].schedule).toEqual(open[0].schedule);
    expect(nodes).toEqual(before);
  });
  it('counts multi-parent nodes once and preserves orphan nodes', () => {
    const nodes = [node('a'), node('b'), node('shared', { parentIds: ['a', 'b'] }), node('orphan', { parentIds: ['deleted'] })];
    const result = rows(nodes);
    expect(result).toHaveLength(4);expect(new Set(result.map(r => r.id)).size).toBe(4);
    expect(result.find(r => r.id === 'shared').extraParents).toEqual(['b']);
    expect(result.find(r => r.id === 'orphan').depth).toBe(0);
  });
  it('shows remotely formed cycles once rather than hiding or recursively looping them', () => {
    expect(rows([node('a', { parentIds: ['b'] }), node('b', { parentIds: ['a'] })])).toHaveLength(2);
  });
  it('uses existing native progress and readonly task dates with no template expansion', () => {
    const nodes = [node('g', { type: 'goal', bindings: { goalId: 'g' }, details: { goal: { id: 'g' } } }),
      node('p', { type: 'project', parentIds: ['g'], bindings: { projectId: 'p' }, details: { project: { id: 'p', goalId: 'g' } } })];
    const tasks = [{ id: 't1', title: 'Done', projectId: 'p', date: '2026-09-01', completed: true },
      { id: 't2', title: 'Open', projectId: 'p', date: '2026-09-02', completed: false }];
    const result = rows(nodes, { tasks });
    expect(result.find(r => r.id === 'g').progress).toBe(0.5);
    expect(result.find(r => r.id === 'p').progress).toBe(0.5);
    expect(result.filter(r => r.kind === 'task').every(r => r.schedule.editable === false)).toBe(true);
    expect(result.filter(r => r.kind === 'task').map(r => r.schedule.targetDate)).toEqual(['2026-09-01', '2026-09-02']);
  });
});

it('keeps a parent summary open when a descendant has no end date', () => {
  const nodes = [node('parent'), free('open', '2026-09-01', null, { parentIds: ['parent'] }),
    free('deadline', null, '2026-10-01', { parentIds: ['parent'] })];
  expect(rows(nodes)[0].schedule).toMatchObject({ summary: true, startDate: '2026-09-01', targetDate: null });
});
