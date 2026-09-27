import { useCallback, useState } from 'react';

// A JOBO view preference (START to END only, the notes sidebar): this
// device's, like a remembered tab, so it lives in localStorage and never in
// synced data. Storage can be unavailable (private windows, blocked site
// data); the preference then simply starts off each time.
const keyFor = (name) => `dg-jobo-${name}`;

const read = (name) => {
  try { return localStorage.getItem(keyFor(name)) === '1'; } catch { return false; }
};

export default function useJoboPreference(name) {
  const [on, setOn] = useState(() => read(name));
  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      try { localStorage.setItem(keyFor(name), next ? '1' : '0'); } catch { /* not remembered */ }
      return next;
    });
  }, [name]);
  return [on, toggle];
}
