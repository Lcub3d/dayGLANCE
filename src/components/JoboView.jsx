import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, FileText, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { formatDuration } from '../utils/formatDuration.js';
import {
  DO_PROGRESS,
  DO_TIMING,
  reassessDoProgress,
  updateDoRecord,
} from '../jobo/core.js';
import { buildJoboDayModel } from '../jobo/viewModel.js';
import './jobo/JoboView.css';

const DEFAULT_SCALE = 84;
const MIN_SCALE = 52;
const MAX_SCALE = 132;

const SUMMARY_CLASS = {
  withinPlan: 'jobo-s5-badge-ok',
  late: 'jobo-s5-badge-warn',
  longer: 'jobo-s5-badge-warn',
  split: 'jobo-s5-badge-info',
  notStarted: 'jobo-s5-badge-danger',
  unplanned: 'jobo-s5-badge-unplanned',
};

const PROGRESS_CLASS = {
  started: 'jobo-s5-progress-started',
  partial: 'jobo-s5-progress-partial',
  mostly: 'jobo-s5-progress-mostly',
  completed: 'jobo-s5-progress-completed',
};

function two(value) {
  return String(value).padStart(2, '0');
}

function localTime(date) {
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function clockFromMinute(value) {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${two(Math.floor(minute / 60))}:${two(minute % 60)}`;
}

function linkKeyForTask(task) {
  if (!task) return null;
  if (task.recurringTemplateId != null) return String(task.recurringTemplateId);
  return task.id == null ? null : String(task.id);
}

function linkKeyForRecord(record) {
  return record?.taskId == null ? null : String(record.taskId);
}

function cardStyle(item, scale, startHour) {
  return {
    top: `${((item.startMinute - startHour * 60) / 60) * scale}px`,
    height: `${Math.max(40, ((item.endMinute - item.startMinute) / 60) * scale - 2)}px`,
    left: `calc(${item.leftPct}% + 3px)`,
    width: `calc(${item.widthPct}% - 6px)`,
  };
}

function SummaryBadges({ labels, t }) {
  if (!labels?.length) return null;
  return (
    <span className="jobo-s5-badges">
      {labels.map((label) => (
        <span key={label} className={`jobo-s5-badge ${SUMMARY_CLASS[label] || ''}`}>
          {t(`jobo.view.summary.${label}`)}
        </span>
      ))}
    </span>
  );
}

function ProgressBadge({ progress, t }) {
  const label = progress === DO_PROGRESS.COMPLETED
    ? t('common.completed')
    : t(`jobo.view.progress.${progress}`);
  return (
    <span className={`jobo-s5-progress ${PROGRESS_CLASS[progress] || ''}`}>
      {label}
    </span>
  );
}

function PlanCard({ item, scale, startHour, formatTime, t, onFocus }) {
  const { task, plan, labels } = item;
  const linkKey = linkKeyForTask(task);
  const end = clockFromMinute(item.endMinute);
  return (
    <article
      className={`jobo-s5-card jobo-s5-plan-card shadow-md text-white rounded-lg ${task.color || 'bg-blue-500'}`}
      style={cardStyle(item, scale, startHour)}
      data-jobo-plan-link={linkKey || ''}
      onMouseEnter={() => linkKey && onFocus(linkKey)}
      onMouseLeave={() => onFocus(null)}
    >
      <div className="jobo-s5-title-row">
        <div className="jobo-s5-title" title={task.title}>{task.title}</div>
        {String(task.notes || '').trim() && <FileText size={12} className="jobo-s5-note-icon" aria-hidden="true" />}
      </div>
      <div className="jobo-s5-meta-row">
        <span className="jobo-s5-time">{formatTime(plan.startTime)}–{formatTime(end)}</span>
        <span className="jobo-s5-duration">{formatDuration(plan.duration, t)}</span>
        <SummaryBadges labels={labels} t={t} />
      </div>
    </article>
  );
}

function DoCard({ item, scale, startHour, formatTime, t, writable, onEdit, onFocus }) {
  const { record, task, labels } = item;
  const linkKey = linkKeyForRecord(record);
  const isLinked = !!linkKey;
  return (
    <article
      className={`jobo-s5-card jobo-s5-do-card shadow-md text-white rounded-lg ${task?.color || 'bg-purple-500'}`}
      style={cardStyle(item, scale, startHour)}
      data-jobo-do-link={linkKey || ''}
      onMouseEnter={() => linkKey && onFocus(linkKey)}
      onMouseLeave={() => onFocus(null)}
      onDoubleClick={() => writable && onEdit(record)}
    >
      <div className="jobo-s5-title-row">
        <div className="jobo-s5-title" title={record.title}>{record.title}</div>
        <button
          type="button"
          className="jobo-s5-card-action"
          onClick={() => onEdit(record)}
          disabled={!writable}
          title={t('common.edit')}
          aria-label={t('common.edit')}
        >
          <Pencil size={12} />
        </button>
      </div>
      <div className="jobo-s5-meta-row">
        <span className="jobo-s5-time">{formatTime(record.startTime)}–{formatTime(record.endTime)}</span>
        <ProgressBadge progress={record.progress} t={t} />
        {!isLinked && <SummaryBadges labels={labels} t={t} />}
      </div>
    </article>
  );
}

function NotesColumn({ tasks, dailyText, date, cardBg, borderClass, textPrimary, textSecondary, t, onFocus }) {
  const items = [];
  const seen = new Set();
  for (const task of tasks) {
    const text = String(task?.notes || '').trim();
    const linkKey = linkKeyForTask(task);
    if (!text || !linkKey || seen.has(linkKey)) continue;
    seen.add(linkKey);
    items.push({ task, text, linkKey });
  }

  return (
    <aside className={`jobo-s5-notes-column border-l ${borderClass}`} data-jobo-notes>
      {!items.length && !String(dailyText || '').trim() && (
        <div className={`jobo-s5-empty-notes ${textSecondary}`}>{t('common.empty')}</div>
      )}
      {items.map(({ task, text, linkKey }) => (
        <section
          key={linkKey}
          className={`jobo-s5-note-tile shadow-md rounded-lg border ${borderClass} ${task.color || 'bg-blue-500'} text-white`}
          data-jobo-note-link={linkKey}
          onMouseEnter={() => onFocus(linkKey)}
          onMouseLeave={() => onFocus(null)}
        >
          <div className="jobo-s5-note-title">
            <FileText size={12} />
            <b title={task.title}>{task.title}</b>
          </div>
          <div className="jobo-s5-note-text">{text}</div>
        </section>
      ))}
      {String(dailyText || '').trim() && (
        <section className={`jobo-s5-note-tile jobo-s5-daily-note rounded-lg border ${borderClass} ${cardBg} ${textPrimary}`}>
          <div className="jobo-s5-note-title">
            <FileText size={12} />
            <b>{t('common.dailyNote')}</b>
          </div>
          <div className="jobo-s5-note-text">{dailyText}</div>
          <div className={`jobo-s5-note-date ${textSecondary}`}>{date}</div>
        </section>
      )}
    </aside>
  );
}

function UntimedStrip({ records, t, writable, onEdit, onFocus }) {
  if (!records.length) return null;
  return (
    <div className="jobo-s5-untimed-row">
      <div />
      <div className="jobo-s5-untimed-ruler">
        <Clock size={11} />
      </div>
      <div className="jobo-s5-untimed-cell">
        <span className="jobo-s5-untimed-label">{t('jobo.view.untimed')}</span>
        <div className="jobo-s5-untimed-list">
          {records.map(({ record, task, labels }) => {
            const linkKey = linkKeyForRecord(record);
            return (
              <button
                key={record.id}
                type="button"
                className={`jobo-s5-untimed-card shadow-sm ${task?.color || 'bg-purple-500'} text-white`}
                onClick={() => writable && onEdit(record)}
                onMouseEnter={() => linkKey && onFocus(linkKey)}
                onMouseLeave={() => onFocus(null)}
                disabled={!writable}
              >
                <span className="jobo-s5-untimed-title">{record.title}</span>
                <ProgressBadge progress={record.progress} t={t} />
                {!linkKey && <SummaryBadges labels={labels} t={t} />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="jobo-s5-untimed-notes-spacer" />
    </div>
  );
}

function Connections({ rootRef, focusKey, dep }) {
  const [paths, setPaths] = useState([]);

  useLayoutEffect(() => {
    let raf;
    const update = () => {
      const root = rootRef.current;
      if (!root || !focusKey) {
        setPaths([]);
        return;
      }

      const rootBox = root.getBoundingClientRect();
      const plan = [...root.querySelectorAll('[data-jobo-plan-link]')]
        .find((el) => el.dataset.joboPlanLink === focusKey);
      const dos = [...root.querySelectorAll('[data-jobo-do-link]')]
        .filter((el) => el.dataset.joboDoLink === focusKey);
      const note = [...root.querySelectorAll('[data-jobo-note-link]')]
        .find((el) => el.dataset.joboNoteLink === focusKey);

      const out = [];
      const connect = (from, to, key, opacity = 0.62) => {
        if (!from || !to) return;
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.right - rootBox.left;
        const y1 = a.top + Math.min(a.height / 2, 23) - rootBox.top;
        const x2 = b.left - rootBox.left;
        const y2 = b.top + Math.min(b.height / 2, 23) - rootBox.top;
        const bend = Math.max(18, Math.min(42, (x2 - x1) / 3));
        out.push({
          key,
          d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`,
          color: getComputedStyle(from).backgroundColor,
          opacity,
        });
      };

      for (const item of dos) connect(plan, item, `pd:${item.dataset.joboDoLink}:${out.length}`);
      if (note) {
        if (dos.length) {
          for (const item of dos) connect(item, note, `dn:${out.length}`, 0.45);
        } else {
          connect(plan, note, 'pn', 0.45);
        }
      }
      setPaths(out);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    schedule();

    const observer = new ResizeObserver(schedule);
    if (rootRef.current) observer.observe(rootRef.current);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [rootRef, focusKey, dep]);

  return (
    <svg className="jobo-s5-connections" aria-hidden="true">
      {paths.map((path) => (
        <path
          key={path.key}
          d={path.d}
          fill="none"
          stroke={path.color}
          strokeWidth="1.4"
          opacity={path.opacity}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function EditDoDialog({ record, writable, recordJobo, onClose, t, darkMode, cardBg, textPrimary, borderClass }) {
  const [draft, setDraft] = useState(() => ({
    timing: record.timing,
    date: record.date,
    startTime: record.startTime || '',
    endDate: record.endDate || record.date,
    endTime: record.endTime || '',
    progress: record.progress,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const progressOptions = record.progress === DO_PROGRESS.COMPLETED
    ? [DO_PROGRESS.COMPLETED, DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY]
    : [DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY];

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!writable) {
      setError(t('jobo.view.readOnly'));
      return;
    }
    if (draft.timing === DO_TIMING.TIMED && (!draft.date || !draft.startTime || !draft.endDate || !draft.endTime)) {
      setError(t('jobo.view.completeInterval'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const nowMs = Date.now();
      const previousMs = Date.parse(record.updatedAt);
      if (Number.isFinite(previousMs) && nowMs <= previousMs) throw new Error(t('jobo.view.editClock'));

      const patch = draft.timing === DO_TIMING.TIMED
        ? {
            timing: DO_TIMING.TIMED,
            date: draft.date,
            startTime: draft.startTime,
            endDate: draft.endDate,
            endTime: draft.endTime,
          }
        : {
            timing: DO_TIMING.UNTIMED,
            date: draft.date,
            startTime: null,
            endDate: null,
            endTime: null,
          };

      const intervalChanged = Object.entries(patch).some(([key, value]) => record[key] !== value);
      let next = record;
      let stampMs = nowMs;
      if (intervalChanged) next = updateDoRecord(next, patch, new Date(stampMs).toISOString());

      if (draft.progress !== next.progress) {
        if (draft.progress === DO_PROGRESS.COMPLETED) throw new Error(t('jobo.view.completedByCompletion'));
        stampMs += intervalChanged ? 1 : 0;
        next = reassessDoProgress(next, draft.progress, new Date(stampMs).toISOString());
      }

      if (next !== record) {
        const result = await recordJobo([next]);
        if (!result?.ok) throw new Error(result?.error || t('jobo.view.updateFailed'));
      }
      onClose();
    } catch (err) {
      setError(err?.message || t('jobo.view.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="jobo-s5-modal-mask" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className={`jobo-s5-dialog ${cardBg} ${textPrimary} border ${borderClass} ${darkMode ? 'jobo-s5-dialog-dark' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('common.edit')}
      >
        <div className="jobo-s5-dialog-head">
          <div>
            <div className="jobo-s5-dialog-title">{record.title}</div>
            <div className="jobo-s5-dialog-subtitle">{t('common.edit')}</div>
          </div>
          <button type="button" className="jobo-s5-close-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={17} />
          </button>
        </div>

        <label className="jobo-s5-field">
          <span>{t('task.time')}</span>
          <select value={draft.timing} onChange={(event) => setDraft((prev) => ({ ...prev, timing: event.target.value }))}>
            <option value={DO_TIMING.TIMED}>{t('jobo.view.timed')}</option>
            <option value={DO_TIMING.UNTIMED}>{t('jobo.view.untimed')}</option>
          </select>
        </label>

        <div className="jobo-s5-edit-grid">
          <label className="jobo-s5-field">
            <span>{t('common.date')}</span>
            <input type="date" value={draft.date} onChange={(event) => setDraft((prev) => ({ ...prev, date: event.target.value }))} />
          </label>
          {draft.timing === DO_TIMING.TIMED && (
            <>
              <label className="jobo-s5-field">
                <span>{t('common.start')}</span>
                <input type="time" value={draft.startTime} onChange={(event) => setDraft((prev) => ({ ...prev, startTime: event.target.value }))} />
              </label>
              <label className="jobo-s5-field">
                <span>{t('common.date')}</span>
                <input type="date" value={draft.endDate} onChange={(event) => setDraft((prev) => ({ ...prev, endDate: event.target.value }))} />
              </label>
              <label className="jobo-s5-field">
                <span>{t('common.end')}</span>
                <input type="time" value={draft.endTime} onChange={(event) => setDraft((prev) => ({ ...prev, endTime: event.target.value }))} />
              </label>
            </>
          )}
        </div>

        <label className="jobo-s5-field">
          <span>{t('jobo.view.progressLabel')}</span>
          <select value={draft.progress} onChange={(event) => setDraft((prev) => ({ ...prev, progress: event.target.value }))}>
            {progressOptions.map((progress) => (
              <option key={progress} value={progress}>
                {progress === DO_PROGRESS.COMPLETED ? t('common.completed') : t(`jobo.view.progress.${progress}`)}
              </option>
            ))}
          </select>
        </label>

        {record.progress !== DO_PROGRESS.COMPLETED && (
          <p className="jobo-s5-dialog-note">{t('jobo.view.completedByCompletion')}</p>
        )}
        {error && <p className="jobo-s5-dialog-error">{error}</p>}

        <div className="jobo-s5-dialog-actions">
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="jobo-s5-save-button" onClick={save} disabled={saving || !writable}>
            {t('common.save')}
          </button>
        </div>
      </section>
    </div>
  );
}

// Slice 5 remains a view over the settled Slice 2/3 contracts. The visual
// language intentionally follows the prototype: Plan | ruler | Do | Notes,
// compact native-colour cards, independent notes tiles and hover connections.
// Only the visuals are carried forward; the prototype's store/model are not.
export default function JoboView() {
  const { t } = useTranslation();
  const {
    selectedDate,
    tasks,
    unscheduledTasks,
    expandedRecurringTasks,
    getTasksForDate,
    formatTime,
    currentTime,
    dailyNotes,
    darkMode,
    cardBg,
    borderClass,
    textPrimary,
    textSecondary,
  } = useDayPlannerCtx();
  const {
    joboRecords,
    joboLoaded,
    joboWritable,
    joboError,
    recordJobo,
  } = useFeaturesCtx();

  const [editingRecord, setEditingRecord] = useState(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [focusKey, setFocusKey] = useState(null);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);

  const date = dateToString(selectedDate);
  const clock = useMemo(() => (currentTime instanceof Date ? currentTime : new Date()), [currentTime]);
  const today = dateToString(clock);

  const dayTasks = useMemo(
    () => getTasksForDate(selectedDate).filter((task) => !task.isAllDay && task.startTime),
    [getTasksForDate, selectedDate],
  );
  const lookupTasks = useMemo(
    () => [...tasks, ...unscheduledTasks, ...(expandedRecurringTasks || []), ...dayTasks],
    [tasks, unscheduledTasks, expandedRecurringTasks, dayTasks],
  );

  const model = useMemo(() => buildJoboDayModel({
    date,
    tasks: dayTasks,
    taskLookup: lookupTasks,
    records: joboRecords || [],
    now: date === today ? { date: today, time: localTime(clock) } : undefined,
  }), [date, dayTasks, lookupTasks, joboRecords, today, clock]);

  const timedStarts = [
    ...model.plans.map((item) => item.startMinute),
    ...model.timedRecords.map((item) => item.startMinute),
  ].filter(Number.isFinite);
  const earliest = timedStarts.length ? Math.min(...timedStarts) : 8 * 60;
  const startHour = Math.max(0, Math.floor(Math.min(8 * 60, earliest) / 60));
  const hourCount = 24 - startHour;
  const height = hourCount * scale;
  const hours = useMemo(
    () => Array.from({ length: hourCount }, (_, index) => startHour + index),
    [hourCount, startHour],
  );

  const nowMinute = date === today ? clock.getHours() * 60 + clock.getMinutes() : null;
  const nowTop = nowMinute != null && nowMinute >= startHour * 60
    ? ((nowMinute - startHour * 60) / 60) * scale
    : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setScale((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value + (event.deltaY < 0 ? 4 : -4))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (!joboLoaded) {
    return (
      <div data-jobo-view className="h-full flex items-center justify-center p-8">
        <p className={`text-sm ${textSecondary}`}>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div data-jobo-view className={`jobo-s5-root ${darkMode ? 'jobo-s5-dark' : ''} ${textPrimary}`}>
      <div className={`jobo-s5-column-head border-b ${borderClass} ${cardBg}`}>
        <div className="jobo-s5-head-cell"><b>{t('jobo.view.plan')}</b></div>
        <div />
        <div className="jobo-s5-head-cell"><b>{t('jobo.view.do')}</b></div>
        <div className="jobo-s5-head-cell jobo-s5-head-notes">
          <b>{t('task.notes')}</b>
          <div className="jobo-s5-tools" aria-label={t('common.settings')}>
            <button type="button" onClick={() => setScale((value) => Math.max(MIN_SCALE, value - 8))}>−</button>
            <button type="button" onClick={() => setScale(DEFAULT_SCALE)}>{Math.round((scale / DEFAULT_SCALE) * 100)}%</button>
            <button type="button" onClick={() => setScale((value) => Math.min(MAX_SCALE, value + 8))}>＋</button>
          </div>
        </div>
      </div>

      {(joboError || !joboWritable || model.invalidRecordCount > 0) && (
        <div className={`jobo-s5-notice border-b ${borderClass} ${textSecondary}`}>
          <AlertTriangle size={13} />
          {joboError
            ? t('jobo.view.storageError')
            : !joboWritable
              ? t('jobo.view.readOnly')
              : t('jobo.view.invalidRecords', { count: model.invalidRecordCount })}
        </div>
      )}

      <UntimedStrip
        records={model.untimedRecords}
        t={t}
        writable={joboWritable}
        onEdit={setEditingRecord}
        onFocus={setFocusKey}
      />

      <div ref={scrollRef} className={`jobo-s5-scroll ${darkMode ? 'dark-scrollbar' : ''}`}>
        <div ref={rootRef} className="jobo-s5-day-grid" style={{ minHeight: `${height}px` }}>
          <div className="jobo-s5-time-lane" data-jobo-lane="plan">
            {hours.map((hour, index) => (
              <div
                key={hour}
                className={`jobo-s5-hour border-b ${borderClass} ${index % 2 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`}
                style={{ height: `${scale}px` }}
              >
                <div className={`jobo-s5-half border-b border-dashed ${borderClass}`} />
              </div>
            ))}
            {model.plans.map((item) => (
              <PlanCard
                key={item.id}
                item={item}
                scale={scale}
                startHour={startHour}
                formatTime={formatTime}
                t={t}
                onFocus={setFocusKey}
              />
            ))}
            {!model.plans.length && (
              <div className={`jobo-s5-empty-lane ${textSecondary}`}>{t('jobo.view.emptyPlan')}</div>
            )}
          </div>

          <div className={`jobo-s5-time-ruler border-l border-r ${borderClass} ${cardBg}`}>
            {hours.map((hour) => (
              <div
                key={hour}
                className={`jobo-s5-ruler-hour border-b ${borderClass} ${textSecondary}`}
                style={{ height: `${scale}px` }}
              >
                {formatTime(`${two(hour)}:00`)}
              </div>
            ))}
          </div>

          <div className={`jobo-s5-time-lane jobo-s5-do-lane border-r ${borderClass}`} data-jobo-lane="do">
            {hours.map((hour, index) => (
              <div
                key={hour}
                className={`jobo-s5-hour border-b ${borderClass} ${index % 2 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`}
                style={{ height: `${scale}px` }}
              >
                <div className={`jobo-s5-half border-b border-dashed ${borderClass}`} />
              </div>
            ))}
            {model.timedRecords.map((item) => (
              <DoCard
                key={item.id}
                item={item}
                scale={scale}
                startHour={startHour}
                formatTime={formatTime}
                t={t}
                writable={joboWritable}
                onEdit={setEditingRecord}
                onFocus={setFocusKey}
              />
            ))}
            {!model.timedRecords.length && !model.untimedRecords.length && (
              <div className={`jobo-s5-empty-lane ${textSecondary}`}>{t('jobo.view.emptyDo')}</div>
            )}
          </div>

          <NotesColumn
            tasks={dayTasks}
            dailyText={dailyNotes?.[date]?.text || ''}
            date={date}
            cardBg={cardBg}
            borderClass={borderClass}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            t={t}
            onFocus={setFocusKey}
          />

          <Connections rootRef={rootRef} focusKey={focusKey} dep={scale} />

          {nowTop != null && (
            <div className="jobo-s5-now-line" data-jobo-now style={{ top: `${nowTop}px` }} aria-hidden="true" />
          )}
        </div>
      </div>

      {editingRecord && (
        <EditDoDialog
          record={editingRecord}
          writable={joboWritable}
          recordJobo={recordJobo}
          onClose={() => setEditingRecord(null)}
          t={t}
          darkMode={darkMode}
          cardBg={cardBg}
          textPrimary={textPrimary}
          borderClass={borderClass}
        />
      )}
    </div>
  );
}
