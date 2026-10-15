import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../public/locales/en/translation.json';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';

// The sync proxy (#2082) is a card on the Sync page like the channels above
// it, shown only where the desktop bridge exists. Off on first render: the
// saved state arrives from the main process after mount.
describe('CloudSyncSettingsForm sync proxy card', () => {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  beforeAll(async () => {
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  });
  afterAll(() => {
    globalThis.localStorage = originalStorage;
    globalThis.window = originalWindow;
  });

  const render = () => renderToStaticMarkup(
    <CloudSyncSettingsForm
      darkMode={false} textPrimary="" textSecondary="" borderClass="" hoverBg="" currentProvider="webdav"
      cloudSyncConfig={null} setCloudSyncConfig={() => {}} onClose={() => {}}
    />,
  );

  it('is a card with its own switch on the desktop', () => {
    globalThis.window = { electronAPI: { syncProxy: { get: async () => null, set: async () => ({ ok: true }) } } };
    const html = render();
    expect(html).toContain('data-settings-card="syncProxy"');
    expect(html).toContain(en.sync.form.syncProxyTitle);
    expect(html).toMatch(/data-settings-card="syncProxy" data-settings-card-state="off"/);
    expect(html).not.toContain(en.sync.form.syncProxyScheme);
  });

  it('is absent where there is no desktop bridge', () => {
    globalThis.window = {};
    expect(render()).not.toContain('data-settings-card="syncProxy"');
  });
});
