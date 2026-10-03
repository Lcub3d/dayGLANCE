import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { formatDuration } from '../../utils/formatDuration.js';
import { DO_STRIPES } from './PastDoCard.jsx';

// A SCHED card's Do badge: the timed Do recorded against this task on its
// date (App's getDoSessionsForTask, from the past-day index in
// src/jobo/pastDay.js), so SCHED, an agenda of what was planned, can still
// say what was done. A striped pill in the task's colour, the Do look in
// every view, showing the time recorded; a click opens each session and the
// way to JOBO. Read-only: the Do are edited in JOBO.
//
// It renders nothing without timed Do: with JOBO off, for a task with none,
// or for one completed without times, whose checkbox already says it was
// done.

const clock = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const sessionsTotal = (sessions) => sessions.reduce((sum, s) => sum + (s.endMinute - s.startMinute), 0);

/** The popover body, exported so a test can render it open. */
export function DoSessionsPanel({ sessions, formatTime = (v) => v, onOpenJobo }) {
  const { t } = useTranslation();
  const progress = (value) => (value === 'completed' ? t('common.completed') : t(`jobo.view.progress.${value}`));
  return (
    <>
      <div className="opacity-60 mb-1">{t('jobo.sched.heading')}</div>
      <div className="space-y-0.5">
        {sessions.map((s) => (
          <div key={`${s.recordId}-${s.startMinute}`} data-do-session={s.recordId} className="flex items-center gap-1.5 whitespace-nowrap">
            {/* A session cut at midnight runs on from, or into, the next day. */}
            <span className="font-semibold">
              {s.clippedStart ? '…' : ''}{formatTime(clock(s.startMinute))}–{formatTime(clock(s.endMinute))}{s.clippedEnd ? '…' : ''}
            </span>
            <span className="opacity-40">·</span>
            <span className="opacity-80">{progress(s.progress)}</span>
          </div>
        ))}
      </div>
      {sessions.length > 1 && (
        <div className="opacity-60 mt-1.5">{t('jobo.sched.total', { duration: formatDuration(sessionsTotal(sessions), t) })}</div>
      )}
      {onOpenJobo && (
        <button
          type="button"
          data-do-open-jobo
          onClick={(e) => { e.stopPropagation(); onOpenJobo(); }}
          className="mt-2 px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 font-medium"
        >
          {t('jobo.past.open')}
        </button>
      )}
    </>
  );
}

// `placement`: a card puts the badge in two places and each draws only on
// its kind of screen. On a phone, a card's details row has no room to spare
// (Lcub3d on #1726: at 360px a busy row already fills it), so the badge is a
// striped dot at the end of the title line, where the title gives way to it
// by truncating. Elsewhere it is the pill with the time, in the details row.
export default function DoSessionsBadge({ task, pad = 'p-0.5', placement = 'meta' }) {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx() || {};
  const { getDoSessionsForTask, formatTime, isMobile, setViewMode, setSelectedDate } = ctx;
  const sessions = typeof getDoSessionsForTask === 'function' ? getDoSessionsForTask(task) : [];
  const [open, setOpen] = useState(false);
  // Fixed coordinates, measured from the badge, and drawn at the document's
  // root: inside the card the panel took the dimming of a completed card and
  // sat under the next card, which a fixed position does not escape. Above
  // the PLANNER (z-70), whose Scheduled column shows these cards, and MONTH's
  // day sheet (z-45); below the task editor (z-80).
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);
  const PANEL_WIDTH = 220;

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onPointerDown = (e) => {
      if (!ref.current?.contains(e.target) && !panelRef.current?.contains(e.target)) close();
    };
    // Escape closes the panel and nothing behind it (MONTH's day sheet skips
    // a key whose default was prevented).
    const onKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!sessions.length) return null;
  if ((placement === 'title') !== !!isMobile) return null;
  const total = formatDuration(sessionsTotal(sessions), t);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8)) });
    setOpen(true);
  };
  // JOBO has no phone layout until slice 8, so the phone gets the sessions
  // without the way there.
  const openJobo = !isMobile && typeof setViewMode === 'function'
    ? () => { setOpen(false); setSelectedDate?.(new Date(`${task.date}T12:00:00`)); setViewMode('jobo'); }
    : null;

  return (
    <span ref={ref} className={`relative flex-shrink-0 inline-flex ${pad}`}>
      <button
        ref={buttonRef}
        type="button"
        data-do-badge={task.id}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        aria-expanded={open}
        aria-label={t('jobo.sched.badge', { count: sessions.length, duration: total })}
        title={t('jobo.sched.badge', { count: sessions.length, duration: total })}
        className={`${task.color || 'bg-gray-500'} text-white text-[11px] font-semibold leading-none rounded-full hover:brightness-110 ${isMobile ? 'w-3.5 h-3.5' : 'px-1.5 py-1'}`}
        style={{ backgroundImage: DO_STRIPES }}
      >
        {isMobile ? null : total}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          data-do-sessions-panel
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_WIDTH }}
          className="z-[75] rounded-lg shadow-xl border p-2 text-xs
                     bg-white dark:bg-gray-800 text-gray-800 dark:text-white
                     border-stone-300 dark:border-gray-700"
        >
          <DoSessionsPanel sessions={sessions} formatTime={formatTime || ((v) => v)} onOpenJobo={openJobo} />
        </div>,
        document.body,
      )}
    </span>
  );
}
