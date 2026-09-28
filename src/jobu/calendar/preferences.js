export const YEAR2_CALENDAR_KEY = 'day-planner-year2-calendar';
export const YEAR2_CALENDAR_EVENT = 'year2-calendar-preferences';
export const calendarDefaults = language => ({ version: 1,
  lunar: /^zh(?:-|$)/i.test(language || ''), terms: /^zh(?:-|$)/i.test(language || ''),
  festivals: /^zh(?:-|$)/i.test(language || ''),
  // Language does not determine jurisdiction. Mainland holiday data is opt-in.
  region: 'none', density: 'agenda',
});
const fields = ['lunar', 'terms', 'festivals', 'region', 'density'];
export function validCalendarPreferences(value) {
  return !!value && typeof value === 'object' && value.version === 1
    && ['lunar', 'terms', 'festivals'].every(key => typeof value[key] === 'boolean')
    && ['none', 'CN'].includes(value.region) && ['agenda', 'overview'].includes(value.density);
}
export function readCalendarPreferences(storage, language) {
  try {
    const raw = storage?.getItem(YEAR2_CALENDAR_KEY);
    if (raw == null) return { preferences: calendarDefaults(language), error: null };
    const value = JSON.parse(raw);
    if (!validCalendarPreferences(value)) throw new Error('invalid');
    return { preferences: value, error: null };
  } catch { return { preferences: calendarDefaults(language), error: 'read' }; }
}
export function saveCalendarPreferences(storage, patch, language) {
  const current = readCalendarPreferences(storage, language);
  if (current.error) return current;
  const filtered = Object.fromEntries(Object.entries(patch).filter(([key]) => fields.includes(key)));
  const next = { ...current.preferences, ...filtered };
  if (!validCalendarPreferences(next)) return { ...current, error: 'write' };
  try {
    if (!storage) throw new Error('storage');
    storage.setItem(YEAR2_CALENDAR_KEY, JSON.stringify(next));
    return { preferences: next, error: null };
  } catch { return { ...current, error: 'write' }; }
}
