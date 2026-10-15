import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsCard from './SettingsCard.jsx';

// The card pattern (docs/settings-redesign.md): title and switch always, the
// settings only while on, a one-line summary in either state.

const render = (props) => renderToStaticMarkup(
  <SettingsCard cardId="demo" title="Demo" onToggle={vi.fn()} borderClass="" textPrimary="" textSecondary="" {...props}>
    <p data-body>body</p>
  </SettingsCard>,
);

describe('SettingsCard', () => {
  it('shows its settings only while on', () => {
    expect(render({ checked: true })).toContain('data-body');
    expect(render({ checked: false })).not.toContain('data-body');
    expect(render({ checked: false })).toContain('data-settings-card-state="off"');
  });

  it('shows the summary when off, so a paused card says so', () => {
    expect(render({ checked: false, summary: 'Paused' })).toMatch(/data-settings-card-summary="true">Paused/);
  });

  it('without onToggle it is static: no switch, contents always shown', () => {
    const html = renderToStaticMarkup(
      <SettingsCard cardId="s" title="Static" borderClass="" textPrimary="" textSecondary=""><p data-body>body</p></SettingsCard>,
    );
    expect(html).toContain('data-settings-card-state="static"');
    expect(html).toContain('data-body');
    expect(html).not.toContain('role="switch"');
  });

  it('a collapsible card starts closed, showing its title and badge only', () => {
    const html = renderToStaticMarkup(
      <SettingsCard cardId="c" title="Fold" collapsible hint="Hint" badge={<i data-badge />} borderClass="" textPrimary="" textSecondary=""><p data-body>body</p></SettingsCard>,
    );
    expect(html).toContain('data-settings-card-state="closed"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-badge');
    expect(html).not.toContain('data-body');
    expect(html).not.toContain('Hint');
  });

  it('defaultOpen starts it open', () => {
    const html = renderToStaticMarkup(
      <SettingsCard cardId="c" title="Fold" collapsible defaultOpen borderClass="" textPrimary="" textSecondary=""><p data-body>body</p></SettingsCard>,
    );
    expect(html).toContain('data-settings-card-state="open"');
    expect(html).toContain('data-body');
  });

  it('a card with a switch ignores collapsible', () => {
    expect(render({ checked: true, collapsible: true })).toContain('role="switch"');
    expect(render({ checked: true, collapsible: true })).toContain('data-body');
  });

  it('a locked switch is disabled and says its state', () => {
    const html = render({ checked: false, disabled: true });
    expect(html).toMatch(/role="switch" aria-checked="false"/);
    expect(html).toMatch(/disabled=""/);
  });
});

describe('SettingsTopicPage', async () => {
  const { default: SettingsTopicPage } = await import('./SettingsTopicPage.jsx');
  it('puts a rule between blocks, but not between two cards', () => {
    const sections = {
      a: { show: true, card: true, node: 'A' },
      b: { show: true, card: true, node: 'B' },
      c: { show: true, node: 'C' },
    };
    const html = renderToStaticMarkup(<SettingsTopicPage topic={{ id: 't', sections: ['a', 'b', 'c'] }} sections={sections} borderClass="" />);
    expect(html.match(/<hr/g)).toHaveLength(1);
    expect(html.indexOf('<hr')).toBeGreaterThan(html.indexOf('>B<'));
  });
});
