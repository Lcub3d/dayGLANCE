import { useCallback, useState } from 'react';

// JOBO's "only START to END" view preference: this device's, like a
// remembered tab, so it lives in localStorage and never in synced data.
// Storage can be unavailable (private windows, blocked site data); the
// toggle then simply starts off each time.
const KEY = 'dg-jobo-window-only';

const read = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

export default function useJoboWindowOnly() {
  const [on, setOn] = useState(read);
  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  return [on, toggle];
}
