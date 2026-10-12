import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDbRootKey, clearDbRootKey, initDbRootKey } from '@glance-apps/sync';
import { getDbRootKey, encryptEntity, KEYCHECK_ENTITY_ID, KEYCHECK_PAYLOAD } from '@glance-apps/sync/src/dbCrypto.js';
import { deriveBridgeSubkey, openBridgeEnvelope, encodePlainBridgeRow } from '@glance-apps/obsidian-format';
import { verifiedBridgeRootKey, resetBridgeKeyGate, KEY_RECHECK_MS } from './bridgeKeyGate.js';
import { emitBridgeIntent, flushBridgeOutbox, __resetBridgeStreamForTests } from './obsidianBridgeStream.js';
import { fetchBridgeObservations, lastBridgeInboundFailure } from './obsidianBridgeInbound.js';
import { startBridgePairing } from './obsidianBridgePairing.js';

// THE EMPTY-KEY INTENTS (2026-10-10): an Android phone read the Direct
// Access key record as its GLANCEvault root key and imported an EMPTY key.
// Main sync's verifier refused to push under it; the bridge, which only
// asked whether a key was in memory, sealed eight Obsidian changes under a
// subkey no plugin copy holds. These tests hold the bridge to the same proof
// the engine requires, through the real flush, fetch and pairing paths.

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
const OUTBOX_KEY = 'dayglance-bridge-outbox';
const ACCOUNT_SALT = new Uint8Array(16).fill(9);
const PAIRING_SALT = new Uint8Array(16).fill(5);
const PAIRING_SALT_B64 = btoa(String.fromCharCode(...PAIRING_SALT));
const META = { v: 1, kind: 'pairing-meta', generation: PAIRING_SALT_B64, pairingSalt: PAIRING_SALT_B64, pairedAt: '2026-08-29T00:00:00Z' };

const noNative = { nativeGetSyncKey: null, nativeStoreSyncKey: null, cryptoDBName: 'bridge-key-gate-test' };
const installKey = (passphrase) => setupDbRootKey(passphrase, ACCOUNT_SALT, {
  nativeGetSyncKey: () => null, nativeStoreSyncKey: () => {},
});
// The incident's key: a record of the file tier's shape, {rawKey, salt},
// read as a root key record. rootBytes is undefined, so the key is empty.
const installEmptyKeyAsInTheIncident = () => initDbRootKey({
  nativeGetSyncKey: () => btoa(JSON.stringify({ rawKey: [1, 2, 3], salt: Array.from(ACCOUNT_SALT) })),
});

// The account's verifier, sealed under the passphrase every device shares.
let VERIFIER_ENVELOPE;

// A GLANCEvault fake: serves the verifier and the pairing meta, records batches.
const makeServer = ({ verifier = true, failVerifier = false } = {}) => {
  const batches = [];
  const keycheckGets = [];
  const impl = async (url, init = {}) => {
    if (url.includes(`/sync/dayglance/${KEYCHECK_ENTITY_ID}`)) {
      keycheckGets.push(url);
      if (failVerifier) throw new TypeError('Failed to fetch');
      if (!verifier) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ entityId: KEYCHECK_ENTITY_ID, envelope: VERIFIER_ENVELOPE }) };
    }
    if (url.includes('/sync/dayglance-bridge/batch')) {
      batches.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ written: 1, maxSeq: 1 }) };
    }
    if (url.includes('/sync/dayglance-bridge/meta')) {
      return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
    }
    if (url.includes('/sync/dayglance-bridge')) {
      return { ok: true, status: 200, json: async () => ({ rows: [], hasMore: false }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.batches = batches;
  impl.keycheckGets = keycheckGets;
  return impl;
};

const client = () => ({
  getRow: async (app, entityId) => {
    const res = await globalThis.fetch(`https://vault.example/sync/${app}/${entityId}`, {});
    if (res.status === 404) return null;
    return res.json();
  },
});

beforeEach(async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({
    enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1',
  }));
  localStorage.setItem('dayglance-bridge-pairing-meta', JSON.stringify({ meta: META, fetchedAt: Date.now() }));
  __resetBridgeStreamForTests();
  resetBridgeKeyGate();
  await installKey('the-real-passphrase');
  VERIFIER_ENVELOPE = await encryptEntity(KEYCHECK_PAYLOAD, KEYCHECK_ENTITY_ID);
});
afterEach(async () => {
  await clearDbRootKey(noNative).catch(() => {});
  delete globalThis.localStorage;
  delete globalThis.fetch;
  vi.restoreAllMocks();
});

describe('verifiedBridgeRootKey', () => {
  it('returns the key once it decrypts the account verifier, and asks the server once', async () => {
    globalThis.fetch = makeServer();
    const key = getDbRootKey();
    expect(await verifiedBridgeRootKey(client(), 'acct-1')).toBe(key);
    expect(await verifiedBridgeRootKey(client(), 'acct-1')).toBe(key);
    expect(globalThis.fetch.keycheckGets).toHaveLength(1);
  });

  it('refuses the incident\'s empty key, and a wrong passphrase\'s key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = makeServer();
    await installEmptyKeyAsInTheIncident();
    expect(getDbRootKey()).not.toBe(null);
    expect(await verifiedBridgeRootKey(client(), 'acct-1')).toBe(null);

    await installKey('a-different-passphrase');
    expect(await verifiedBridgeRootKey(client(), 'acct-1')).toBe(null);
  });

  it('a refusal is asked again only after the recheck interval; a re-derived key is checked at once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = makeServer();
    await installKey('a-different-passphrase');
    const t0 = 1_000_000;
    expect(await verifiedBridgeRootKey(client(), 'acct-1', t0)).toBe(null);
    expect(await verifiedBridgeRootKey(client(), 'acct-1', t0 + 1000)).toBe(null);
    expect(globalThis.fetch.keycheckGets).toHaveLength(1);
    expect(await verifiedBridgeRootKey(client(), 'acct-1', t0 + KEY_RECHECK_MS)).toBe(null);
    expect(globalThis.fetch.keycheckGets).toHaveLength(2);

    await installKey('the-real-passphrase');
    expect(await verifiedBridgeRootKey(client(), 'acct-1', t0 + KEY_RECHECK_MS + 1)).toBe(getDbRootKey());
    expect(globalThis.fetch.keycheckGets).toHaveLength(3);
  });

  it('no verifier row yet, or no answer: no key, and a network failure is not remembered', async () => {
    globalThis.fetch = makeServer({ verifier: false });
    expect(await verifiedBridgeRootKey(client(), 'acct-1')).toBe(null);

    resetBridgeKeyGate();
    globalThis.fetch = makeServer({ failVerifier: true });
    expect(await verifiedBridgeRootKey(client(), 'acct-1')).toBe(null);
    globalThis.fetch = makeServer();
    expect(await verifiedBridgeRootKey(client(), 'acct-1')).toBe(getDbRootKey());
  });
});

describe('the bridge paths go through the gate', () => {
  it('THE INCIDENT: under the empty key the flush seals nothing and the intent stays queued; the right key then seals it readably', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await installEmptyKeyAsInTheIncident();
    globalThis.fetch = makeServer();

    expect(emitBridgeIntent('task_state', { path: 'a.md', blockId: 'x', done: true })).toBe(true);
    await flushBridgeOutbox();
    expect(globalThis.fetch.batches).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(1);

    // The passphrase entered again: the key every device holds.
    await installKey('the-real-passphrase');
    await flushBridgeOutbox();
    expect(globalThis.fetch.batches).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(0);
    // A plugin copy holding the pairing's subkey opens it.
    const pluginSubkey = await deriveBridgeSubkey(getDbRootKey(), PAIRING_SALT);
    const opened = await openBridgeEnvelope(pluginSubkey, globalThis.fetch.batches[0].rows[0].envelope);
    expect(opened).toMatchObject({ type: 'task_state' });
  });

  it('a key re-derived mid-session does not seal under the old key\'s cached subkey', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = makeServer();
    emitBridgeIntent('task_state', { path: 'a.md', blockId: 'x', done: true });
    await flushBridgeOutbox();
    expect(globalThis.fetch.batches).toHaveLength(1);

    await installKey('a-different-passphrase');
    emitBridgeIntent('task_state', { path: 'a.md', blockId: 'y', done: true });
    await flushBridgeOutbox();
    expect(globalThis.fetch.batches).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(1);
  });

  it('a passphrase changed for the account seals under the new key, not the cached subkey of the old one', async () => {
    globalThis.fetch = makeServer();
    emitBridgeIntent('task_state', { path: 'a.md', blockId: 'x', done: true });
    await flushBridgeOutbox();
    expect(globalThis.fetch.batches).toHaveLength(1);

    // The account is re-keyed: a new passphrase, a new verifier.
    await installKey('the-new-passphrase');
    VERIFIER_ENVELOPE = await encryptEntity(KEYCHECK_PAYLOAD, KEYCHECK_ENTITY_ID);
    emitBridgeIntent('task_state', { path: 'a.md', blockId: 'y', done: true });
    await flushBridgeOutbox();
    expect(globalThis.fetch.batches).toHaveLength(2);
    const newSubkey = await deriveBridgeSubkey(getDbRootKey(), PAIRING_SALT);
    expect(await openBridgeEnvelope(newSubkey, globalThis.fetch.batches[1].rows[0].envelope)).toMatchObject({ type: 'task_state' });
  });

  it('the observation stream holds rather than fails under an unproven key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await installEmptyKeyAsInTheIncident();
    globalThis.fetch = makeServer();
    expect(await fetchBridgeObservations()).toBe(null);
    // A hold (bridgeInboundPolicy.js), not the dead-stream error: main sync
    // already says the passphrase does not match.
    expect(lastBridgeInboundFailure()).toBe('key-pending');
  });

  it('pairing refuses an unproven key, so the vault is never paired onto a subkey no other device derives', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await installEmptyKeyAsInTheIncident();
    globalThis.fetch = makeServer();
    await expect(startBridgePairing({ fake: 'handle' }, 'tok')).rejects.toMatchObject({ code: 'pairing_key_unverified' });
  });
});
