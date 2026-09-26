import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, X } from 'lucide-react';
import {
  focusSessionDuration,
  focusSessionLabel,
  selectDoFocusHistorySummary,
} from '../../jobo/focusHistory.js';
import './DoFocusHistory.css';

const FALLBACKS = Object.freeze({
  label: 'Focus sessions',
  close: 'Close focus history',
  unavailable: 'Time unavailable',
  minutes: 'min',
  legacyTotal: 'Focus total',
  legacyNotice: 'Older records do not include specific session times.',
  sessionHint: 'Time ranges may include breaks or pauses.',
});

function translate(t, key, fallback, values) {
  if (typeof t !== 'function') return fallback;
  const value = t(key, { defaultValue: fallback, ...values });
  return value === key || value == null ? fallback : value;
}

function focusCountLabel(t, count) {
  return translate(t, 'jobo.view.focusHistoryCount', `${count} focus sessions`, { count });
}

function minutesValue(value) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

function Positioner({ anchorRef, popoverRef, darkMode, onPositioned, children }) {
  const [position, setPosition] = useState(null);
  const notifiedRef = useRef(false);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover || typeof window === 'undefined') return;
    const anchorBox = anchor.getBoundingClientRect();
    const popoverBox = popover.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const availableWidth = Math.max(0, window.innerWidth - margin * 2);
    const width = Math.min(popoverBox.width || 240, availableWidth);
    let left = anchorBox.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    const height = popoverBox.height || 0;
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    let top = anchorBox.bottom + gap;
    if (top > maxTop) top = anchorBox.top - height - gap;
    top = Math.max(margin, Math.min(top, maxTop));
    setPosition({ left, top, width });
  }, [anchorRef, popoverRef]);

  useEffect(() => {
    const frame = requestAnimationFrame(reposition);
    const schedule = () => requestAnimationFrame(reposition);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [reposition]);

  useLayoutEffect(() => {
    if (position && !notifiedRef.current) {
      notifiedRef.current = true;
      onPositioned?.();
    }
  }, [onPositioned, position]);

  return <div
    ref={popoverRef}
    className={`jobo-s5-focus-history-popover${darkMode ? ' jobo-s5-dark' : ''}`}
    style={position ? { ...position, visibility: 'visible' } : { visibility: 'hidden' }}
  >
    {children}
  </div>;
}

/**
 * Read-only focus history affordance for a single Do occurrence.
 *
 * The parent supplies explicit `focusSessions`; `focusLog` is also accepted
 * so callers can pass the existing store without another adapter.  The
 * selector ignores aggregate day spans unless they carry an exact task/Do
 * identity and occurrence information for recurring tasks.
 */
export default function DoFocusHistory({
  record,
  task,
  focusSessions = null,
  focusLog = null,
  formatTime,
  t,
  darkMode = false,
  className = '',
  defaultOpen = false,
}) {
  const { sessions, legacyMinutes, precise } = selectDoFocusHistorySummary({ record, task, focusSessions, focusLog });
  const hasHistory = precise || Number.isFinite(legacyMinutes);
  const [open, setOpen] = useState(defaultOpen);
  const anchorRef = useRef(null);
  const closeRef = useRef(null);
  const popoverRef = useRef(null);
  const popupId = `jobo-focus-history-${useId().replace(/:/g, '')}`;
  const label = translate(t, 'jobo.view.focusHistory', FALLBACKS.label);
  const closeLabel = translate(t, 'jobo.view.closeFocusHistory', FALLBACKS.close);
  const minuteUnit = translate(t, 'jobo.view.minutesShort', FALLBACKS.minutes);
  const legacyTotal = legacyMinutes == null ? '' : `${minutesValue(legacyMinutes)}${minuteUnit}`;
  const triggerLabel = precise
    ? focusCountLabel(t, sessions.length)
    : translate(t, 'jobo.view.focusLegacyTotal', legacyTotal || FALLBACKS.legacyTotal, { minutes: legacyMinutes });

  const focusClose = useCallback(() => closeRef.current?.focus(), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        anchorRef.current?.focus();
      }
    };
    const onPointerDown = (event) => {
      if (anchorRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return;
      setOpen(false);
      anchorRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (!hasHistory) return null;

  const popup = <Positioner anchorRef={anchorRef} popoverRef={popoverRef} darkMode={darkMode} onPositioned={focusClose}>
    <div className="jobo-s5-focus-history-head">
      <strong>{label}</strong>
      <button
        ref={closeRef}
        type="button"
        className="jobo-s5-focus-history-close"
        aria-label={closeLabel}
        onClick={(event) => { event.stopPropagation(); setOpen(false); anchorRef.current?.focus(); }}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
    {precise ? <>
      <ol className="jobo-s5-focus-history-list">
        {sessions.map((session, index) => {
          const duration = focusSessionDuration(session);
          const durationText = Number.isFinite(duration)
            ? ` · ${minutesValue(duration)}${minuteUnit}`
            : '';
          const text = focusSessionLabel(session, formatTime);
          const timeText = text === 'Time unavailable'
            ? translate(t, 'jobo.view.focusTimeUnavailable', FALLBACKS.unavailable)
            : text;
          return <li key={session.id || `${session.date}-${session.startMinute}-${index}`}>
            {session.date && <time className="jobo-s5-focus-history-date" dateTime={session.date}>{session.date}</time>}
            <span>{timeText}</span>
            {durationText && <small>{durationText}</small>}
          </li>;
        })}
      </ol>
      <p className="jobo-s5-focus-history-note">
        {translate(t, 'jobo.view.focusSessionHint', FALLBACKS.sessionHint)}
      </p>
    </> : <>
      <p className="jobo-s5-focus-history-legacy-total">{legacyTotal}</p>
      <p className="jobo-s5-focus-history-legacy-note">
        {translate(t, 'jobo.view.focusLegacyNotice', FALLBACKS.legacyNotice)}
      </p>
    </>}
  </Positioner>;

  return <span className={`jobo-s5-focus-history ${className}`.trim()} data-jobo-focus-history="true">
    <button
      ref={anchorRef}
      type="button"
      className="jobo-s5-focus-history-trigger"
      aria-label={triggerLabel}
      aria-expanded={open}
      aria-controls={popupId}
      aria-haspopup="dialog"
      title={triggerLabel}
      onClick={(event) => { event.stopPropagation(); setOpen(value => !value); }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <AlarmClock size={12} aria-hidden="true" />
      <span aria-hidden="true" data-jobo-focus-count="true">{precise ? sessions.length : legacyTotal}</span>
    </button>
    {open && (typeof document !== 'undefined' && document.body
      ? createPortal(<div id={popupId} role="dialog" aria-label={label}>{popup}</div>, document.body)
      : <div id={popupId} role="dialog" aria-label={label}>{popup}</div>)}
  </span>;
}
