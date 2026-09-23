import { describe, it, expect } from 'vitest';
import * as core from './core.js';

describe('JOBO core public facade', () => {
  it('preserves the Slice 2 export surface', () => {
    expect(Object.keys(core).sort()).toEqual([
      'ALLEN_RELATION',
      'DO_PROGRESS',
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
      'reassessDoProgress',
      'summarizeTiming',
      'tombstoneDoRecord',
      'updateDoRecord',
      'validateDoRecord',
    ].sort());
  });
});
