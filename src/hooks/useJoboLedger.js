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
// `pickRecord` is core's pickJoboRecord once slice 2 lands; the same function
// has to be the one both sync tiers use, or two devices holding pristine
// copies of one record never converge.
export default function useJoboLedger({ pickRecord, store } = {}) {
  const ledger = useRef(null);
  if (ledger.current === null) {
    ledger.current = createLedger({ store: store ?? createJoboStore(), pick: pickRecord });
  }
  const [state, setState] = useState(() => ledger.current.get());

  useEffect(() => {
    const unsubscribe = ledger.current.subscribe(setState);
    ledger.current.load();
    return unsubscribe;
  }, []);

  return {
    joboRecords: state.records,
    joboLoaded: state.loaded,
    joboWritable: state.writable,
    joboError: state.error,
    recordJobo: ledger.current.commit,
    applyRemoteJobo: ledger.current.applyRemote,
    reloadJobo: ledger.current.load,
  };
}
