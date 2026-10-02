import { describe, it, expect, vi } from 'vitest';
import { NEW_PROJECT_ID, createPendingProject, newProjectFields } from './pendingProject.js';

const goal = { id: 'g1', title: 'Health', color: 'bg-green-500', assignedUserSyncIds: ['u1'] };
const added = () => vi.fn((fields) => ({ ...fields, id: 'p-new', status: 'active' }));

describe('newProjectFields', () => {
  it('takes its colour and users from its goal, as the project form does', () => {
    expect(newProjectFields({ title: ' Run a 10k ', goal })).toEqual({ title: 'Run a 10k', goalId: 'g1', color: 'bg-green-500', assignedUserSyncIds: ['u1'] });
    expect(newProjectFields({ title: 'Solo', goal: null })).toEqual({ title: 'Solo', color: 'bg-blue-500', assignedUserSyncIds: [] });
  });
});

describe('createPendingProject', () => {
  it('leaves a form with no pending project alone, and creates nothing', () => {
    const addProject = added();
    const form = { title: 'x', projectId: 'p1' };
    expect(createPendingProject(form, { addProject })).toEqual({ newTask: form, project: null });
    expect(addProject).not.toHaveBeenCalled();
  });

  // MUTATION: return the form as it is and the placeholder id is saved on
  // the task, which then belongs to a project that does not exist.
  it('creates the named project and puts its id on the task', () => {
    const addProject = added();
    const form = { title: 'Buy shoes', projectId: NEW_PROJECT_ID, newProject: { title: 'Run a 10k', goalId: 'g1' }, color: 'bg-green-500' };
    const { newTask, project } = createPendingProject(form, { addProject, goals: [goal] });
    expect(addProject).toHaveBeenCalledWith({ title: 'Run a 10k', goalId: 'g1', color: 'bg-green-500', assignedUserSyncIds: ['u1'] });
    expect(project.id).toBe('p-new');
    expect(newTask).toEqual({ title: 'Buy shoes', projectId: 'p-new', color: 'bg-green-500' });
  });

  it('never saves the placeholder: with no name, the task has no project and nothing is created', () => {
    const addProject = added();
    const { newTask } = createPendingProject({ title: 'x', projectId: NEW_PROJECT_ID, newProject: { title: '  ' } }, { addProject });
    expect(newTask).toEqual({ title: 'x' });
    expect(addProject).not.toHaveBeenCalled();
  });

  it('a goal that has gone makes a standalone project', () => {
    const addProject = added();
    createPendingProject({ title: 'x', projectId: NEW_PROJECT_ID, newProject: { title: 'P', goalId: 'gone' } }, { addProject, goals: [] });
    expect(addProject.mock.calls[0][0]).not.toHaveProperty('goalId');
  });
});
