import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Daily Note used to size itself: its text gave the reading view its
// height (up to half the sidebar), and the editor, with nothing to fill,
// dropped to about six lines the moment you clicked in. Now both fill one
// section whose height is the split, remembered on this device.

vi.mock('../../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ({ dailyNotes: { '2026-09-28': { text: '## Quick Notes' } } }) }));
vi.mock('../../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => ({}) }));
vi.mock('../../context/SyncContext.jsx', () => ({ useSyncCtx: () => ({}) }));
const { default: JoboNotesSidebar } = await import('./JoboNotesSidebar.jsx');

const store = new Map();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
});
const render = () => renderToStaticMarkup(<JoboNotesSidebar date="2026-09-28" task={null} t={(k) => k} />);
const section = (html) => html.match(/<section data-jobo-daily-note-section[^>]*>/)[0];

describe('the Daily Note in the notes sidebar', () => {
  // MUTATION: size the section by its content again (drop the height) and
  // the first expectation fails.
  it('takes its height from the split, not from its text', () => {
    expect(section(render())).toContain('height:55%');
    expect(section(render())).not.toContain('max-h-[50%]');
  });

  it('uses the split this device remembered, within its limits', () => {
    store.set('dg-jobo-daily-note-share', '0.7');
    expect(section(render())).toContain('height:70%');
    store.set('dg-jobo-daily-note-share', '0.99');
    expect(section(render())).toContain('height:80%');
    store.set('dg-jobo-daily-note-share', 'nonsense');
    expect(section(render())).toContain('height:55%');
  });

  it('reads in the whole section, and offers a keyboard-reachable split', () => {
    const html = render();
    expect(html).toMatch(/data-jobo-daily-note="true"[^>]*class="flex-1 min-h-0/);
    expect(html).toMatch(/data-jobo-sidebar-split="true"[^>]*role="separator"[^>]*aria-valuenow="55"[^>]*tabindex="0"/);
  });

  // MUTATION: show the reset button at the default and there is nothing for
  // it to do; drop the guard on its pointerdown and pressing it starts a
  // drag of the split beneath it instead.
  it('offers a reset at the split\'s right end only once the split has moved', () => {
    expect(render()).not.toContain('data-jobo-sidebar-split-reset');
    store.set('dg-jobo-daily-note-share', '0.551');
    expect(render()).not.toContain('data-jobo-sidebar-split-reset');
    store.set('dg-jobo-daily-note-share', '0.3');
    const html = render();
    expect(html).toMatch(/<button type="button" data-jobo-sidebar-split-reset="true"[^>]*aria-label="jobo.view.resetNotesSplit"/);
    // Beside the separator, not inside it: a separator's children are presentational.
    expect(html).not.toMatch(/role="separator"[^>]*>(?:(?!<\/div>).)*data-jobo-sidebar-split-reset/s);
  });
});

