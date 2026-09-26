import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DoProgressControl, { DO_PROGRESS_OPTIONS, progressValueForKey } from './DoProgressControl.jsx';

const labels = {
  'jobo.view.progressLabel': 'Progress',
  'jobo.view.progress.started': 'Started',
  'jobo.view.progress.partial': 'Partial',
  'jobo.view.progress.mostly': 'Mostly',
  'common.completed': 'Completed',
};
const t = (key) => labels[key] || key;

describe('DoProgressControl', () => {
  it('renders one current value and keeps the four choices behind the popup', () => {
    const html = renderToStaticMarkup(<DoProgressControl record={{ progress: 'partial' }} t={t} writable onChange={() => {}} />);
    expect(html).toContain('data-jobo-progress-control="true"');
    expect(html).toContain('data-progress-current="partial"');
    expect(html).toContain('aria-label="Progress: Partial"');
    expect(html).toContain('<select');
    expect((html.match(/<option /g) || []).length).toBe(4);
    expect(html).toContain('>Partial</span>');
    expect(html).not.toContain('data-progress-option=');
    expect(DO_PROGRESS_OPTIONS.map((option) => option.value)).toEqual(['started', 'partial', 'mostly', 'completed']);
  });

  it('maps the visible keyboard choices to record progress values', () => {
    expect(progressValueForKey('s')).toBe('started');
    expect(progressValueForKey('P')).toBe('partial');
    expect(progressValueForKey('m')).toBe('mostly');
    expect(progressValueForKey('√')).toBe('completed');
    expect(progressValueForKey('x')).toBeNull();
  });

  it('disables every option when the parent marks the record read-only', () => {
    const html = renderToStaticMarkup(<DoProgressControl record={{ progress: 'started' }} t={t} writable={false} onChange={() => {}} />);
    expect((html.match(/disabled=""/g) || []).length).toBe(1);
  });
});
