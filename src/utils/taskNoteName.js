// Task notes into the vault (companion spec §4.3, owner ruling 2026-09-14).
// Pure.
//
// A task in a project with a linked note lives in that note (project
// routing). Its NOTES, typed in dayGLANCE, used to stay in the app record
// with no vault counterpart. Now they become a note of their own in the
// project's folder, linked from the task's line with a [[wikilink]], so the
// notes button opens the vault note (the open-book rule) and Obsidian sees
// the notes next to the project. The wikilink rides in the title exactly as
// a hand-typed one does, so every existing path (the linked-note editor,
// the retitle writeback, the observation round trip) already handles it.
//
// Rulings: the name is derived from the title once, when the note is
// created, and never follows a later retitle (the link is the identity; a
// rename in Obsidian updates the link like any other). Notes typed where
// the vault is unreachable stay in the app and migrate on the next pass
// that can write (plugin-authoritative). A note that already exists under
// the derived name is someone's: the app suffixes against names it knows
// (other tasks' links, the projects' and goals' own notes) and the applier
// appends rather than overwrites for the rest (wiki_note_write's
// create_or_append mode). Open tasks only: a completed task's record is the
// completion log.

import { noteNameFromTitle, validateWikiNoteName } from '@glance-apps/obsidian-format';
import { noteLinkOf, normalizeNotePath } from './obsidianProjectNotes.js';
import { extractWikilinks } from './taskUtils.js';

/** A derived note name is cut here; the title stays whatever length it is. */
export const TASK_NOTE_NAME_MAX = 80;

const WIKILINK_RE = /\[\[[^\]]+\]\]/g;
const HASHTAG_RE = /(^|\s)#\p{L}[\p{L}\p{N}_-]*/gu;

/**
 * The note name a task title derives: wikilinks and hashtags dropped, the
 * portability rules applied (noteNameFromTitle), capped. Null when nothing
 * nameable is left.
 */
export function taskNoteNameFor(title) {
  const bare = String(title ?? '')
    .replace(WIKILINK_RE, ' ')
    .replace(HASHTAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!bare) return null;
  const name = noteNameFromTitle(bare.length > TASK_NOTE_NAME_MAX ? bare.slice(0, TASK_NOTE_NAME_MAX).trim() : bare);
  return validateWikiNoteName(name) ? null : name;
}

/** The folder of a vault path ('' at the root). */
export function folderOfNotePath(path) {
  const p = normalizeNotePath(path);
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
}

const basenameOf = (target) => String(target).split('/').pop();

/**
 * The wikilink target for a task's note: the derived name inside the
 * project note's folder, suffixed " 2", " 3", … while the name is taken.
 * `taken` holds lower-cased targets AND bare basenames: Obsidian resolves a
 * bare [[link]] by basename anywhere in the vault, so a new note must not
 * share a basename with one a link already names.
 */
export function taskNoteTargetFor(projectNotePath, title, taken = new Set()) {
  const name = taskNoteNameFor(title);
  if (!name) return null;
  const folder = folderOfNotePath(projectNotePath);
  const base = folder ? `${folder}/${name}` : name;
  const isTaken = (t) => taken.has(t.toLowerCase()) || taken.has(basenameOf(t).toLowerCase());
  if (!isTaken(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} ${n}`;
    if (!isTaken(candidate)) return candidate;
  }
  return null;
}

/** Adds a note reference (a wikilink target or a vault path) to a taken set. */
function reserve(taken, ref) {
  const s = String(ref ?? '').split('#')[0].replace(/\.md$/i, '').trim();
  if (!s) return;
  taken.add(s.toLowerCase());
  taken.add(basenameOf(s).toLowerCase());
}

/**
 * The migration for one task, or null when there is nothing to do.
 *
 * Eligible: an open, placed task (its line is in the linked note of the
 * project it is assigned to, under a token) with notes in the app and no
 * wikilink in its title. The result names the note to create (a wikilink
 * target, folder-qualified when the project note has a folder), the title
 * with the link inserted before the display tag, and the notes to write.
 *
 * @param {object} task
 * @param {object} project              the task's project
 * @param {{ tasks?: object[], reservedNotePaths?: string[] }} [ctx]
 *   tasks: every task whose links must not be reused (all lists);
 *   reservedNotePaths: the projects' and goals' own linked notes
 * @returns {{ target: string, title: string, content: string } | null}
 */
export function planTaskNoteMigration(task, project, { tasks = [], reservedNotePaths = [] } = {}) {
  if (!task || !project) return null;
  const notes = typeof task.notes === 'string' ? task.notes.trim() : '';
  if (!notes) return null;
  if (task.completed || task.archived || task.recurrence || task.recurringTemplateId) return null;
  if (task.importSource !== 'obsidian' || !task.obsidianBlockId || !task.obsidianRawTitle) return null;
  const link = noteLinkOf(project);
  if (!link || link.missing) return null;
  if (!task.obsidianNotePath || normalizeNotePath(task.obsidianNotePath) !== normalizeNotePath(link.path)) return null;
  const title = String(task.title || '');
  if (extractWikilinks(title).length > 0) return null;

  const taken = new Set();
  for (const t of tasks) for (const w of extractWikilinks(String(t?.title || ''))) reserve(taken, w);
  for (const p of reservedNotePaths) reserve(taken, p);
  reserve(taken, link.path);
  const target = taskNoteTargetFor(link.path, title, taken);
  if (!target) return null;

  const tag = title.match(/\s*#obsidian\b.*$/i);
  const newTitle = tag
    ? `${title.slice(0, tag.index).trim()} [[${target}]]${tag[0]}`
    : `${title.trim()} [[${target}]]`;
  return { target, title: newTitle, content: notes };
}
