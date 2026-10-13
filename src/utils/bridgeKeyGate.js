// THE BRIDGE KEY GATE (2026-10-12, the empty-key intents).
//
// Every bridge row is sealed under a subkey derived from this device's
// GLANCEvault root key. The DB sync engine proves that key against the
// account's verifier row (`__glance_keycheck`) before it uploads anything,
// and stops with KEY_MISMATCH when it fails. The bridge used to check only
// that a key was in memory. So on 2026-10-10, when an Android phone loaded
// an EMPTY root key (the Direct Access key overwrote its slot, fc10bb9),
// main sync refused to push while the bridge sealed eight Obsidian changes
// under a subkey no plugin copy holds. The plugin holds such rows rather
// than deleting them and drops them after a week, so they were lost.
//
// The bridge now uses the root key only once it has decrypted the same
// verifier row the engine checks. Not verified yet means no subkey: intents
// stay in the outbox (the flush returns early, nothing is dropped), and the
// observation and action streams read as a hold. The verdict is kept per key
// object, so a key re-derived from the passphrase is checked afresh.
import { getDbRootKey, decryptEntity, KEYCHECK_ENTITY_ID } from '@glance-apps/sync/src/dbCrypto.js';
import { APP_ID } from '../sync/dbEngine.js';

// A key that failed, or could not be checked, is asked again at most this
// often: a missing verifier row is established by the next sync cycle.
export const KEY_RECHECK_MS = 60 * 1000;

let verdict = null; // { key, ok, at }
let checkInFlight = null;

/**
 * The root key, once it has decrypted the account's verifier row; else null.
 * Never throws. A network failure is not a verdict and is not remembered.
 * @param {{ getRow: Function }} client  a GLANCEvault client
 * @param {string} accountId
 * @param {number} [nowMs]
 */
export async function verifiedBridgeRootKey(client, accountId, nowMs = Date.now()) {
  const key = getDbRootKey();
  if (!key) return null;
  if (verdict && verdict.key === key) {
    if (verdict.ok) return key;
    if (nowMs - verdict.at < KEY_RECHECK_MS) return null;
  }
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    let row;
    try {
      row = await client.getRow(APP_ID, KEYCHECK_ENTITY_ID, accountId);
    } catch {
      return null;
    }
    // The key may have been re-derived while the request was out.
    if (getDbRootKey() !== key) return null;
    let ok = false;
    if (row && !row.deleted && row.envelope) {
      try {
        await decryptEntity(row.envelope, KEYCHECK_ENTITY_ID, key);
        ok = true;
      } catch {
        if (!(verdict && verdict.key === key)) {
          console.warn('dayGLANCE bridge: this device\'s sync key does not match the account, so Obsidian changes are held here until the passphrase is entered again.');
        }
      }
    }
    verdict = { key, ok, at: nowMs };
    return ok ? key : null;
  })().finally(() => { checkInFlight = null; });
  return checkInFlight;
}

/** For tests: forget the verdict. */
export function resetBridgeKeyGate() {
  verdict = null;
  checkInFlight = null;
}
