import { useEffect, useState } from 'react';
import { readCalendarPreferences, saveCalendarPreferences, YEAR2_CALENDAR_KEY, YEAR2_CALENDAR_EVENT } from '../../jobu/calendar/preferences.js';

const storage = () => { try { return window.localStorage; } catch { return { getItem() { throw new Error('storage'); } }; } };
export default function useYear2Calendar(language) {
  const [state, setState] = useState(() => readCalendarPreferences(typeof window === 'undefined' ? undefined : storage(), language));
  useEffect(() => {
    const read = event => {
      if (event?.type === 'storage' && event.key !== null && event.key !== YEAR2_CALENDAR_KEY) return;
      setState(readCalendarPreferences(storage(), language));
    };
    read();
    window.addEventListener('storage', read); window.addEventListener(YEAR2_CALENDAR_EVENT, read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener(YEAR2_CALENDAR_EVENT, read); };
  }, [language]);
  const change = patch => {
    const result = saveCalendarPreferences(storage(), patch, language);
    setState(result);
    if (!result.error) window.dispatchEvent(new Event(YEAR2_CALENDAR_EVENT));
  };
  const reset = () => {
    try { storage().removeItem(YEAR2_CALENDAR_KEY); setState(readCalendarPreferences(storage(), language)); window.dispatchEvent(new Event(YEAR2_CALENDAR_EVENT)); }
    catch { setState(current => ({ ...current, error: 'write' })); }
  };
  return { ...state, change, reset };
}
