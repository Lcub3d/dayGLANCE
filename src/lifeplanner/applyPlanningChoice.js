// Apply the chooser's presets only on an explicit enable, never on load or disable.
export function applyPlanningChoice(name, enabled, features, ctx) {
  const save = name === 'review' ? features.setJoboEnabled : features.setLifeplannerEnabled;
  if (!save(enabled) || !enabled) return;
  features.setRoutinesEnabled(true);
  features.setHabitsEnabled(true);
  if (name === 'review') {
    ctx.setViewHidden('desktop', 'jobo', false);
    ctx.setDefaultView('jobo');
    ctx.setViewMode('jobo');
    ctx.setShowDayDial(false);
  }
}
