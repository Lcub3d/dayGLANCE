import { useSyncExternalStore } from 'react';
import { directAccessTransport } from '../sync/directAccessTransport.js';

/**
 * The Direct Access connection as React state: `{ supported, status, name,
 * path, connected, enabled }` (sync/directAccessTransport.js). Subscribing is
 * what asks the main process to re-open the remembered folder, so the first
 * component to render this hook starts the connection.
 */
export default function useDirectAccessStatus(transport = directAccessTransport) {
  return useSyncExternalStore(transport.subscribe, transport.getSnapshot, transport.getSnapshot);
}
