// The per-day cache behind the Morning dayGLANCE and the Evening Reflection.
//
// A briefing is generated once a day and kept in localStorage under its date.
// It is also generated in one language, so the entry records that too: a user
// who switches the app to German at noon would otherwise keep reading the
// English briefing until tomorrow (#1789). An entry written before the
// language was recorded is treated as English, which is what every briefing
// was until then, so upgrading does not throw away today's briefing for
// English users and does regenerate it for everyone else.

const DEFAULT_LANGUAGE = 'en';

/** The parsed entry, or null when there is none or it cannot be read. */
export function parseBriefingCache(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object' || typeof entry.date !== 'string') return null;
    return entry;
  } catch {
    return null;
  }
}

/** Is this entry today's briefing in the language the app shows now? */
export function isBriefingCurrent(entry, today, language) {
  return !!entry
    && entry.date === today
    && (entry.language ?? DEFAULT_LANGUAGE) === language;
}

/** Read the cached text for today in this language, or null. */
export function readBriefingCache(storage, key, today, language) {
  let raw = null;
  try { raw = storage.getItem(key); } catch { return null; }
  const entry = parseBriefingCache(raw);
  return isBriefingCurrent(entry, today, language) && typeof entry.text === 'string' ? entry.text : null;
}

/** Store today's briefing with the language it was written in. */
export function writeBriefingCache(storage, key, today, language, text) {
  try {
    storage.setItem(key, JSON.stringify({ date: today, language, text }));
  } catch { /* quota or privacy mode: the briefing still shows, it is just not cached */ }
}
