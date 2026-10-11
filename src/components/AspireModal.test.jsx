import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import AspireModal from './AspireModal.jsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, options) => options?.number ? `${key} ${options.number}` : key }) }));
const T0 = '2026-10-11T12:00:00.000Z';
const row = (id, kind, text, order = 1) => ({ id, kind, text, order, contentUpdatedAt: T0, updatedAt: T0 });
const render = (overrides = {}) => renderToStaticMarkup(
  <DayPlannerContext.Provider value={{ cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100' }}>
    <FeaturesContext.Provider value={{ aspireEntries: [], aspireLoaded: true, aspireWritable: true, commitAspire: vi.fn(), reloadAspire: vi.fn(), ...overrides }}>
      <AspireModal onClose={vi.fn()} />
    </FeaturesContext.Provider>
  </DayPlannerContext.Provider>,
);

describe('Aspire notebook presentation', () => {
  it('has an accessible, single-column dialog with a Compass and no required planning fields', () => {
    const html = render();
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="aspire-title"');
    expect(html).toContain('lucide-compass');
    expect(html).toContain('data-aspire-section="wish"');
    expect(html).toContain('data-aspire-section="motto"');
    expect(html).not.toContain('grid-cols-2');
    expect(html).not.toContain('required=');
    expect(html).not.toContain('comingSoon');
    expect(html).not.toContain('goalId');
  });
  it('shows live entries in stored order, including deliberate blanks and multiline Unicode', () => {
    const html = render({ aspireEntries: [row('b', 'wish', '散步\nLook around', 2), row('a', 'wish', '', 1), { ...row('dead', 'motto', 'gone'), deleted: true }] });
    expect(html.indexOf('data-aspire-entry="a"')).toBeLessThan(html.indexOf('data-aspire-entry="b"'));
    expect(html).toContain('散步\nLook around');
    expect(html).not.toContain('data-aspire-entry="dead"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="aspire.moveUp 1"/);
  });
  it('does not present unreadable storage as an empty editable notebook', () => {
    const html = render({ aspireLoaded: false, aspireEntries: undefined, aspireError: 'readFailed' });
    expect(html).toContain('aspire.loadFailed');
    expect(html).not.toContain('data-aspire-section=');
    expect(html).not.toContain('aspire.saved');
  });
  it('shows read-only incoming data without enabling edits', () => {
    const html = render({ aspireWritable: false, aspireEntries: [row('a', 'wish', 'Still visible')] });
    expect(html).toContain('aspire.readOnly');
    expect(html).toContain('Still visible');
    expect(html).toMatch(/<textarea[^>]*readonly/);
    expect(html).not.toContain('aspire.saved');
  });
});
