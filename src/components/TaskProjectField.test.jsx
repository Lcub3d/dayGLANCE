import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { NEW_PROJECT_ID } from '../utils/pendingProject.js';

vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ({ darkMode: false, borderClass: '', textSecondary: '', hoverBg: '' }) }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => ({
  goals: [{ id: 'g1', title: 'Health', status: 'active' }, { id: 'g2', title: 'Old', status: 'archived' }],
  projects: [{ id: 'p1', title: 'Garden', status: 'active' }],
}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
const { default: TaskProjectField } = await import('./TaskProjectField.jsx');
const render = (newTask) => renderToStaticMarkup(<TaskProjectField newTask={newTask} setNewTask={() => {}} />);

describe('the task modals\' project picker', () => {
  it('offers "New project…" beside the existing projects', () => {
    const html = render({ title: '' });
    expect(html).toContain(`value="${NEW_PROJECT_ID}"`);
    expect(html).toContain('task.newProjectOption');
    expect(html).toContain('Garden');
  });

  it('pending, it is a required name, a goal from the active ones, and a way back', () => {
    const html = render({ title: '', projectId: NEW_PROJECT_ID, newProject: { title: 'Run', goalId: 'g1' } });
    expect(html).toMatch(/<input[^>]*required=""[^>]*value="Run"/);
    expect(html).toContain('Health');
    expect(html).not.toContain('Old');
    expect(html).toContain('data-task-new-project-cancel');
    expect(html).toContain('task.newProjectHint');
  });
});
