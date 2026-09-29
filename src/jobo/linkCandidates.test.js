import { describe, it, expect } from 'vitest';
import { doLinkCandidates, matchDoLinks, linkFor, projectPath, doTagSuggestions, completeDoTag } from './linkCandidates.js';
import { createManualDo } from './viewActions.js';
import { buildJoboRecords } from './detector.js';
import { buildJoboDayModel } from './viewModel.js';

// Add Do's Title field suggests the day's tasks and the Inbox; picking one
// links the Do to that task and its plan. The point of linking is that the
// Do then groups with the task's other attempts, its completion included,
// instead of reading as unplanned work.

const DAY = '2026-09-27';
const review = { id: 't1', title: 'Review PR adding JOBO [dayGLANCE#1840](https://github.com/x/pull/1840) #work', date: DAY, startTime: '09:00', duration: 45, color: 'bg-purple-500' };
const walk = { id: 't2', title: 'Walk Ari', date: DAY, startTime: '08:30', duration: 30, completed: true };
const event = { id: 'e1', title: 'Review meeting', date: DAY, startTime: '13:00', duration: 60, imported: true };
const taskCal = { id: 'e2', title: 'Review budget', date: DAY, startTime: '15:00', duration: 30, imported: true, isTaskCalendar: true };
const inbox = [{ id: 'i1', title: 'Preview release notes' }, { id: 'i2', title: 'Old review', archived: true }, review];

describe('doLinkCandidates', () => {
  it('offers the day\'s tasks, then the Inbox, once each, without imported events or archived items', () => {
    const list = doLinkCandidates({ dayTasks: [walk, review, event, taskCal], inboxTasks: inbox });
    expect(list.map((c) => [c.task.id, c.where])).toEqual([['t2', 'plan'], ['t1', 'plan'], ['e2', 'plan'], ['i1', 'inbox']]);
  });
});

describe('matchDoLinks', () => {
  const list = doLinkCandidates({ dayTasks: [walk, review, event, taskCal], inboxTasks: inbox });

  it('needs two characters, and matches the title as it reads (no link markup, no tags)', () => {
    expect(matchDoLinks(list, 'r')).toEqual([]);
    expect(matchDoLinks(list, 'dayglance#1840').map((c) => c.task.id)).toEqual(['t1']);
    expect(matchDoLinks(list, 'github')).toEqual([]);
    expect(matchDoLinks(list, '#work')).toEqual([]);
  });

  it('ranks a title-start match, then a word-start match, then anywhere', () => {
    expect(matchDoLinks(list, 'rev').map((c) => c.task.id)).toEqual(['t1', 'e2', 'i1']);
  });

  it('puts open tasks before completed ones', () => {
    const done = { ...review, id: 't9', completed: true };
    const ranked = matchDoLinks(doLinkCandidates({ dayTasks: [done, review] }), 'review');
    expect(ranked.map((c) => c.task.id)).toEqual(['t1', 't9']);
  });
});

describe('a linked Do groups with the task\'s completion', () => {
  // MUTATION: drop the plan from linkFor and the manual Do and the completion
  // land in different groups.
  it('shares the task and the captured plan, so both are one execution', () => {
    const link = linkFor(review);
    expect(link.planSnapshot).toEqual({ date: DAY, startTime: '09:00', duration: 45 });
    const manual = createManualDo({ id: 'manual:1', title: review.title, ...link, date: DAY, startMinute: 9 * 60, duration: 45, progress: 'partial', now: Date.parse('2026-09-27T15:00:00Z') });
    const stamp = `${DAY}T11:45:00-05:00`;
    const [completion] = buildJoboRecords(
      { completions: [{ id: `do:t1:${stamp}`, taskId: 't1', title: review.title, date: DAY, planSnapshot: link.planSnapshot, completedAt: stamp }], uncompletions: [] },
      [manual],
      { observedAt: stamp },
    );
    expect(completion).toBeTruthy();
    const model = buildJoboDayModel({ date: DAY, tasks: [review], records: [manual, completion] });
    const items = [...model.timedRecords, ...model.untimedRecords];
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.groupKey)).size).toBe(1);
  });

  it('an Inbox task links with no plan, and an all-day task too', () => {
    expect(linkFor({ id: 'i1', title: 'x' })).toEqual({ task: { id: 'i1', title: 'x' }, planSnapshot: null });
    expect(linkFor({ ...review, isAllDay: true }).planSnapshot).toBeNull();
  });
});

describe('a project task is named by its goal and project', () => {
  const projects = [{ id: 'p1', title: 'dayGLANCE', goalId: 'g1' }, { id: 'p2', title: 'Garden' }];
  const goals = [{ id: 'g1', title: 'Ship JOBO' }];

  it('gives the project, and the goal when the project has one', () => {
    expect(projectPath({ projectId: 'p1' }, projects, goals)).toEqual({ project: 'dayGLANCE', goal: 'Ship JOBO' });
    expect(projectPath({ projectId: 'p2' }, projects, goals)).toEqual({ project: 'Garden', goal: null });
    expect(projectPath({ projectId: 'gone' }, projects, goals)).toBeNull();
    expect(projectPath({}, projects, goals)).toBeNull();
  });

  it('candidates carry the path only when projects are passed in (Goals and Projects on)', () => {
    const task = { id: 'i9', title: 'Write the JOBO docs', projectId: 'p1' };
    expect(doLinkCandidates({ inboxTasks: [task], projects, goals })[0].path).toEqual({ project: 'dayGLANCE', goal: 'Ship JOBO' });
    expect(doLinkCandidates({ inboxTasks: [task] })[0].path).toBeNull();
  });
});

// An unlinked Do takes #tags the way a new task does (#1726): typing # offers
// the app's existing tags, and a pick completes the tag with a space.
describe('#tags in an unlinked Do\'s title', () => {
  const tags = ['work', 'writing', 'home', 'health/sleep'];

  it('offers the tags that start with what is typed after #', () => {
    expect(doTagSuggestions('Draft the post #wr', 18, tags)).toEqual(['writing']);
    expect(doTagSuggestions('Draft the post #w', 17, tags)).toEqual(['work', 'writing']);
    expect(doTagSuggestions('Sleep log #health/', 18, tags)).toEqual(['health/sleep']);
    expect(doTagSuggestions('#', 1, tags)).toEqual(['health/sleep', 'home', 'work', 'writing']);
  });

  // MUTATION: offer tags whenever a # appears anywhere and the list follows
  // the user through the rest of the title.
  it('offers nothing outside a tag, or before the cursor is known', () => {
    expect(doTagSuggestions('Draft #work the post', 20, tags)).toEqual([]);
    expect(doTagSuggestions('Draft the post', 14, tags)).toEqual([]);
    expect(doTagSuggestions('Draft #wr', null, tags)).toEqual([]);
  });

  it('completes the tag at the cursor with one space, keeping the rest', () => {
    expect(completeDoTag('Draft #wr', 9, 'writing')).toEqual({ title: 'Draft #writing ', cursor: 15 });
    // MUTATION: always add the space and this reads "#writing  post".
    expect(completeDoTag('Draft #wr post', 9, 'writing')).toEqual({ title: 'Draft #writing post', cursor: 15 });
  });
});
