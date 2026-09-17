// Task notes into the vault (companion spec §4.3, owner ruling 2026-09-14;
// the linked-task half and the record's note target, owner 2026-09-17,
// report docs/reports/obsidian-linked-note-append.md). Pure.
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
//
// THE RECORD'S NOTE TARGET (2026-09-17). The migration writes the target it
// created onto the record as `obsidianNoteTarget`. Later notes on that task
// (from any writer: the panel, the MCP server, a conflict record, a bin
// notice, a stale row from another device) are APPENDED to that note and
// the field cleared again; the discriminator is the stored target, or, for
// a task migrated before the field existed, a link in the project note's
// folder whose basename is the name this title derives (suffix allowed).
// Hand-linked and shared notes are never appended to: their local notes
// stay local, and the panel shows them beside the linked note. The field
// also lets the writeback re-assert a link the vault dropped before it was
// ever observed (the create-with-notes bug), and it is cleared when an
// observed line that once carried the link no longer does (a user unlink
// in Obsidian) or when the title loses the link in dayGLANCE.

import { noteNameFromTitle, validateWikiNoteName } from '@glance-apps/obsidian-format';
import { noteLinkOf, normalizeNotePath } from './obsidianProjectNotes.js';
import { extractWikilinks, sameNoteTarget } from './taskUtils.js';

/** A derived note name is cut here; the title stays whatever length it is. */
export const TASK_NOTE_NAME_MAX = 80;

const WIKILINK_RE = /\[\[[^\]]+\]\]/g;
const HASHTAG_RE = /(^|\s)#\p{L}[\p{L}\p{N}_-]*/gu;

/** The title as plain words: wikilinks and hashtags dropped, whitespace collapsed. */
export function plainTaskTitle(title) {
  return String(title ?? '')
    .replace(WIKILINK_RE, ' ')
    .replace(HASHTAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The note name a task title derives: the plain title through the
 * portability rules (noteNameFromTitle), capped. Null when nothing nameable
 * is left.
 */
export function taskNoteNameFor(title) {
  const bare = plainTaskTitle(title);
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

/** The title with the note's link inserted before the display tag. */
export function titleWithNoteLink(title, target) {
  const text = String(title || '');
  const tag = text.match(/\s*#obsidian\b.*$/i);
  return tag
    ? `${text.slice(0, tag.index).trim()} [[${target}]]${tag[0]}`
    : `${text.trim()} [[${target}]]`;
}

/** True when the title carries a wikilink to this target. */
export function titleLinksTarget(title, target) {
  if (!target) return false;
  return extractWikilinks(String(title || '')).some((l) => sameNoteTarget(l, target));
}

/** Open, placed under a token in the linked note of its own project. */
function placedInProjectNote(task, project) {
  if (!task || !project) return false;
  if (task.completed || task.archived || task.recurrence || task.recurringTemplateId) return false;
  if (task.importSource !== 'obsidian' || !task.obsidianBlockId || !task.obsidianRawTitle) return false;
  const link = noteLinkOf(project);
  if (!link || link.missing) return false;
  return !!task.obsidianNotePath && normalizeNotePath(task.obsidianNotePath) === normalizeNotePath(link.path);
}

/**
 * The migration for one task, or null when there is nothing to do.
 *
 * Eligible: an open, placed task (its line is in the linked note of the
 * project it is assigned to, under a token) with notes in the app and no
 * wikilink in its title. The result names the note to create (a wikilink
 * target, folder-qualified when the project note has a folder), the title
 * with the link inserted before the display tag, and the notes to write.
 * A derived-name file that already exists is appended to by the applier
 * (create_or_append), unchanged since #1659 (owner 2026-09-17, option D).
 *
 * @param {object} task
 * @param {object} project              the task's project
 * @param {{ tasks?: object[], reservedNotePaths?: string[] }} [ctx]
 *   tasks: every task whose links must not be reused (all lists);
 *   reservedNotePaths: the projects' and goals' own linked notes
 * @returns {{ kind: 'create', target: string, title: string, content: string } | null}
 */
export function planTaskNoteMigration(task, project, { tasks = [], reservedNotePaths = [] } = {}) {
  if (!placedInProjectNote(task, project)) return null;
  const notes = typeof task.notes === 'string' ? task.notes.trim() : '';
  if (!notes) return null;
  const title = String(task.title || '');
  if (extractWikilinks(title).length > 0) return null;

  const link = noteLinkOf(project);
  const taken = new Set();
  for (const t of tasks) for (const w of extractWikilinks(String(t?.title || ''))) reserve(taken, w);
  for (const p of reservedNotePaths) reserve(taken, p);
  reserve(taken, link.path);
  const target = taskNoteTargetFor(link.path, title, taken);
  if (!target || validateWikiNoteName(target)) return null;
  return { kind: 'create', target, title: titleWithNoteLink(title, target), content: notes };
}

/**
 * Is this link target the conversion's own note for the task? By the stored
 * target when the record has one; otherwise (a task migrated before the
 * field) by shape: in the project note's folder, basename equal to the name
 * the current title derives, a collision suffix allowed. A task renamed
 * since its migration and carrying no stored target reads as hand-linked.
 */
export function isOwnTaskNote(task, project, target) {
  if (!target) return false;
  if (task?.obsidianNoteTarget) return sameNoteTarget(target, task.obsidianNoteTarget);
  const link = noteLinkOf(project);
  if (!link) return false;
  const folder = folderOfNotePath(link.path).toLowerCase();
  const t = String(target).split('#')[0].replace(/\.md$/i, '').trim();
  const tFolder = t.includes('/') ? t.slice(0, t.lastIndexOf('/')).toLowerCase() : '';
  if (tFolder !== folder) return false;
  const name = taskNoteNameFor(task?.title);
  if (!name) return false;
  const base = basenameOf(t).toLowerCase();
  return base === name.toLowerCase() || new RegExp(`^${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`).test(base);
}

/**
 * The append for a task that already carries its own note's link: the notes
 * go to that note, the field clears, the title stays. Null for a task with
 * no notes, no link, or a link that is not the conversion's own (hand-linked
 * or shared: local notes stay local, visible beside the linked note).
 *
 * @returns {{ kind: 'append', target: string, content: string } | null}
 */
export function planLinkedNoteAppend(task, project) {
  if (!placedInProjectNote(task, project)) return null;
  const notes = typeof task.notes === 'string' ? task.notes.trim() : '';
  if (!notes) return null;
  const links = extractWikilinks(String(task.title || ''));
  if (links.length === 0) return null;
  const own = links.map((l) => l.split('#')[0].trim()).find((l) => isOwnTaskNote(task, project, l));
  if (!own || validateWikiNoteName(own)) return null;
  return { kind: 'append', target: own, content: notes };
}

/**
 * The link to put back: the record names its note, the title has lost the
 * link, and no observation has yet shown the line carrying it (the
 * create-with-notes bug: the line's write-time guard refused the retitle and
 * the vault's title won). Once an observation has shown the link, a title
 * without it is the user's unlink and the target is cleared instead
 * (mergeObsidianTasks.js). Null when nothing is to be re-asserted.
 *
 * @returns {{ kind: 'reassert', target: string, title: string } | null}
 */
export function planNoteLinkReassert(task, project) {
  if (!placedInProjectNote(task, project)) return null;
  const target = task.obsidianNoteTarget;
  if (!target || task.obsidianNoteLinkSeen) return null;
  if (titleLinksTarget(task.title, target)) return null;
  if (validateWikiNoteName(target)) return null;
  return { kind: 'reassert', target, title: titleWithNoteLink(task.title, target) };
}
