import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CI cannot compile the Android app, but the string resources are plain XML —
 * so the mistakes that would break the next local build (or silently ship
 * English) are checked here: a locale key absent from the base file (aapt
 * error), a %1$d placeholder dropped in translation (getString crashes), an
 * unescaped apostrophe (aapt error), or a translatable key missing from a
 * locale (silently English). Plurals are validated item-by-item.
 */
const RES = join(dirname(fileURLToPath(import.meta.url)), '../dayglance-android/app/src/main/res');

const UNTRANSLATED = new Set(['app_name']);

// Strings may be split across several files in one values directory (e.g.
// strings.xml plus widget_preview_strings.xml); aapt merges them, so every
// check reads the directory as a whole.
const stringFiles = (dir) => readdirSync(join(RES, dir))
  .filter((f) => f.endsWith('.xml'))
  .filter((f) => /<(?:string|plurals|string-array)\s+name=/.test(readFileSync(join(RES, dir, f), 'utf8')))
  .sort();
const readStringsXml = (dir) => stringFiles(dir).map((f) => readFileSync(join(RES, dir, f), 'utf8')).join('\n');

function parseStrings(dir) {
  const xml = readStringsXml(dir);
  const out = new Map();
  for (const m of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) out.set(m[1], m[2]);
  for (const m of xml.matchAll(/<plurals name="([^"]+)">([\s\S]*?)<\/plurals>/g)) {
    for (const item of m[2].matchAll(/<item quantity="(\w+)">([\s\S]*?)<\/item>/g)) {
      out.set(`${m[1]}#${item[1]}`, item[2]);
    }
  }
  return out;
}

const base = parseStrings('values');
const locales = readdirSync(RES).filter((d) => /^values-[a-z]{2}(-r[A-Z]{2})?$/.test(d));
// A plural family is the name without its quantity. Base declares only the
// categories English uses (one, other); a locale may declare more (pl and uk
// need few and many), and aapt accepts them. Such an item's placeholders are
// compared against the base's `other`.
const family = (k) => k.split('#')[0];
const baseFor = (k) => base.get(k) ?? base.get(`${family(k)}#other`);
const placeholders = (v) => (v.match(/%(\d\$)?[sd]/g) ?? []).sort().join(',');

/**
 * Android's app-shortcut guidance caps what the launcher actually shows:
 * roughly 10 characters for shortcutShortLabel and 25 for shortcutLongLabel.
 * Past that the launcher truncates with an ellipsis instead of failing, so
 * nothing here or in a build noticed seven languages drifting over it.
 *
 * Length is measured on what the launcher renders rather than on the XML
 * source: an escaped apostrophe is one character on screen, and the two
 * Italian labels are where that changes the answer.
 */
const SHORTCUT_LIMIT = { short: 10, long: 25 };
const XML_ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const renderedLength = (v) => [...v
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => XML_ENTITY[n])
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/\\(.)/g, '$1')].length;
const shortcutKeys = [...base.keys()].filter((k) => /^shortcut_\w+_(short|long)$/.test(k));
const limitFor = (key) => (key.endsWith('_short') ? SHORTCUT_LIMIT.short : SHORTCUT_LIMIT.long);

/**
 * Labels over the recommendation today, so the check can be strict about
 * everything else. The list is meant to shrink.
 *
 * Shortening these is rephrasing, not truncation. pl and uk fit by naming the
 * destination ("Do skrzynki", "У вхідні") where every other language spells
 * out "Add a task to the inbox" in full, and the Romance languages start from
 * an inherently long word for Inbox. That needs a native speaker, so a line
 * comes out when one supplies a shorter form, not before.
 */
const SHORTCUT_OVER_LIMIT = {
  'values-de': [
    'shortcut_voice_short', // 13/10  Spracheingabe
    'shortcut_voice_long', // 31/25  Aufgaben per Sprache hinzufügen
    'shortcut_add_task_short', // 16/10  Geplante Aufgabe
    'shortcut_add_task_long', // 32/25  Eine geplante Aufgabe hinzufügen
    'shortcut_add_inbox_task_short', // 11/10  Posteingang
    'shortcut_add_inbox_task_long', // 39/25  Eine Aufgabe zum Posteingang hinzufügen
  ],
  'values-es': [
    'shortcut_voice_short', // 14/10  Entrada de voz
    'shortcut_add_task_short', // 16/10  Tarea programada
    'shortcut_add_task_long', // 27/25  Añadir una tarea programada
    'shortcut_add_inbox_task_short', // 18/10  Bandeja de entrada
    'shortcut_add_inbox_task_long', // 40/25  Añadir una tarea a la bandeja de entrada
  ],
  'values-fr': [
    'shortcut_voice_short', // 13/10  Saisie vocale
    'shortcut_voice_long', // 28/25  Ajouter des tâches à la voix
    'shortcut_add_task_short', // 15/10  Tâche planifiée
    'shortcut_add_task_long', // 27/25  Ajouter une tâche planifiée
    'shortcut_add_inbox_task_short', // 18/10  Boîte de réception
    'shortcut_add_inbox_task_long', // 41/25  Ajouter une tâche à la boîte de réception
  ],
  'values-it': [
    'shortcut_voice_short', // 12/10  Input vocale
    'shortcut_voice_long', // 29/25  Aggiungi attività con la voce
    'shortcut_add_task_short', // 20/10  Attività programmata
    'shortcut_add_task_long', // 32/25  Aggiungi un'attività programmata
    'shortcut_add_inbox_task_long', // 41/25  Aggiungi un'attività alla posta in arrivo
  ],
  'values-pl': [
    'shortcut_add_inbox_task_short', // 11/10  Do skrzynki
  ],
  'values-pt': [
    'shortcut_voice_short', // 14/10  Entrada de voz
    'shortcut_add_task_short', // 15/10  Tarefa agendada
    'shortcut_add_task_long', // 29/25  Adicionar uma tarefa agendada
    'shortcut_add_inbox_task_short', // 16/10  Caixa de entrada
    'shortcut_add_inbox_task_long', // 39/25  Adicionar uma tarefa à caixa de entrada
  ],
  'values-uk': [
    'shortcut_voice_long', // 26/25  Додавайте завдання голосом
    'shortcut_add_task_long', // 27/25  Додати заплановане завдання
    'shortcut_add_inbox_task_long', // 26/25  Додати завдання до вхідних
  ],
};

describe('Android string resources', () => {
  it('found the locale directories', () => {
    expect(locales.length).toBeGreaterThanOrEqual(5);
  });

  it.each(locales)('%s carries no keys absent from the base file', (loc) => {
    const strings = parseStrings(loc);
    expect(strings.size).toBeGreaterThan(0);
    const extra = [...strings.keys()].filter((k) => !base.has(k) && !base.has(`${family(k)}#other`));
    expect(extra, `${loc} has keys aapt would reject`).toEqual([]);
  });

  it.each(locales)('%s translates every translatable key', (loc) => {
    const strings = parseStrings(loc);
    const missing = [...base.keys()].filter((k) => !UNTRANSLATED.has(k.split('#')[0]) && !strings.has(k));
    expect(missing, `${loc} would silently render these in English`).toEqual([]);
  });

  // Android picks the item by the language's own plural rules, so a missing
  // category silently falls through to another form ("5 zadania"). The
  // categories checked are those the language selects for counts the app can
  // produce, not every one it theoretically has: es/fr/it/pt reserve `many`
  // for millions.
  it.each(locales)('%s defines every plural category its rules select', (loc) => {
    const tag = loc.replace(/^values-/, '').replace('-r', '-');
    const rules = new Intl.PluralRules(tag);
    const categories = new Set();
    for (let n = 0; n <= 1000; n++) categories.add(rules.select(n));
    const strings = parseStrings(loc);
    const families = new Set([...base.keys()].filter((k) => k.includes('#')).map(family));
    const missing = [];
    for (const fam of families) {
      for (const cat of categories) if (!strings.has(`${fam}#${cat}`)) missing.push(`${fam}#${cat}`);
    }
    expect(missing, `${loc} would render another form for these counts`).toEqual([]);
  });

  it.each(locales)('%s keeps every format placeholder', (loc) => {
    const strings = parseStrings(loc);
    const mismatched = [...strings]
      .filter(([k, v]) => placeholders(v) !== placeholders(baseFor(k) ?? ''))
      .map(([k]) => k);
    expect(mismatched, `${loc} placeholder mismatches crash getString at runtime`).toEqual([]);
  });

  it.each(locales)('%s escapes apostrophes for aapt', (loc) => {
    const strings = parseStrings(loc);
    const bad = [...strings].filter(([, v]) => /(^|[^\\])'/.test(v)).map(([k]) => k);
    expect(bad, `${loc} unescaped apostrophes fail the resource compile`).toEqual([]);
  });

  // A Map keeps the last of two same-named entries, so the checks above
  // cannot see a duplicate; aapt refuses it ("Found item String/x more than
  // one time"), which broke a release build once (day_dial_sleep). The
  // directory is read whole, since a name repeated across two of its files
  // fails the same way.
  it.each(['values', ...locales])('%s declares each string once', (dir) => {
    const xml = readStringsXml(dir);
    const names = [...xml.matchAll(/<(?:string|plurals|string-array)\s+name="([^"]+)"/g)].map((m) => m[1]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `${dir} declares these more than once`).toEqual([]);
  });

  // The convention is that a shortcut label is named shortcut_*_short or
  // shortcut_*_long. If a new shortcut breaks that, the length checks below
  // would quietly cover nothing, so tie them to what shortcuts.xml really uses.
  it('the length checks cover every label shortcuts.xml uses', () => {
    const xml = readFileSync(join(RES, 'xml/shortcuts.xml'), 'utf8');
    const used = [...xml.matchAll(/shortcut(?:Short|Long)Label="@string\/(\w+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    const unchecked = used.filter((k) => !shortcutKeys.includes(k));
    expect(unchecked, 'these labels are wired up but fall outside the naming convention').toEqual([]);
  });

  it.each(['values', ...locales])('%s keeps shortcut labels within what the launcher shows', (dir) => {
    const strings = parseStrings(dir);
    const exempt = new Set(SHORTCUT_OVER_LIMIT[dir] ?? []);
    const over = shortcutKeys
      .filter((k) => strings.has(k) && !exempt.has(k))
      .filter((k) => renderedLength(strings.get(k)) > limitFor(k))
      .map((k) => `${k} (${renderedLength(strings.get(k))}/${limitFor(k)})`);
    expect(over, `${dir} labels the launcher would truncate`).toEqual([]);
  });

  // The list only earns its place by shrinking. An entry whose label now fits
  // is a claim that has stopped being true.
  it.each(Object.keys(SHORTCUT_OVER_LIMIT))('%s has no stale over-limit exemption', (dir) => {
    const strings = parseStrings(dir);
    const fits = SHORTCUT_OVER_LIMIT[dir]
      .filter((k) => !strings.has(k) || renderedLength(strings.get(k)) <= limitFor(k));
    expect(fits, `${dir} now fits these; drop them from SHORTCUT_OVER_LIMIT`).toEqual([]);
  });

  it('the over-limit list names only real directories and labels', () => {
    const dirs = new Set(['values', ...locales]);
    const bad = [];
    for (const [dir, keys] of Object.entries(SHORTCUT_OVER_LIMIT)) {
      if (!dirs.has(dir)) bad.push(dir);
      for (const k of keys) if (!shortcutKeys.includes(k)) bad.push(`${dir}/${k}`);
    }
    expect(bad, 'stale entries hide a label from the length check').toEqual([]);
  });

  it('layout files reference only strings that exist', () => {
    const layouts = join(RES, 'layout');
    const missing = [];
    for (const f of readdirSync(layouts).filter((f) => f.endsWith('.xml'))) {
      const xml = readFileSync(join(layouts, f), 'utf8');
      for (const m of xml.matchAll(/@string\/(\w+)/g)) {
        if (!base.has(m[1])) missing.push(`${f}: @string/${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
