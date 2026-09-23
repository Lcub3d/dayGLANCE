/**
 * Skips widget-snapshot pushes whose content has not changed, and — for the
 * day-keyed payload — separates "store it" from "redraw for it".
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * The snapshot effect re-runs far more often than the snapshot changes. Its
 * dependency array includes `currentTime` (a 15-second interval) and several
 * derived arrays — todayAgenda, activeHabits, hgVisibleProjects, glanceAhead —
 * that are rebuilt each render, so their identity changes even when their
 * contents do not. Observed on a real device: 108 consecutive pushes of a
 * byte-identical 13 KB payload while the app sat idle.
 *
 * Each push is more expensive than it looks. The bridge is a SYNCHRONOUS XHR
 * (see bridgeScript() in WebView.swift), so every call blocks the JS thread for
 * the round trip; and on the native side WidgetBridge.updateSnapshot runs
 * WidgetCenter.reloadAllTimelines() and LiveActivityBridge.sync() each time. A
 * hundred redundant pushes is a hundred timeline reloads for data that did not
 * move.
 *
 * ── The trap ───────────────────────────────────────────────────────────────
 * The obvious fix — remember the last JSON and compare — does nothing, because
 * the snapshot ends with `updatedAt: Date.now()`. Every serialization differs,
 * so a naive comparison never matches and every push still goes through. (It is
 * also why the byte counts looked identical while the bytes were not: a
 * millisecond timestamp is always 13 digits.) The comparison has to exclude that
 * field, which is what this module is for.
 *
 * `updatedAt` is not the only such field, which the first version of this module
 * got wrong: buildUpNextFact sets `countdownStartMs: inProgress ? startMs : nowMs`,
 * so for an upcoming entry it is Date.now() too. Both are excluded below. Every
 * other input is stable between block boundaries — computeDaySummary takes no
 * clock argument, and the rest of buildUpNextFact's output is derived from the
 * entry's own times.
 *
 * ── Two fingerprints, since the payload became day-keyed ───────────────────
 * The snapshot now carries `days: [tomorrow, +2, +3]` (widgetDayProjection.js).
 * A change three days out has to be STORED — it is the content a widget will
 * switch to at that midnight — but nothing on any home screen shows it, so it
 * must not spend a timeline reload; the dial already has reload-budget
 * pressure from drag-editing. Hence:
 *
 *   full  — everything: decides whether to push at all.
 *   hot   — everything a widget can currently be showing: today's fields,
 *           the day-invariant blocks, and TOMORROW (the midnight timeline
 *           entry on iOS renders it before any reload). Decides whether the
 *           push carries `reloadWidgets: true`.
 *
 * `monthWindow` (widgetMonthWindow.js) is hot WHOLE, on purpose: a month grid
 * shows all six weeks at once, so an edit on day 41 is on screen, and the iOS
 * midnight entry renders the snapshot it was built with, so a stored-only
 * change to the rollover tail would never reach the grid. It is not sliced;
 * the `days` rule above is unchanged by it.
 *
 * Both bridges store a `reloadWidgets: false` push without redrawing
 * (WidgetBridge.swift, NativeBridge.kt); the flag is absent-means-true so an
 * older native build keeps its old behaviour.
 */

/** Days of `days[]` a widget can be showing without a reload: tomorrow only. */
const HOT_PROJECTED_DAYS = 1;

const stripStamps = (snapshot) => {
  // eslint-disable-next-line no-unused-vars
  const { updatedAt, reloadWidgets, daySummary, ...rest } = snapshot;

  // daySummary.upNext.countdownStartMs is the second wall-clock stamp, and it is
  // easy to miss: buildUpNextFact returns `inProgress ? startMs : nowMs`, so for
  // an UPCOMING entry it is Date.now() and changes on every call. Leaving it in
  // made the fingerprint differ every time and the dedupe inert — the first
  // version of this module shipped that way and changed nothing on device.
  //
  // Excluding it is right, not just expedient. The field feeds SwiftUI's
  // Text(timerInterval:), which animates the countdown itself with no further
  // pushes; re-sending a moved start actually restarts that animation. And when
  // the entry genuinely changes — a boundary crossing flipping inProgress —
  // timeLabel, inProgress and countdownEndMs all change with it, so the push
  // still happens.
  let ds = daySummary;
  if (ds && typeof ds === 'object' && ds.upNext && typeof ds.upNext === 'object') {
    // eslint-disable-next-line no-unused-vars
    const { countdownStartMs, ...upNext } = ds.upNext;
    ds = { ...ds, upNext };
  }
  return { ...rest, daySummary: ds };
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    // A cyclic or otherwise unserialisable snapshot cannot be fingerprinted.
    // Return '' so the caller pushes rather than silently suppressing an update
    // — failing toward "send it" is the safe direction for a widget.
    return '';
  }
};

/**
 * Content fingerprint of a snapshot: its JSON minus the always-changing
 * `updatedAt` stamp (and the push-time `reloadWidgets` flag).
 *
 * Key order is insertion order and the snapshot is built from a single object
 * literal, so stringify is stable across calls and safe to compare directly.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function snapshotFingerprint(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  return safeStringify(stripStamps(snapshot));
}

/**
 * Fingerprint of what a widget can currently be showing: the snapshot with
 * `days` cut to tomorrow and `monthWindow` whole. A change to `days` beyond
 * tomorrow is stored, not redrawn; a change anywhere in the month window is
 * redrawn.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function hotSnapshotFingerprint(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const stripped = stripStamps(snapshot);
  // Only `days` is cut. Every other field — `monthWindow` included, all
  // 49 days of it — stays whole, so any change to it owes a reload.
  if (Array.isArray(stripped.days)) {
    stripped.days = stripped.days.slice(0, HOT_PROJECTED_DAYS);
  }
  return safeStringify(stripped);
}

/**
 * Decides whether this snapshot needs sending, and whether the send should
 * redraw the widgets.
 *
 * An empty fingerprint (unserialisable snapshot) always pushes with a reload:
 * a widget showing stale data is a worse failure than a redundant bridge call.
 *
 * @param {object} snapshot
 * @param {{full: string, hot: string}|string} last  what was last sent — the
 *        object this returns, or (legacy) the full fingerprint string.
 * @returns {{push: boolean, reload: boolean, fingerprint: {full: string, hot: string}}}
 */
export function evaluateSnapshotPush(snapshot, last) {
  const prev = typeof last === 'string' ? { full: last, hot: last } : (last || { full: '', hot: '' });
  const full = snapshotFingerprint(snapshot);
  const hot = hotSnapshotFingerprint(snapshot);
  const fingerprint = { full, hot };
  if (!full) return { push: true, reload: true, fingerprint };
  const push = full !== prev.full;
  // A reload is owed whenever the visible part changed — including the first
  // push, when nothing has been sent yet.
  const reload = push && (!hot || hot !== prev.hot);
  return { push, reload, fingerprint };
}
