import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as core from './core.js';

describe('JOBO core public facade', () => {
  it('preserves the Slice 2 export surface', () => {
    const expected = [
      'ALLEN_RELATION',
      'COMPLETION_STATUS',
      'COMPLETION_STATUS_ORDER',
      'DO_SOURCES',
      'DO_TIMING',
      'DURATION_COMPARISON',
      'EXECUTION_PATTERN',
      'PLAN_CONTEXT',
      'RELATIVE_TIMING',
      'TIMING',
      'TIMING_SUMMARY',
      'classifyAgainstPlan',
      'compareExecutionToPlan',
      'comparePlanAnchors',
      'completeDoAttempt',
      'createDoRecord',
      'doDurationMinutes',
      'migrateLegacyDoRecord',
      'pickJoboRecord',
      'setPlanCompletionStatus',
      'summarizeTiming',
      'tombstoneDoRecord',
      'updateDoRecord',
      'validateDoRecord',
    ].sort();
    assert.deepEqual(Object.keys(core).sort(), expected);
  });
});
