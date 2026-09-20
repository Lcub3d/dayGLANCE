import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createVision, createWish } from './model.js';
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ({ darkMode: false, isMobile: false }) }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => ({ projects: [], goals: [], addProject: vi.fn(), setGoalsProjectsEnabled: vi.fn() }) }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
vi.mock('../components/goals/GoalDashboard.jsx', () => ({ ProjectForm: () => null, FormOverlay: () => null }));
import VisionEditor from '../components/lifeplanner/VisionEditor.jsx';
const wish = createWish('Do not repeat the inherited wish title', 'creation', 'wish');
function markup(vision = createVision('Write 2 books', '2026-09-20', 'vision')) {
  return renderToStaticMarkup(<VisionEditor wish={wish} original={vision} store={{}} onClose={() => {}} onOpenProject={() => {}} />);
}
describe('vision note has handwriting-like layout without a new font or repeated explanatory UI', () => {
  it('retains an accessible name and an editable first result line instead of a visible header', () => {
    const html = markup();
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-label="lifeplanner.vision"');
    expect(html).toContain('aria-label="lifeplanner.outcome"'); expect(html).toContain('Write 2 books');
    expect(html).not.toContain(wish.title); expect(html).not.toMatch(/<h[123]|<header/);
  });
  it('keeps metadata and explanations off the note while providing a date-settings button', () => {
    const html = markup();
    for (const key of ['measureHelp', 'durationHelp', 'projectHint', 'writingHelp', 'unsaved', 'planned']) expect(html).not.toContain(`lifeplanner.${key}`);
    expect(html).toContain('aria-label="lifeplanner.noteOptions"'); expect(html).not.toContain('type="date"');
    expect(html).toContain('lifeplanner.save'); expect(html).toContain('lifeplanner.cancel');
  });
  it('keeps checkpoint text and duration editable and uses handle-only order controls', () => {
    const vision = createVision('Write 2 books', '2026-09-20', 'vision');
    vision.steps = [{ id: 'a', value: 1, amount: 1, unit: 'year' }, { id: 'b', value: 2, amount: 2, unit: 'year' }];
    const html = markup(vision);
    expect(html.match(/class="lp-stage lp-note-line"/g)).toHaveLength(2);
    expect(html.match(/class="lp-block-handle"/g)).toHaveLength(2);
    expect(html).toContain('lifeplanner.milestoneValue'); expect(html).toContain('lifeplanner.stepDuration');
    expect(html).not.toContain('lucide-arrow-up'); expect(html).not.toContain('lucide-arrow-down');
    expect(html).toContain('aria-label="lifeplanner.project"'); expect(html).not.toContain('>lifeplanner.project<');
  });
});
