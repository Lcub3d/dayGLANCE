import React from 'react';
import { DO_PROGRESS } from '../../jobo/core.js';
import './TimelineComparison.css';

const OPTIONS = Object.freeze([
  { value: DO_PROGRESS.STARTED, narrow: 'S', fallback: 'Started', key: 's' },
  { value: DO_PROGRESS.PARTIAL, narrow: 'P', fallback: 'Partial', key: 'p' },
  { value: DO_PROGRESS.MOSTLY, narrow: 'M', fallback: 'Mostly', key: 'm' },
  { value: DO_PROGRESS.COMPLETED, narrow: '√', fallback: 'Completed', key: '√' },
]);

const FALLBACK_PROGRESS_LABEL = 'Progress';

function translate(t, key, fallback) {
  if (typeof t !== 'function') return fallback;
  const value = t(key);
  return value === key ? fallback : value;
}

function progressLabel(t, option) {
  return translate(t, option.value === DO_PROGRESS.COMPLETED ? 'common.completed' : `jobo.view.progress.${option.value}`, option.fallback);
}

function valueForKey(key) {
  const normalized = String(key || '').toLowerCase();
  return OPTIONS.find((option) => option.key.toLowerCase() === normalized)?.value
    || (key === '✓' ? DO_PROGRESS.COMPLETED : null);
}

const stopPropagation = (event) => event.stopPropagation();

/**
 * A controlled native select with a compact visual value. The native picker
 * opens outside the card's paint/overflow bounds, while the parent still owns
 * per-attempt reassessment through onChange; it never completes a native task.
 */
export default function DoProgressControl({ record, t, writable = false, onChange }) {
  const progress = record?.progress || DO_PROGRESS.STARTED;
  const current = OPTIONS.find((option) => option.value === progress) || OPTIONS[0];
  const groupLabel = translate(t, 'jobo.view.progressLabel', FALLBACK_PROGRESS_LABEL);
  const currentLabel = progressLabel(t, current);
  const choose = (value, event) => {
    event?.stopPropagation();
    if (value === DO_PROGRESS.COMPLETED && record?.progress !== DO_PROGRESS.COMPLETED) return;
    if (writable && typeof onChange === 'function') onChange(value);
  };
  const handleKeyDown = (event) => {
    // Leave modified shortcuts (including global Ctrl/Cmd+Z/Y) untouched.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.stopPropagation();
    const keyValue = valueForKey(event.key);
    if (!keyValue) return;
    event.preventDefault();
    choose(keyValue, event);
  };

  return <div className="jobo-s5-do-progress" role="group" aria-label={groupLabel} data-jobo-progress-control="true"
    onClick={stopPropagation} onDoubleClick={stopPropagation} onPointerDown={stopPropagation}
    onMouseDown={stopPropagation} onDragStart={stopPropagation} onContextMenu={stopPropagation}>
    <span className="jobo-s5-do-progress-trigger" aria-hidden="true">
      <span className="jobo-s5-do-progress-wide">{currentLabel}</span>
      <span className="jobo-s5-do-progress-narrow">{current.narrow}</span>
    </span>
    <select className="jobo-s5-do-progress-select" aria-label={`${groupLabel}: ${currentLabel}`} value={current.value}
      disabled={!writable} data-progress-current={current.value} onChange={(event) => choose(event.target.value, event)}
      onKeyDown={handleKeyDown} onPointerDown={stopPropagation} onMouseDown={stopPropagation}
      onClick={stopPropagation} onDoubleClick={stopPropagation} onDragStart={stopPropagation} onContextMenu={stopPropagation}>
      {OPTIONS.filter(option => option.value !== DO_PROGRESS.COMPLETED || record?.progress === DO_PROGRESS.COMPLETED).map((option) => <option key={option.value} value={option.value}>{progressLabel(t, option)}</option>)}
    </select>
  </div>;
}

export { OPTIONS as DO_PROGRESS_OPTIONS, valueForKey as progressValueForKey };
