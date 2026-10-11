// Direct Access INTENTS opt-in gate (docs/direct-access-sync.md, Phase 7).
//
// Mirrors icloudIntentsConfig.js: a single persisted boolean, default FALSE,
// independent of the Direct Access SYNC switch. The intents path (emitting to
// the event-set file and polling it) is active only when the user flipped
// this on AND a folder is connected on this device. Without the opt-in the
// path is fully inert, so "GLANCEintents is opt-in and off by default" holds
// for this transport too.

import { directAccessTransport } from '../sync/directAccessTransport.js';

export const DIRECT_ACCESS_INTENTS_ENABLED_KEY = 'dayglance-direct-access-intents-enabled';

/** The raw opt-in flag, independent of the connection. @returns {boolean} */
export function getDirectAccessIntentsEnabledFlag(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    return storage?.getItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the opt-in flag. Removes the key when disabling. */
export function setDirectAccessIntentsEnabled(enabled, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    if (enabled) storage?.setItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY, 'true');
    else storage?.removeItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY);
  } catch {
    /* ignore persistence failures (private mode, quota, etc.) */
  }
}

/**
 * True only when the user opted in AND a folder is connected on this device
 * (connected or temporarily unreachable: the deliverer holds while it is
 * away). Both the emit target and the poller are gated on this.
 */
export function isDirectAccessIntentsEnabled(transport = directAccessTransport) {
  if (!getDirectAccessIntentsEnabledFlag()) return false;
  if (!transport?.isSupported?.()) return false;
  return typeof transport.isConnected === 'function' ? transport.isConnected() : false;
}
