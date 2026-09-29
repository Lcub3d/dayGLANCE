import { useState, useEffect, useRef } from 'react';
import { renderNoteTemplateSubset } from '@glance-apps/obsidian-format';
import { localizeEmptyDailyNote } from '../utils/dailyNoteTemplate.js';
import { seedDailyNoteText, shouldPersistDailyNote } from '../utils/dailyNoteModalSeed.js';

// One daily note being edited: what it opened with, what it loaded, and when
// a change may be written back. Shared by the Daily Notes modal and the JOBO
// sidebar's inline editor, so both follow the same vault rules
// (utils/dailyNoteModalSeed.js):
//
//   - With Obsidian, the note is read fresh from the vault on mount. Nothing
//     is written until that read has resolved, so a close during loading
//     never overwrites the vault with the stale initial state.
//   - Every save path writes only a change to what was last loaded or saved.
//     An untouched seed, template or otherwise, is never written back.
//   - Whatever is still unsaved is written on unmount.
//
// Mount it per date (key it by date): the read happens once, on mount.
export default function useDailyNoteDraft({ dateStr, note, onSave, template, loadFresh }) {
  // The template's `{{date}}` / `{{title}}` are filled for this date, the
  // same subset every daily-note creation point renders (companion §4.4).
  const seededTemplate = template ? renderNoteTemplateSubset(template, { title: dateStr, date: dateStr }) : template;
  const defaultText = localizeEmptyDailyNote(note?.text || '', seededTemplate);
  const [text, setText] = useState(defaultText);
  // What was last loaded or saved, and whether the date had real content on
  // open: a save writes back only a change to that baseline.
  const baselineRef = useRef(defaultText);
  const hadContentRef = useRef(!!(note?.text && note.text.trim()));
  const [isEditing, setIsEditing] = useState(!note?.text);
  const [loading, setLoading] = useState(!!loadFresh);
  // Whether loadFresh resolved; save-on-unmount is skipped until it does.
  const freshLoadedRef = useRef(!loadFresh);
  // Set when a caller has already saved on its way out, so the unmount save
  // does not write a second time.
  const savedOnCloseRef = useRef(false);

  // If an async loadFresh callback is provided (Obsidian), read fresh content on mount
  useEffect(() => {
    if (!loadFresh) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await loadFresh(dateStr);
        if (cancelled) return;
        // Vault text first; an empty or absent read falls back to the app's
        // own copy of the date; the template seeds only when neither holds
        // content (utils/dailyNoteModalSeed.js).
        const seed = seedDailyNoteText({ fresh: fresh?.text ?? null, known: note?.text ?? null, template: seededTemplate });
        const next = seed.fromTemplate ? seed.text : localizeEmptyDailyNote(seed.text, seededTemplate);
        baselineRef.current = next;
        hadContentRef.current = seed.hadContent;
        setText(next);
        setIsEditing(!seed.hadContent);
      } catch (err) {
        console.error('Failed to load fresh note from vault:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          freshLoadedRef.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
    // Mount-once: load this date's note. Callers remount per date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // For non-Obsidian: apply template on mount when note is empty
  useEffect(() => {
    if (loadFresh) return; // Obsidian path handles this above
    if (!defaultText && seededTemplate) {
      baselineRef.current = seededTemplate;
      setText(seededTemplate);
    }
    // Mount-once: seed the template only on open, not on later prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const textRef = useRef(text);
  const onSaveRef = useRef(onSave);
  const dateStrRef = useRef(dateStr);
  useEffect(() => { textRef.current = text; }, [text]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { dateStrRef.current = dateStr; }, [dateStr]);

  // Every save path funnels through here: nothing is written unless the
  // text differs from the baseline, and a write moves the baseline.
  const persist = (value) => {
    if (!shouldPersistDailyNote(value, baselineRef.current, hadContentRef.current)) return;
    baselineRef.current = value;
    onSaveRef.current(dateStrRef.current, value);
  };

  // Save on unmount — skip if loadFresh never resolved, and skip if a caller
  // already saved on its way out. Both refs are read at unmount on purpose:
  // what matters is their value then, not when the effect ran. They hold
  // flags, not DOM nodes.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (freshLoadedRef.current && !savedOnCloseRef.current) {
        persist(textRef.current);
      }
    };
  }, []);

  return { text, setText, isEditing, setIsEditing, loading, persist, savedOnCloseRef };
}
