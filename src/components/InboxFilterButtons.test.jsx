import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// The Inbox's Filter and priority buttons, shared by the phone, tablet and
// desktop layouts. The priority toggle stays outside the popover (one tap
// cycles it) and names its level; its width must not change as it cycles.
let level = 0;
vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => ({
    darkMode: false, borderClass: 'border-stone-200', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
    inboxPriorityFilter: level, setInboxPriorityFilter: () => {}, playUISound: () => {},
  }),
}));

const { default: InboxFilterButtons } = await import('./InboxFilterButtons.jsx');

let i18n;
beforeEach(async () => {
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
const render = (props = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <InboxFilterButtons filterActive={false} onToggleFilter={() => {}} {...props} />
  </I18nextProvider>,
);
const current = (html) => html.match(/data-priority-label="true"[^>]*>([^<]*)</)[1];

describe('InboxFilterButtons', () => {
  it('labels the filter and marks it only while a filter is on', () => {
    level = 0;
    expect(render()).toContain('<span>Filter</span>');
    expect(render()).not.toContain('rounded-full bg-blue-500');
    expect(render({ filterActive: true })).toContain('rounded-full bg-blue-500');
  });

  it('names the priority level: All, Low+, Medium+, High', () => {
    const seen = [0, 1, 2, 3].map((l) => { level = l; return current(render()); });
    expect(seen).toEqual(['All', 'Low+', 'Medium+', 'High']);
  });

  it('lays every label out in one cell so cycling never changes the width', () => {
    level = 2;
    const html = render();
    for (const label of ['All', 'Low+', 'Medium+', 'High']) expect(html).toContain(`>${label}</span>`);
    expect(html.match(/col-start-1 row-start-1/g)).toHaveLength(4);
    expect(html.match(/ invisible"/g)).toHaveLength(3);
  });
});
