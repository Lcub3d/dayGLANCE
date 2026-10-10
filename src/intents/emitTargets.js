// Which outbound transports are enabled for an emitted intent, in the outbox's
// transport-name vocabulary ('webdav' | 'icloud' | 'vault' | 'directAccess').
// Shared by the three emit sites so they enqueue with a consistent target set.
// Only ENABLED targets are included — the outbox then drives each one through
// its deliverer.

import { isDbIntentsEnabled } from './dbIntentsConfig.js';
import { isIcloudIntentsEnabled } from './icloudIntentsConfig.js';
import { isDirectAccessIntentsEnabled } from './directAccessIntentsConfig.js';

/**
 * @param {object|null} config - the WebDAV intents config (INTENT_CONFIG_KEY)
 * @returns {Array<'webdav'|'icloud'|'vault'|'directAccess'>}
 */
export function enabledIntentTargets(config) {
  const targets = [];
  if (config?.webdavUrl && config?.username && config?.appPassword) targets.push('webdav');
  if (isIcloudIntentsEnabled()) targets.push('icloud');
  if (isDbIntentsEnabled()) targets.push('vault');
  if (isDirectAccessIntentsEnabled()) targets.push('directAccess');
  return targets;
}
