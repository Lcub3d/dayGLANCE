import React from 'react';
import { Check } from 'lucide-react';
import { priorityLevel } from '../utils/taskPriority.js';
import './TaskPriorityCheckbox.css';

export { PRIORITY_LEVELS, priorityLevel } from '../utils/taskPriority.js';

export default function TaskPriorityCheckbox({
  priority = 0,
  checked = false,
  darkMode = false,
  ariaLabel = 'Toggle task completion',
  onClick,
  className = '',
  disabled = false,
}) {
  const level = priorityLevel(priority);
  return (
    <button
      type="button"
      role="checkbox"
      disabled={disabled}
      aria-checked={!!checked}
      aria-label={ariaLabel}
      data-priority={level}
      data-theme={darkMode ? 'dark' : 'light'}
      className={`task-priority-checkbox ${className}`.trim()}
      onClick={event => { event.stopPropagation(); onClick?.(event); }}
    >
      {checked && <Check size={10} strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}
