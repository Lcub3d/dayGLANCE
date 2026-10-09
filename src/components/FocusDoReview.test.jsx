import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import FocusDoReview from './FocusDoReview.jsx';
import en from '../../public/locales/en/translation.json';
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key, values = {}) => key.split('.').reduce((value, part) => value?.[part], en)
    .replace(/{{(\w+)}}/g, (_, name) => values[name]),
}) }));
const review = {
  capture: { id: 'phase', candidates: [{ actionId: 'a', title: 'Write <draft>' }] },
  summary: { recordedMinutes: 1, unrecordedMilliseconds: 80000, clockChanged: false }, busy: false, error: null,
};
const render = over => renderToStaticMarkup(<FocusDoReview review={{ ...review, ...over }} onSave={vi.fn()} onDismiss={vi.fn()} />);
describe('Focus settlement presentation', () => {
  it('auto attributes one task and explicitly discloses unrecorded seconds', () => {
    const html = render();
    expect(html).toContain('Write &lt;draft&gt;'); expect(html).not.toContain('<select');
    expect(html).toContain('1 full minutes'); expect(html).toContain('80 seconds');
    expect(html).toContain('Task completed'); expect(html).toContain('Still in progress');
  });
  it('multiple tasks use one labelled select with the first candidate selected', () => {
    const html = render({ capture: { ...review.capture, candidates: [...review.capture.candidates, { actionId: 'b', title: 'Read' }] } });
    expect(html).toContain('Which task did you work on?'); expect(html).toContain('<option value="a" selected="">');
    expect(html).toContain('<option value="b">');
  });
  it('a held write is never presented as saved and offers a way to continue', () => {
    const html = render({ error: 'held', choice: { actionId: 'a' } });
    expect(html).toContain('role="alert"'); expect(html).toContain('has not reached storage');
    expect(html).toContain('Continue without waiting');
  });
  it('both decision buttons are disabled during a write', () => {
    expect((render({ busy: true }).match(/<button disabled=""/g) || []).length).toBe(2);
  });
});
