import { beforeAll, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../public/locales/en/translation.json';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';

// Settings → Backup & Restore shows auto-backup as cards (#2075): local and
// remote each with a switch that is the same `enabled` flag the dialog's
// checkbox sets, and the folder as a static card around its own buttons.
describe('AutoBackupSettingsForm cards', () => {
  beforeAll(async () => {
    await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  });

  const config = (local, remote) => ({
    local: { enabled: local, frequency: 'daily' },
    remote: { enabled: remote, frequency: 'daily', provider: 'nextcloud' },
    folder: { enabled: false, snapshotFrequency: 'daily' },
  });
  const render = (cfg, folderBackup = { supported: false }) => renderToStaticMarkup(
    <AutoBackupSettingsForm
      variant="cards" config={cfg} setConfig={vi.fn()}
      status={{ local: {}, remote: {} }} darkMode={false} textPrimary="" textSecondary="" borderClass="" hoverBg=""
      onRemoteBackupNow={vi.fn()} folderBackup={folderBackup} onFolderRestore={vi.fn()}
    />,
  );

  it('one card per destination, its switch showing the saved flag', () => {
    const html = render(config(true, false));
    expect(html).toMatch(/data-settings-card="localBackups" data-settings-card-state="on"/);
    expect(html).toMatch(/data-settings-card="remoteBackups" data-settings-card-state="off"/);
    expect(html).toContain(en.backup.frequency);
    expect(html).not.toContain(en.backup.testConnection);
  });

  it('a remote card that is on shows its connection fields', () => {
    expect(render(config(false, true))).toContain(en.backup.testConnection);
  });

  it('the folder card appears only where folder backup is supported, without a switch', () => {
    expect(render(config(false, false))).not.toContain('data-settings-card="folderBackup"');
    const html = render(config(false, false), { supported: true, folderName: null });
    expect(html).toMatch(/data-settings-card="folderBackup" data-settings-card-state="static"/);
    expect(html).toContain(en.backup.chooseFolder);
  });

  it('without the cards variant it keeps the dialog layout', () => {
    const html = renderToStaticMarkup(
      <AutoBackupSettingsForm
        config={config(true, false)} setConfig={vi.fn()} status={{ local: {}, remote: {} }}
        darkMode={false} textPrimary="" textSecondary="" borderClass="" hoverBg=""
        onRemoteBackupNow={vi.fn()} folderBackup={{ supported: false }} onFolderRestore={vi.fn()}
      />,
    );
    expect(html).not.toContain('data-settings-card');
    expect(html).toContain(en.backup.enableLocalBackups);
  });
});
