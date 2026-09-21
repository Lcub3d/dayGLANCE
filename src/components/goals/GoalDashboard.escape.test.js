import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Exercise the real capture handler without mounting the entire dashboard.
// The browser regression also opens a vision note over the cached mobile tab.
const source = fs.readFileSync(new URL('./GoalDashboard.jsx', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('// Escape key — use capture phase'));
const handler = section.match(/const handler = (\(e\) => \{[\s\S]*?\n    \});/)[1];
const setterNames = ['setExpandedNotesTaskId', 'setShowAddTask', 'setShowNewTaskDeadlinePicker',
  'setPlannerProjectId', 'setGoalForm', 'setProjectForm', 'setAreaForm', 'setShowManageAreas', 'setShowGoalsDashboard'];

function fixture({ portal = null, state = {} } = {}) {
  const setters = Object.fromEntries(setterNames.map(name => [name, vi.fn()]));
  const document = { querySelector: vi.fn(selector => portal && selector.split(/,\s*/).includes(portal) ? {} : null) };
  const scope = { document, expandedNotesTaskId: null, showAddTask: false, plannerProjectId: null,
    goalForm: null, projectForm: null, areaForm: null, showManageAreas: false, embedded: false, ...state, ...setters };
  const run = new Function(...Object.keys(scope), `return ${handler};`)(...Object.values(scope));
  const event = { key: 'Escape', target: { closest: vi.fn(() => null) },
    preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  return { run, event, setters, document };
}

describe('GoalDashboard yields Escape to active planning portals', () => {
  it.each(['[data-lifeplanner]', '[data-life-vision]', '[data-life-swot]', '[data-planning-choices]'])(
    'leaves %s in charge even when focus is outside the notebook subtree', portal => {
      const { run, event, setters } = fixture({ portal, state: { embedded: true, projectForm: {} } });
      run(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
      for (const setter of Object.values(setters)) expect(setter).not.toHaveBeenCalled();
    });
  it.each([['goalForm', 'setGoalForm'], ['projectForm', 'setProjectForm']])(
    'still closes its own %s when no planning overlay exists', (form, setter) => {
      const { run, event, setters } = fixture({ state: { [form]: {} } });
      run(event);
      expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
      expect(setters[setter]).toHaveBeenCalledWith(null);
      expect(setters.setShowGoalsDashboard).not.toHaveBeenCalled();
    });
  it('still closes the ordinary non-embedded dashboard', () => {
    const { run, event, setters } = fixture();
    run(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(setters.setShowGoalsDashboard).toHaveBeenCalledWith(false);
  });
  it('does not consume other keys', () => {
    const { run, event, document, setters } = fixture();
    event.key = 'Enter'; run(event);
    expect(document.querySelector).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    for (const setter of Object.values(setters)) expect(setter).not.toHaveBeenCalled();
  });
});
