import { useState, useSyncExternalStore } from 'react';
import { createPlanningPreferences } from '../lifeplanner/preferences.js';

export default function usePlanningPreferences() {
  const [store] = useState(() => createPlanningPreferences({
    storage: {
      getItem: key => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    target: window,
  }));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  return {
    ...snapshot,
    setJoboEnabled: value => store.set('joboEnabled', value),
    setLifeplannerEnabled: value => store.set('lifeplannerEnabled', value),
  };
}
