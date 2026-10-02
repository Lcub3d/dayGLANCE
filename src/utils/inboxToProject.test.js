import { describe, it, expect } from 'vitest';
import { assignInboxTasks, inboxCandidates } from './inboxToProject.js';

const inbox = [
  { id: 'a', title: 'Plain', color: 'bg-stone-500', priority: 2, deadline: '2026-10-09' },
  { id: 'b', title: 'In a project', projectId: 'other' },
  { id: 'c', title: 'Done', completed: true },
  { id: 'd', title: 'Someday', bucketId: 'bk' },
  { id: 'e', title: 'Archived', archived: true },
  { id: 'f', title: 'Theirs', assignedUserSyncIds: ['u2'] },
  { id: 'g', title: 'Old order', projectOrder: 30, assignedUserSyncIds: ['u1'] },
];
const project = { id: 'p1', title: 'Garden', color: 'bg-green-500' };

describe('inboxCandidates', () => {
  it('offers open Inbox tasks in no project, outside the Bucket List', () => {
    expect(inboxCandidates(inbox).map((t) => t.id)).toEqual(['a', 'f', 'g']);
  });
  it('only what this user can see', () => {
    expect(inboxCandidates(inbox, (t) => !t.assignedUserSyncIds?.includes('u2')).map((t) => t.id)).toEqual(['a', 'g']);
  });
});

describe('assignInboxTasks', () => {
  // MUTATION: drop the projectId and nothing moves; drop the colour and the
  // task keeps its Inbox colour inside a green project.
  it('puts the chosen tasks in the project with its colour, keeping the rest of each task', () => {
    const next = assignInboxTasks(inbox, ['a'], project);
    expect(next[0]).toEqual({ id: 'a', title: 'Plain', color: 'bg-green-500', priority: 2, deadline: '2026-10-09', projectId: 'p1' });
    expect(next.slice(1)).toEqual(inbox.slice(1));
  });

  it('takes the goal\'s colour when the project has none', () => {
    expect(assignInboxTasks(inbox, ['a'], { id: 'p2' }, { id: 'g', color: 'bg-purple-500' })[0].color).toBe('bg-purple-500');
  });

  // MUTATION: always copy the project's users and a project with none
  // clears the users a task was assigned to.
  it('assigns the project\'s users only when it has some', () => {
    expect(assignInboxTasks(inbox, ['f'], project)[5].assignedUserSyncIds).toEqual(['u2']);
    expect(assignInboxTasks(inbox, ['f'], { ...project, assignedUserSyncIds: ['u1'] })[5].assignedUserSyncIds).toEqual(['u1']);
  });

  it('drops an order left from an earlier project, so the task joins at the end', () => {
    expect(assignInboxTasks(inbox, ['g'], project)[6]).not.toHaveProperty('projectOrder');
  });

  // MUTATION: skip the re-check and a task given another project on another
  // device since the list was drawn is taken from it.
  it('leaves a task that is no longer a candidate as it is', () => {
    const next = assignInboxTasks(inbox, ['b', 'c', 'd', 'e'], project);
    expect(next).toEqual(inbox);
  });
});
