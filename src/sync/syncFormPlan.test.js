import { describe, it, expect } from 'vitest';
import { webdavSaveConfig, encryptionSaveConfig, webdavDirty, encryptionDirty } from './syncFormPlan.js';

// Each Sync card saves only its own part of the shared WebDAV config: the
// encryption flag and the WebDAV connection live in one object.

const providers = {
  nextcloud: { configFields: [{ key: 'nextcloudUrl' }, { key: 'username' }, { key: 'appPassword' }] },
  webdav: { configFields: [{ key: 'webdavUrl' }, { key: 'username' }, { key: 'appPassword' }] },
};
const saved = {
  provider: 'nextcloud', nextcloudUrl: 'https://old.example', username: 'me', appPassword: 'pw', webdavUrl: '',
  syncFolder: 'GLANCE/dayglance', enabled: true, encryptionEnabled: true,
};
const editedForm = { ...saved, nextcloudUrl: 'https://new.example' };

describe('WebDAV save', () => {
  it('stores the form connection and keeps the SAVED encryption flag', () => {
    const next = webdavSaveConfig({ saved, form: editedForm, webdavEnabled: true, configured: true });
    expect(next.nextcloudUrl).toBe('https://new.example');
    expect(next.enabled).toBe(true);
    expect(next.encryptionEnabled).toBe(true);
    // The encryption card showing "off" unsaved does not leak in: the flag comes from `saved`.
    expect(webdavSaveConfig({ saved: { ...saved, encryptionEnabled: false }, form: editedForm, webdavEnabled: true, configured: true }).encryptionEnabled).toBe(false);
  });

  it('is enabled only when switched on and complete', () => {
    expect(webdavSaveConfig({ saved, form: editedForm, webdavEnabled: true, configured: false }).enabled).toBe(false);
    expect(webdavSaveConfig({ saved, form: editedForm, webdavEnabled: false, configured: true }).enabled).toBe(false);
  });

  it('switched off keeps the connection details', () => {
    const next = webdavSaveConfig({ saved, form: saved, webdavEnabled: false, configured: true });
    expect(next.nextcloudUrl).toBe('https://old.example');
    expect(next.enabled).toBe(false);
  });
});

describe('encryption save', () => {
  it('changes only the flag, over the SAVED WebDAV config, not the form being edited', () => {
    const next = encryptionSaveConfig({ saved, encryptionEnabled: false, providers, provider: 'nextcloud' });
    expect(next).toEqual({ ...saved, encryptionEnabled: false });
  });

  it('with no WebDAV saved, an empty disabled config carries the flag', () => {
    const next = encryptionSaveConfig({ saved: null, encryptionEnabled: true, providers, provider: 'nextcloud' });
    expect(next.encryptionEnabled).toBe(true);
    expect(next.enabled).toBe(false);
    expect(next.nextcloudUrl).toBe('');
    expect(next.webdavUrl).toBe('');
  });
});

describe('dirty', () => {
  it('WebDAV is dirty on a switch change or a field edit, not otherwise', () => {
    expect(webdavDirty({ saved, form: saved, webdavEnabled: true, providers })).toBe(false);
    expect(webdavDirty({ saved, form: saved, webdavEnabled: false, providers })).toBe(true);
    expect(webdavDirty({ saved, form: editedForm, webdavEnabled: true, providers })).toBe(true);
    expect(webdavDirty({ saved: null, form: { provider: 'nextcloud', syncFolder: 'GLANCE/dayglance' }, webdavEnabled: false, providers })).toBe(false);
  });

  it('encryption is dirty on a switch change, or a passphrase typed while on', () => {
    expect(encryptionDirty({ saved, encryptionEnabled: true, passphrase: '' })).toBe(false);
    expect(encryptionDirty({ saved, encryptionEnabled: false, passphrase: '' })).toBe(true);
    expect(encryptionDirty({ saved, encryptionEnabled: true, passphrase: 'x' })).toBe(true);
    expect(encryptionDirty({ saved: null, encryptionEnabled: false, passphrase: '' })).toBe(false);
  });
});
