import { useCallback, useEffect, useRef, useState } from 'react';

// A JOBO view preference (START to END only, the notes sidebar): this
// device's, like a remembered tab, so it lives in localStorage and never in
// synced data. Storage can be unavailable (private windows, blocked site
// data); the preference then simply starts off each time.
//
// Every user of one preference sees a change at once: a toggle tells the
// others through a window event, so a button in one place (the phone's date
// header) and the view it changes stay in step.
export const JOBO_PREFERENCE_EVENT = 'dayglance:jobo-preference';
const keyFor = (name) => `dg-jobo-${name}`;

const read = (name) => {
  try { return localStorage.getItem(keyFor(name)) === '1'; } catch { return false; }
};

export default function useJoboPreference(name) {
  const [on, setOn] = useState(() => read(name));
  const onRef = useRef(on);
  onRef.current = on;
  useEffect(() => {
    const onChange = (event) => { if (event.detail?.name === name) setOn(event.detail.on === true); };
    window.addEventListener(JOBO_PREFERENCE_EVENT, onChange);
    return () => window.removeEventListener(JOBO_PREFERENCE_EVENT, onChange);
  }, [name]);
  const toggle = useCallback(() => {
    const next = !onRef.current;
    onRef.current = next;
    try { localStorage.setItem(keyFor(name), next ? '1' : '0'); } catch { /* not remembered */ }
    setOn(next);
    window.dispatchEvent(new CustomEvent(JOBO_PREFERENCE_EVENT, { detail: { name, on: next } }));
  }, [name]);
  return [on, toggle];
}

/**
 * A JOBO split this device remembers, as a share of the space (0 to 1):
 * the Daily Note's part of the notes sidebar. Same storage rules as above;
 * a missing or unreadable value starts at `fallback`.
 */
export function useJoboShare(name, fallback, clamp = (v) => v) {
  const [share, setShare] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(keyFor(name)));
      return localStorage.getItem(keyFor(name)) !== null && Number.isFinite(stored) ? clamp(stored) : fallback;
    } catch { return fallback; }
  });
  const remember = useCallback((next) => {
    const value = clamp(next);
    setShare(value);
    try { localStorage.setItem(keyFor(name), String(Math.round(value * 1000) / 1000)); } catch { /* not remembered */ }
  }, [name, clamp]);
  return [share, remember];
}
