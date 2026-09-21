import { describe, expect, it, vi } from 'vitest';
import { applyPlanningChoice } from './applyPlanningChoice.js';

function fixture(saved = true) {
  return {
    features: { setJoboEnabled: vi.fn(() => saved), setLifeplannerEnabled: vi.fn(() => saved), setRoutinesEnabled: vi.fn(), setHabitsEnabled: vi.fn() },
    ctx: { setViewHidden: vi.fn(), setDefaultView: vi.fn(), setViewMode: vi.fn(), setShowDayDial: vi.fn() },
  };
}

describe('planning chooser presets', () => {
  it('review enables daily tools and selects an unhidden JOBO default and live view', () => {
    const { features, ctx } = fixture();
    applyPlanningChoice('review', true, features, ctx);
    expect(features.setJoboEnabled).toHaveBeenCalledWith(true);
    expect(features.setLifeplannerEnabled).not.toHaveBeenCalled();
    expect(features.setRoutinesEnabled).toHaveBeenCalledWith(true);
    expect(features.setHabitsEnabled).toHaveBeenCalledWith(true);
    expect(ctx.setViewHidden).toHaveBeenCalledWith('desktop', 'jobo', false);
    expect(ctx.setDefaultView).toHaveBeenCalledWith('jobo');
    expect(ctx.setViewMode).toHaveBeenCalledWith('jobo');
    expect(ctx.setShowDayDial).toHaveBeenCalledWith(false);
  });
  it('life enables its entry and daily tools while preserving the chosen view', () => {
    const { features, ctx } = fixture();
    applyPlanningChoice('life', true, features, ctx);
    expect(features.setLifeplannerEnabled).toHaveBeenCalledWith(true);
    expect(features.setJoboEnabled).not.toHaveBeenCalled();
    expect(features.setRoutinesEnabled).toHaveBeenCalledWith(true);
    expect(features.setHabitsEnabled).toHaveBeenCalledWith(true);
    for (const setter of Object.values(ctx)) expect(setter).not.toHaveBeenCalled();
  });
  it.each(['review', 'life'])('disabling %s preserves independently chosen tools and views', name => {
    const { features, ctx } = fixture();
    applyPlanningChoice(name, false, features, ctx);
    expect(features.setRoutinesEnabled).not.toHaveBeenCalled();
    expect(features.setHabitsEnabled).not.toHaveBeenCalled();
    for (const setter of Object.values(ctx)) expect(setter).not.toHaveBeenCalled();
  });
  it.each(['review', 'life'])('failed %s persistence cannot change dependent settings', name => {
    const { features, ctx } = fixture(false);
    applyPlanningChoice(name, true, features, ctx);
    expect(features.setRoutinesEnabled).not.toHaveBeenCalled();
    expect(features.setHabitsEnabled).not.toHaveBeenCalled();
    for (const setter of Object.values(ctx)) expect(setter).not.toHaveBeenCalled();
  });
});
