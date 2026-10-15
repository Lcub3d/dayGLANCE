import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getVaultConfig, getStoredVaultConfig, setVaultConfig, isVaultEnabled, planVaultSave, VAULT_CONFIG_KEY,
  _resetVaultConfigSecureRestoreForTests,
} from './vaultConfig.js';
import { credentialHaltKey } from '@glance-apps/sync/src/dbEngine.js';

// Paused is not forgotten (#2075): switching GLANCEvault off keeps its
// connection, and every reader outside the settings form still sees nothing.

const CONN = { vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct' };
const ON = { enabled: true, ...CONN };
const PAUSED = { enabled: false, ...CONN };
const HALT = credentialHaltKey('dayglance-vault');

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, m };
}

let store;
beforeEach(() => { _resetVaultConfigSecureRestoreForTests(); store = fakeStorage(); globalThis.localStorage = store; });
afterEach(() => { delete globalThis.localStorage; });

describe('a paused vault', () => {
  it('keeps its connection in storage, and the form can read it', () => {
    setVaultConfig(PAUSED);
    expect(JSON.parse(store.getItem(VAULT_CONFIG_KEY))).toEqual(PAUSED);
    expect(getStoredVaultConfig()).toEqual(PAUSED);
  });

  it('is invisible to every other reader, exactly as an absent one was', () => {
    setVaultConfig(PAUSED);
    expect(getVaultConfig()).toBeNull();
    expect(isVaultEnabled()).toBe(false);
    setVaultConfig(ON);
    expect(getVaultConfig()).toEqual(ON);
    expect(isVaultEnabled()).toBe(true);
  });

  it('keeps a credential halt across pause and resume of the same connection, and clears it for a new one', () => {
    setVaultConfig(ON);
    store.setItem(HALT, '1');
    setVaultConfig(PAUSED);
    setVaultConfig(ON);
    expect(store.getItem(HALT)).toBe('1');
    setVaultConfig({ ...ON, vaultToken: 'fresh' });
    expect(store.getItem(HALT)).toBeNull();
  });
});

describe('planVaultSave', () => {
  const form = (over = {}) => ({ enabled: true, ...CONN, ...over });

  it('switching off pauses: the stored connection is kept, nothing is re-keyed', () => {
    expect(planVaultSave(ON, form({ enabled: false }))).toEqual({ next: PAUSED, changed: true, connectionChanged: false });
  });

  it('switching off discards fields edited in the same visit', () => {
    expect(planVaultSave(ON, form({ enabled: false, vaultToken: 'typed' })).next).toEqual(PAUSED);
  });

  it('resuming the same connection is a change but not a new connection: no passphrase, same key and cursors', () => {
    expect(planVaultSave(PAUSED, form())).toEqual({ next: ON, changed: true, connectionChanged: false });
  });

  it('a new or edited connection is one, and needs the full set-up', () => {
    expect(planVaultSave(null, form()).connectionChanged).toBe(true);
    expect(planVaultSave(PAUSED, form({ accountId: 'other' })).connectionChanged).toBe(true);
    expect(planVaultSave(ON, form({ vaultUrl: '  https://vault.example  ' }))).toEqual({ next: ON, changed: false, connectionChanged: false });
  });

  it('off with nothing ever connected stores nothing', () => {
    expect(planVaultSave(null, { enabled: false, vaultUrl: 'half typed' })).toEqual({ next: null, changed: false, connectionChanged: false });
    expect(planVaultSave(PAUSED, form({ enabled: false }))).toEqual({ next: PAUSED, changed: false, connectionChanged: false });
  });
});
