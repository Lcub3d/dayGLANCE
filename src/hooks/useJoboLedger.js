import { useEffect, useRef, useState } from 'react';
import { createJoboStore } from '../jobo/store.js';
import { createLedger } from '../jobo/ledger.js';

// The JOBO ledger's React state, and THE ONLY WRITER of it.
//
// Slice 4's completion detector, slice 5's manual entry and any later importer
// all go through `recordJobo`; both sync tiers' applies go through
// `applyRemoteJobo`. Everything about what those do (held applies during load,
// committed-value refresh, the read-only device) lives in src/jobo/ledger.js,
// which is tested without React. This hook only owns the subscription.
//
// `joboRecords` is undefined until the ledger has loaded, and buildSyncPayload
// must omit the collection while it is undefined: an unreadable ledger is not
// an empty one. docs/jobo-ledger-persistence.md, "Lifecycle".
//
// The merge rule defaults to core's pickJoboRecord, the same function both
// sync tiers use; if any of the three used a different one, two devices holding
// pristine copies of one record would never converge. `pickRecord` and `store`
// are injection points for tests.
export default function useJoboLedger({ pickRecord, store } = {}) {
  const ledger = useRef(null);
  if (ledger.current === null) {
    ledger.current = createLedger({ store: store ?? createJoboStore(), pick: pickRecord });
  }
  const [state, setState] = useState(() => ledger.current.get());

  useEffect(() => {
    const unsubscribe = ledger.current.subscribe(setState);
    ledger.current.load();
    return () => { unsubscribe(); ledger.current.dispose(); };
  }, []);

  return {
    joboRecords: state.records,
    joboLoaded: state.loaded,
    joboWritable: state.writable,
    joboError: state.error,
    recordJobo: ledger.current.commit,
    // Committed plus held, for the detector only; see ledger.workingSet.
    readJoboWorkingSet: ledger.current.workingSet,
    applyRemoteJobo: ledger.current.applyRemote,
    restoreJobo: ledger.current.restore,
    reloadJobo: ledger.current.load,
  };
}
