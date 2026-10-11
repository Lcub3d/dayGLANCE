import { useCallback, useEffect, useRef, useState } from 'react';
import { createAspireNotebook } from '../aspire/notebook.js';
import { isTrayMode } from '../utils/trayMode.js';
import { isResetInProgress } from '../utils/resetAppData.js';
import { LOCAL_EDIT_KEY } from '../sync/snapshotFileSync.js';

// Always mounted, including when Aspire's experimental UI is switched off.
export default function useAspireNotebook({ store } = {}) {
  const notebook = useRef(null);
  if (notebook.current === null) notebook.current = createAspireNotebook({ store });
  const [state, setState] = useState(() => notebook.current.get());
  useEffect(() => {
    const unsubscribe = notebook.current.subscribe(setState);
    notebook.current.load();
    return () => { unsubscribe(); notebook.current.dispose(); };
  }, []);
  const commitAspire = useCallback(async operation => {
    if (isTrayMode || isResetInProgress()) return { ok: false, error: 'readOnly' };
    const result = await notebook.current.commit(operation);
    if (result.ok) {
      try { localStorage.setItem(LOCAL_EDIT_KEY, new Date().toISOString()); } catch { /* notebook itself is durable */ }
    }
    return result;
  }, []);
  return {
    aspireEntries: state.records,
    aspireLoaded: state.loaded,
    aspireWritable: state.writable && !isTrayMode && !isResetInProgress(),
    aspireError: state.error,
    commitAspire,
    applyRemoteAspire: notebook.current.applyRemote,
    restoreAspire: notebook.current.restore,
    reloadAspire: notebook.current.load,
  };
}
