// Which note a request to "put the cursor in the note" lands in (the
// planner's E, NotesSubtasksPanel's focusNoteRequest). A task whose title
// links a vault note keeps its note there, so that note takes the cursor,
// even while it is still loading (it takes the cursor when it arrives); one
// that failed to load is skipped. Otherwise the task's own note, where the
// panel shows it: beside linked notes, it shows only when it holds text.

/**
 * @returns {string | null} a linked note's name, 'own', or null for nowhere
 */
export function noteFocusTarget({ wikilinks = [], showLinked, linkedNoteStates = {}, hasLocalNotes }) {
  if (showLinked) {
    const linked = wikilinks.find((name) => !linkedNoteStates[name]?.error);
    if (linked) return linked;
    return hasLocalNotes ? 'own' : null;
  }
  return 'own';
}
