import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../public/locales/en/translation.json';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';

// The WebDAV server URL field warns about http://: amber on a LAN address, red
// for a public host (the password travels in plain text with every request).
describe('CloudSyncSettingsForm WebDAV URL warning', () => {
  const original = globalThis.localStorage;
  beforeAll(async () => {
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  });
  afterAll(() => { globalThis.localStorage = original; });

  const render = (webdavUrl) => renderToStaticMarkup(
    <CloudSyncSettingsForm
      darkMode={false} textPrimary="" textSecondary="" borderClass="" hoverBg="" currentProvider="webdav"
      cloudSyncConfig={{ enabled: true, provider: 'webdav', webdavUrl, username: 'u', appPassword: 'p' }}
      setCloudSyncConfig={() => {}} onClose={() => {}}
    />,
  );
  const { insecureLanWarning, insecurePublicWarning } = en.sync.webdavUrl;

  it('warns for http:// on a LAN address', () => {
    const html = render('http://10.10.10.2');
    expect(html).toContain(insecureLanWarning);
    expect(html).not.toContain(insecurePublicWarning);
  });

  it('flags http:// to a public host', () => {
    expect(render('http://dav.example.com')).toContain(insecurePublicWarning);
  });

  it('says nothing for https://', () => {
    const html = render('https://dav.example.com');
    expect(html).not.toContain(insecureLanWarning);
    expect(html).not.toContain(insecurePublicWarning);
  });
});

// Each Sync card saves on its own (sync/syncFormPlan.js): a form that matches
// what is saved shows no Save or Cancel at all.
describe('CloudSyncSettingsForm per-card saves', () => {
  const original = globalThis.localStorage;
  beforeAll(() => { globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; });
  afterAll(() => { globalThis.localStorage = original; });

  it('shows no card actions while nothing differs from what is saved', () => {
    const html = renderToStaticMarkup(
      <CloudSyncSettingsForm
        darkMode={false} textPrimary="" textSecondary="" borderClass="" hoverBg="" currentProvider="nextcloud"
        cloudSyncConfig={{ enabled: true, provider: 'nextcloud', nextcloudUrl: 'https://dav.example.com', username: 'u', appPassword: 'p', syncFolder: 'GLANCE/dayglance', encryptionEnabled: false }}
        setCloudSyncConfig={() => {}}
      />,
    );
    expect(html).not.toContain('data-sync-card-actions');
    expect(html).not.toContain('data-sync-form-actions');
  });
});
