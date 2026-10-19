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
const render = (sync, { initial = null, projects = [] } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={planner}>
      <FeaturesContext.Provider value={{ multiUserEnabled: false, users: [], goals: [], projects }}>
        <SyncContext.Provider value={{ createProjectNote: vi.fn(), openInObsidian: vi.fn(), ...sync }}>
          <ProjectForm initial={initial} goals={[]} onSave={vi.fn()} onCancel={vi.fn()} />
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

// The same creation for an EXISTING project (owner, 2026-10-19): the note row
// of an unlinked project carries "Create in Obsidian", gated like the checkbox.
describe('the Create in Obsidian button on an existing project\'s note row', () => {
  const roof = { id: 'p1', title: 'Roof', status: 'active' };
  const withProject = (sync, project = roof) => render(sync, { initial: project, projects: [project] });

  it('is absent with the vault disabled, and absent when the project is already linked', () => {
    expect(withProject({ obsidianConfig: { enabled: false } })).not.toContain('data-create-note-existing');
    const linked = { ...roof, obsidianNotePath: 'Projects/Roof.md' };
    const html = withProject({ obsidianConfig: { enabled: true }, bridgeHeartbeatRef: { current: { vaultPosture: 'plugin' } } }, linked);
    expect(html).toContain('Projects/Roof');
    expect(html).not.toContain('data-create-note-existing');
  });
  it('is disabled and says why on direct access, or with no posture yet', () => {
    const html = withProject({ obsidianConfig: { enabled: true }, bridgeHeartbeatRef: { current: { vaultPosture: 'direct', pluginAuthoritative: false } } });
    expect(html).toContain('data-create-note-existing="needs-plugin"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-create-note-existing="needs-plugin"/);
    expect(html).toContain('Needs the dayGLANCE bridge plugin paired with this vault');
    expect(withProject({ obsidianConfig: { enabled: true } })).toContain('data-create-note-existing="needs-plugin"');
  });
  it('is live with a paired vault, beside Link, and the hint names it', () => {
    for (const vaultPosture of ['plugin', 'holding']) {
      const html = withProject({ obsidianConfig: { enabled: true }, bridgeHeartbeatRef: { current: { vaultPosture } } });
      expect(html).toContain('data-create-note-existing="available"');
      expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-create-note-existing/);
      expect(html).toContain('>Link</button>');
      expect(html).toContain('Create in Obsidian makes a new note');
    }
  });
  it('is absent without a createProjectNote handler, and on a missing link (Relink and Unlink only)', () => {
    const html = withProject({ obsidianConfig: { enabled: true }, createProjectNote: undefined, bridgeHeartbeatRef: { current: { vaultPosture: 'plugin' } } });
    expect(html).not.toContain('data-create-note-existing');
    const missing = { ...roof, obsidianNotePath: 'Projects/Roof.md', obsidianNoteMissingAt: '2026-10-18T00:00:00Z' };
    const gone = withProject({ obsidianConfig: { enabled: true }, bridgeHeartbeatRef: { current: { vaultPosture: 'plugin' } } }, missing);
    expect(gone).toContain('>Relink</button>');
    expect(gone).not.toContain('data-create-note-existing');
  });
});
