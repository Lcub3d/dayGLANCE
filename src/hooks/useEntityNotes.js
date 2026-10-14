// A project's or goal's notes (its description): the state behind
// components/notes/EntityNotesBox.jsx, lifted out of the Project Planner so the
// goal detail gets the same box (#2076).
//
// THE LINKED NOTE'S DESCRIPTION (owner ruling 2026-10-03): for an entity
// linked to an Obsidian note, the box IS the section under the note's title.
// Loaded from the vault when the box mounts, edited here, written back as that
// section; refused and reloaded when the section moved in Obsidian meanwhile.
// The record's description is empty for such an entity (it migrated into the
// note). Where this device cannot read the vault, the box says where the
// notes live instead of offering an editor.
//
// The entity's identity is fixed for a mounted box: callers that switch
// entities remount it (key by id), so the unmount flush writes to the entity
// it was editing.
//
// A LINKED NOTE IS RE-READ, NOT HELD. Nothing in sync carries the section (it
// lives in the note, not the record), so a box read once kept showing the
// text it opened with until it remounted, and a goal card can stay on screen
// for hours. The box reads the note again when an Obsidian cycle finishes and
// when the window regains focus (coming back from editing in Obsidian), but
// never over the user's work: not while the editor is open, and not while
// the box holds text the note does not have yet (an unsaved edit, or a
// conflict being settled).

import { useEffect, useRef, useState } from 'react';
import { noteTextHash } from '@glance-apps/obsidian-format';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { noteLinkOf } from '../utils/obsidianProjectNotes.js';

/**
 * @param {object} args
 * @param {'project'|'goal'} args.kind   which entity, as saveNoteDescription takes it
 * @param {object} args.entity           the project or goal record
 * @param {(description: string) => void} args.saveRecord  writes the record's
 *        description, for an entity without a linked note
 * @param {boolean} [args.editWhenEmpty]  open an empty box as the editor (the
 *        planner, whose notes are its first field); false shows a quiet
 *        "Add notes..." prompt instead (a goal's card, shown for every goal)
 */
export default function useEntityNotes({ kind, entity, saveRecord, editWhenEmpty = true }) {
  const { loadNoteDescription, saveNoteDescription, openInObsidian, obsidianLastSynced } = useSyncCtx() || {};
  const noteLink = noteLinkOf(entity);
  const vaultNotes = !!noteLink && !noteLink.missing;

  const [notes, setNotes] = useState(entity.description || '');
  // Shift+Enter (or clicking away) saves and switches to the formatted
  // preview; clicking the preview returns to editing. Starts in preview when
  // notes already exist.
  const [editing, setEditing] = useState(editWhenEmpty && !(entity.description || '').trim());
  const [vault, setVault] = useState({ text: '', base: null, loading: vaultNotes, unavailable: false, error: null, conflict: false });
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    if (!vaultNotes) return undefined;
    if (!loadNoteDescription) { setVault((v) => ({ ...v, loading: false, unavailable: true })); return undefined; }
    let cancelled = false;
    loadNoteDescription(noteLink.path).then((r) => {
      if (cancelled) return;
      if (!r || r.notFound) { setVault({ text: '', base: null, loading: false, unavailable: true, error: r ? 'not_found' : null, conflict: false }); return; }
      setVault({ text: r.text, base: r.base, loading: false, unavailable: false, error: null, conflict: false });
      setNotes(r.text);
      setEditing(editWhenEmpty && !r.text.trim());
    }).catch((err) => { if (!cancelled) setVault({ text: '', base: null, loading: false, unavailable: true, error: err?.message || String(err), conflict: false }); });
    return () => { cancelled = true; };
    // The link's path is the identity of what is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteLink?.path, loadNoteDescription]);

  // True while the box holds nothing the note lacks, so a fresh read may
  // replace what it shows.
  const showsTheNote = () => !editingRef.current && !vaultRef.current.loading
    && !vaultRef.current.conflict && notesRef.current === vaultRef.current.text;
  const reread = () => {
    if (!vaultNotes || !loadNoteDescription || !showsTheNote()) return;
    loadNoteDescription(noteLink.path).then((r) => {
      // Checked again on arrival: the user may have started typing meanwhile.
      if (!mountedRef.current || !showsTheNote()) return;
      if (!r || r.notFound) {
        if (!vaultRef.current.unavailable) setVault({ text: '', base: null, loading: false, unavailable: true, error: r ? 'not_found' : null, conflict: false });
        return;
      }
      if (!vaultRef.current.unavailable && r.text === vaultRef.current.text) return;
      setVault({ text: r.text, base: r.base, loading: false, unavailable: false, error: null, conflict: false });
      setNotes(r.text);
    }).catch(() => {});
  };
  const rereadRef = useRef(reread);
  rereadRef.current = reread;

  // After an Obsidian cycle. The first run is the mount, which the load above
  // already covers.
  const seenSyncRef = useRef(obsidianLastSynced);
  useEffect(() => {
    if (obsidianLastSynced === seenSyncRef.current) return;
    seenSyncRef.current = obsidianLastSynced;
    rereadRef.current();
  }, [obsidianLastSynced]);

  // On returning to the window, the usual way back from editing the note.
  useEffect(() => {
    if (!vaultNotes || typeof window === 'undefined') return undefined;
    const onFocus = () => rereadRef.current();
    const onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') rereadRef.current(); };
    window.addEventListener('focus', onFocus);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [vaultNotes]);

  const save = () => {
    if (vaultNotes) {
      const v = vaultRef.current;
      if (v.loading || v.unavailable || !saveNoteDescription || notes === v.text) return;
      saveNoteDescription(kind, entity.id, noteLink.path, notes, { base: v.base }).then((r) => {
        if (r?.refused) {
          // The section moved in Obsidian: reload it, keep the unsaved text
          // below it for the user to settle, and say so.
          const merged = `${r.text}\n\n${notes}`.trim();
          setVault({ text: r.text, base: noteTextHash(r.text), loading: false, unavailable: false, error: null, conflict: true });
          setNotes(merged);
          setEditing(true);
          return;
        }
        if (r?.ok) setVault((prev) => ({ ...prev, text: notes, base: noteTextHash(notes), conflict: false }));
      }).catch(() => {});
      return;
    }
    if ((entity.description || '') !== notes) saveRecord(notes.trim());
  };

  // Flush unsaved notes when the box goes away (a dashboard closed by Escape,
  // the planner closed, another goal selected).
  useEffect(() => () => {
    if (vaultNotes) {
      // The unmount flush writes without a base, as the task panel's does:
      // nothing can be shown or reloaded on the way out.
      const v = vaultRef.current;
      if (!v.loading && !v.unavailable && saveNoteDescription && notesRef.current !== v.text) {
        saveNoteDescription(kind, entity.id, noteLink.path, notesRef.current).catch(() => {});
      }
      return;
    }
    if ((entity.description || '') !== notesRef.current) saveRecord(notesRef.current.trim());
    // Unmount-only flush; the entity's identity is fixed for a mounted box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { notes, setNotes, editing, setEditing, editWhenEmpty, vault, vaultNotes, noteLink, save, openInObsidian };
}
