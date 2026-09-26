// Explicit local interaction experiment, separate from the slice 2 reassessment
// API: a user-created Do defaults to Completed and may be reassessed to √.
import { createDoRecord, DO_PROGRESS } from './core.js';
import { createManualDo, copyDoRecord, prepareDoEdit } from './viewActions.js';

export function createViewDo({ progress = DO_PROGRESS.COMPLETED, ...options }) {
  const base = createManualDo({ ...options, progress: progress === DO_PROGRESS.COMPLETED ? DO_PROGRESS.STARTED : progress });
  return progress === DO_PROGRESS.COMPLETED ? createDoRecord({ ...base, progress }) : base;
}

export function copyViewDo(options) {
  const copy = copyDoRecord(options);
  return copy && createDoRecord({ ...copy, progress: DO_PROGRESS.COMPLETED });
}

export function prepareViewDoEdit(options) {
  if (options.progress !== DO_PROGRESS.COMPLETED) return prepareDoEdit(options);
  const next = prepareDoEdit({ ...options, progress: undefined });
  if (!next || next.progress === DO_PROGRESS.COMPLETED) return next;
  return createDoRecord({ ...next, progress: DO_PROGRESS.COMPLETED,
    updatedAt: new Date(Math.max(options.now, Date.parse(next.updatedAt) + 1)).toISOString() });
}
