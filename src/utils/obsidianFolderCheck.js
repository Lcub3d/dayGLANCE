// THE DAILY-NOTE PATH PREVIEW (2026-10-03, field report). Pure.
//
// A user picked the "Daily Notes" folder itself as the vault, then typed
// "Daily Notes" into the daily-notes folder setting. dayGLANCE created
// Daily Notes/Daily Notes inside it and wrote a second copy of each day's
// note there; it took reading the source to see why. Settings now shows the
// path a daily note resolves to, and says so when the picked folder's own
// name is the first segment of the setting, which is the nesting shape.
// The name of the picked folder is all the picker exposes (a browser
// directory handle has no path), and it is enough for this check.

/**
 * @param {{ vaultName?: string|null, dailyNotesPath?: string|null, dailyNotePattern?: string|null, formatDatePattern?: Function, now?: Date }} a
 * @returns {{ folder: string, file: string, path: string, nested: boolean }}
 */
export function describeDailyNotePath({ vaultName, dailyNotesPath, dailyNotePattern, formatDatePattern, now = new Date() }) {
  const vault = String(vaultName ?? '').trim();
  const folder = String(dailyNotesPath ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  const pattern = String(dailyNotePattern ?? '').trim() || 'yyyy-MM-dd';
  let file;
  try {
    file = `${typeof formatDatePattern === 'function' ? formatDatePattern(now, pattern) : pattern}.md`;
  } catch {
    file = `${pattern}.md`;
  }
  const first = folder.split('/')[0];
  const nested = !!vault && !!first && first.toLowerCase() === vault.toLowerCase();
  return { folder, file, path: [vault, folder, file].filter(Boolean).join('/'), nested };
}
