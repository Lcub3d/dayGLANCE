// GLANCEvault connection config + enablement gate (mirrors lastGLANCE
// src/sync/vaultConfig.ts). Its own localStorage key, completely independent of
// the file-tier (WebDAV) config — the DB transport runs ALONGSIDE WebDAV and is
// opt-in. Clearing this config reverts to file-only instantly.
//
// PAUSED IS NOT FORGOTTEN (docs/settings-redesign.md, #2075). Switching the
// vault off stores `{ enabled: false, ...connection }`, so switching it back on
// resumes with the same server, token and account; Disconnect is the explicit
// forget. Every reader outside the settings form reads getVaultConfig(), which
// returns null for a paused config exactly as it did when off meant null: the
// DB engine, the event stream, intents and the Obsidian bridge cannot tell a
// paused vault from an absent one. Only the form reads getStoredVaultConfig().

// The package's persisted credential-halt key (2.0.0/4a): set when the server
// rejects this device's credential, honoured by every primitive. Imported as
// the exported helper — never a string literal — so the key can't drift.
import { credentialHaltKey } from '@glance-apps/sync/src/dbEngine.js';
import { SECURE_SLOT, secureGet, secureSet, secureStoreAvailable } from '../utils/nativeSecureStore.js';

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
// Must match the wrapper's DEFAULT_STORAGE_KEY_PREFIX (src/sync/dbEngine.js).
const VAULT_STORAGE_KEY_PREFIX = 'dayglance-vault';

// iOS mirror (utils/nativeSecureStore.js): the shell's Keychain holds a copy
// of this config, written on every save and read back once per session when
// web storage has none. WebKit purged the phone's storage after a reboot
// (2026-09-09) and the connection was gone with it; the mirror is what brings
// it back without a hand-entered setup. One read per session: a device that
// never configured a vault must not pay a bridge call on every isVaultEnabled().
let secureRestoreTried = false;

function restoreVaultConfigFromSecureStore() {
  if (secureRestoreTried || !secureStoreAvailable()) return null;
  secureRestoreTried = true;
  const mirrored = secureGet(SECURE_SLOT.vaultConfig);
  if (!mirrored) return null;
  try {
    const cfg = JSON.parse(mirrored);
    if (!cfg || typeof cfg !== 'object') return null;
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify(cfg));
    console.info('[vault] connection restored from the device secure store');
    return cfg;
  } catch {
    return null;
  }
}

/**
 * The stored connection, paused or not. For the settings form only, which
 * shows a paused connection so it can be resumed or disconnected.
 * @returns {{enabled:boolean, vaultUrl:string, vaultToken:string, accountId:string}|null}
 */
export function getStoredVaultConfig() {
  try {
    const saved = localStorage.getItem(VAULT_CONFIG_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    return null;
  }
  return restoreVaultConfigFromSecureStore();
}

/**
 * The active connection: null while the vault is paused or absent, so no
 * reader can act on a paused vault's credentials.
 * @returns {{enabled:true, vaultUrl:string, vaultToken:string, accountId:string}|null}
 */
export function getVaultConfig() {
  const cfg = getStoredVaultConfig();
  return cfg && cfg.enabled ? cfg : null;
}

const sameConnection = (a, b) => !!a && !!b
  && a.vaultUrl === b.vaultUrl && a.vaultToken === b.vaultToken && a.accountId === b.accountId;
const hasConnection = (cfg) => !!(cfg && cfg.vaultUrl && cfg.vaultToken && cfg.accountId);

/**
 * What a Save in the settings form does to the vault config.
 *
 * @param stored  getStoredVaultConfig() when the form opened.
 * @param form    { enabled, vaultUrl, vaultToken, accountId } as entered.
 * @returns {{ next: object|null, changed: boolean, connectionChanged: boolean }}
 *   next               what to store: the entered connection when on; the
 *                      stored connection, paused, when switched off (fields
 *                      edited and then switched off are discarded); null when
 *                      there was never a connection.
 *   changed            anything to save (and so reload for).
 *   connectionChanged  a new or edited connection, the only case that needs
 *                      the passphrase, a fresh key and fresh sync cursors.
 *                      Pausing and resuming the same connection keep both.
 */
export function planVaultSave(stored, form) {
  const entered = {
    vaultUrl: (form.vaultUrl || '').trim(),
    vaultToken: (form.vaultToken || '').trim(),
    accountId: (form.accountId || '').trim(),
  };
  let next;
  if (form.enabled) next = { enabled: true, ...entered };
  else if (hasConnection(stored)) {
    next = { enabled: false, vaultUrl: stored.vaultUrl, vaultToken: stored.vaultToken, accountId: stored.accountId };
  } else next = null;
  const changed = JSON.stringify(next) !== JSON.stringify(stored || null);
  const connectionChanged = !!form.enabled && !sameConnection(stored, entered);
  return { next, changed, connectionChanged };
}

export function _resetVaultConfigSecureRestoreForTests() { secureRestoreTried = false; }

export function setVaultConfig(cfg) {
  // HALT EXIT (2.0.0 adoption, ruling 4 — the minimal version): the package
  // persists its credential halt and only its per-account recovery flow
  // (recoverVaultSyncEngine, which needs the bootstrap secret) clears it —
  // a flow dayGLANCE doesn't run. Without this, a once-halted device would
  // refuse to sync forever even after the user pasted a fresh valid token:
  // strictly worse than pre-2.0.0, where replacing a revoked token
  // self-recovered. So saving CHANGED credentials clears the halt — fresh
  // credentials are a fresh chance, and if they are still bad the first
  // cycle re-halts, which is self-correcting. The complete recovery flow
  // (per-account era) remains future work.
  try {
    const prev = getStoredVaultConfig();
    const credsChanged = !!cfg && (
      !prev || prev.vaultUrl !== cfg.vaultUrl || prev.vaultToken !== cfg.vaultToken || prev.accountId !== cfg.accountId
    );
    if (credsChanged) localStorage.removeItem(credentialHaltKey(VAULT_STORAGE_KEY_PREFIX));
  } catch { /* storage unavailable — the halt read would fail the same way */ }
  if (cfg) localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(VAULT_CONFIG_KEY);
  // Mirror to the iOS secure store (no-op elsewhere); a clear clears the mirror.
  secureSet(SECURE_SLOT.vaultConfig, cfg ? JSON.stringify(cfg) : null);
  secureRestoreTried = true; // web storage is now authoritative for this session
}

// True only when the vault is fully configured AND toggled on. Everything in the
// DB transport is gated on this; when false the DB path is fully inert.
export function isVaultEnabled() {
  const c = getVaultConfig();
  return !!(c && c.enabled && c.vaultUrl && c.vaultToken && c.accountId);
}

export { VAULT_CONFIG_KEY };
