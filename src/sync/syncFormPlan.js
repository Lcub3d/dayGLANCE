// What each card on Settings → Sync saves (docs/settings-redesign.md, Sync).
//
// Encryption, WebDAV and GLANCEvault each have their own Save. Two of them share
// one stored object: the end-to-end encryption flag lives inside the WebDAV
// config (`encryptionEnabled`), because WebDAV is the file tier it encrypts. So
// each save writes only its own part, over what is SAVED, never over the other
// card's unsaved edits:
//
//   - WebDAV writes its connection and on/off, and keeps the saved encryption
//     flag, whatever the encryption card is showing;
//   - encryption writes the flag, and keeps the saved WebDAV connection and
//     on/off, whatever the WebDAV card is showing.
//
// GLANCEvault has its own stored config (sync/vaultConfig.js, planVaultSave) and
// touches neither. Pure, so the separation is tested without the form.

/** The WebDAV fields a provider stores, plus the shared sync folder. */
function webdavFieldKeys(providers) {
  const keys = new Set(['syncFolder']);
  for (const provider of Object.values(providers)) {
    for (const field of provider.configFields) keys.add(field.key);
  }
  return [...keys];
}

/**
 * The config the WebDAV card's Save stores: the form's connection, enabled only
 * when switched on AND complete, and the saved encryption flag.
 */
export function webdavSaveConfig({ saved, form, webdavEnabled, configured, normalizeFolder = (f) => f }) {
  return {
    ...form,
    provider: form.provider,
    syncFolder: normalizeFolder(form.syncFolder),
    enabled: !!(webdavEnabled && configured),
    encryptionEnabled: !!saved?.encryptionEnabled,
  };
}

/**
 * The config the encryption card's Save stores: the saved WebDAV config with the
 * new flag. With nothing saved yet, an empty, disabled WebDAV config carries it,
 * as the single Save did for a GLANCEvault-only device.
 */
export function encryptionSaveConfig({ saved, encryptionEnabled, providers, provider }) {
  if (saved) return { ...saved, encryptionEnabled: !!encryptionEnabled };
  const blank = Object.fromEntries(webdavFieldKeys(providers).map((key) => [key, '']));
  return { ...blank, provider, syncFolder: 'GLANCE/dayglance', enabled: false, encryptionEnabled: !!encryptionEnabled };
}

/** Whether the WebDAV card differs from what is saved (its Save and Cancel show). */
export function webdavDirty({ saved, form, webdavEnabled, providers, normalizeFolder = (f) => f }) {
  if (!!webdavEnabled !== !!saved?.enabled) return true;
  if ((form.provider || '') !== (saved?.provider || form.provider || '')) return true;
  if (normalizeFolder(form.syncFolder || '') !== normalizeFolder(saved?.syncFolder ?? 'GLANCE/dayglance')) return true;
  return webdavFieldKeys(providers)
    .filter((key) => key !== 'syncFolder')
    .some((key) => (form[key] || '') !== (saved?.[key] || ''));
}

/** Whether the encryption card has something to save. */
export function encryptionDirty({ saved, encryptionEnabled, passphrase }) {
  return !!encryptionEnabled !== !!saved?.encryptionEnabled || (!!encryptionEnabled && passphrase.length > 0);
}
