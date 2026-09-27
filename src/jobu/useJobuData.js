import { useEffect, useState, useSyncExternalStore } from 'react';
import { createJobuData } from './data.js';
export default function useJobuData() {
  const [data] = useState(() => createJobuData());
  const [lifecycle] = useState(() => ({ generation: 0 }));
  const state = useSyncExternalStore(data.subscribe, data.get, data.get);
  useEffect(() => {
    const generation = ++lifecycle.generation;
    data.connect(typeof BroadcastChannel === 'function' ? new BroadcastChannel('jobu-personal-v1') : null);
    data.load();
    return () => {
      // StrictMode sets up again synchronously. Real unmount releases timers
      // and channels without disposing a live StrictMode controller.
      queueMicrotask(() => { if (lifecycle.generation === generation) data.dispose(); });
    };
  }, [data, lifecycle]);
  return { data, ...state };
}
