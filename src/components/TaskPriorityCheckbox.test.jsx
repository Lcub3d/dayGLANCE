import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskPriorityCheckbox, { priorityLevel } from './TaskPriorityCheckbox.jsx';

describe('TaskPriorityCheckbox', () => {
  it('maps native priority values to the Todoist priority labels', () => {
    expect([3, 2, 1, 0].map(priorityLevel)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(priorityLevel(undefined)).toBe('p4');
    expect(priorityLevel(9)).toBe('p4');
  });

  it('keeps the square checkbox semantics and exposes its priority/theme', () => {
    const html = renderToStaticMarkup(
      <TaskPriorityCheckbox
        priority={3}
        darkMode
        ariaLabel="Complete urgent task"
        onClick={() => {}}
      />,
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="Complete urgent task"');
    expect(html).toContain('data-priority="p1"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('task-priority-checkbox');
    expect(html).not.toContain('rounded-full');
  });

  it('retains completion state while showing the same priority color', () => {
    const html = renderToStaticMarkup(<TaskPriorityCheckbox priority={2} checked darkMode />);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-priority="p2"');
    expect(html).toContain('<svg');
  });
});
