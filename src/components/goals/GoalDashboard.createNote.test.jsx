import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import { ProjectForm } from './GoalDashboard.jsx';

// "Create a note in Obsidian" on a NEW project or goal is the plugin's
// creation (the intent needs a stream). With the vault enabled but no
// plugin in use, the box is disabled and says why (owner, 2026-10-04);
// before, it accepted a tick that did nothing.

let i18n;
beforeEach(async () => {
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const planner = {
  tasks: [], unscheduledTasks: [], isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
};
const render = (sync) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={planner}>
      <FeaturesContext.Provider value={{ multiUserEnabled: false, users: [], goals: [], projects: [] }}>
        <SyncContext.Provider value={{ createProjectNote: vi.fn(), openInObsidian: vi.fn(), ...sync }}>
          <ProjectForm initial={null} goals={[]} onSave={vi.fn()} onCancel={vi.fn()} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('the create-a-note box on a new project', () => {
  it('is absent with the vault disabled', () => {
    expect(render({ obsidianConfig: { enabled: false } })).not.toContain('data-create-note');
  });
  it('is disabled and says why on direct access (no stream posture)', () => {
    const html = render({ obsidianConfig: { enabled: true }, bridgeHeartbeatRef: { current: { vaultPosture: 'direct', pluginAuthoritative: false } } });
    expect(html).toContain('data-create-note="needs-plugin"');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(html).toContain('Needs the dayGLANCE bridge plugin paired with this vault.');
    // A ref that carries no posture yet reads the same way.
    expect(render({ obsidianConfig: { enabled: true } })).toContain('data-create-note="needs-plugin"');
  });
  it('is live with a paired vault, Obsidian open or holding', () => {
    for (const vaultPosture of ['plugin', 'holding']) {
      const html = render({ obsidianConfig: { enabled: true }, bridgeHeartbeatRef: { current: { vaultPosture } } });
      expect(html).toContain('data-create-note="available"');
      expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
      expect(html).not.toContain('Needs the dayGLANCE bridge plugin');
    }
  });
});
