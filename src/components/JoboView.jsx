import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, Pencil, X } from 'lucide-react';
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
import { buildJoboDayModel, DAY_MINUTES } from '../jobo/viewModel.js';
import './jobo/JoboView.css';

const HOUR_HEIGHT = 64;

const SUMMARY_CLASS = {
  withinPlan: 'jobo5-badge-ok',
  late: 'jobo5-badge-warn',
  longer: 'jobo5-badge-warn',
  split: 'jobo5-badge-info',
  notStarted: 'jobo5-badge-danger',
  unplanned: 'jobo5-badge-unplanned',
};

const PROGRESS_CLASS = {
  started: 'jobo5-progress-started',
  partial: 'jobo5-progress-partial',
  mostly: 'jobo5-progress-mostly',
  completed: 'jobo5-progress-completed',
};

function two(value) {
  return String(value).padStart(2, '0');
}

function localTime(date) {
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function cardStyle(item) {
  return {
    top: `${(item.startMinute / 60) * HOUR_HEIGHT}px`,
    height: `${Math.max(42, ((item.endMinute - item.startMinute) / 60) * HOUR_HEIGHT)}px`,
    left: `calc(${item.leftPct}% + 4px)`,
    width: `calc(${item.widthPct}% - 8px)`,
  };
}

function SummaryBadges({ labels, t }) {
  if (!labels?.length) return null;
  return (
    <span className="jobo5-badges">
      {labels.map((label) => (
        <span key={label} className={`jobo5-badge ${SUMMARY_CLASS[label] || ''}`}>
          {t(`jobo.view.summary.${label}`)}
        </span>
      ))}
    </span>
  );
}

function ProgressBadge({ progress, t }) {
  return (
    <span className={`jobo5-progress ${PROGRESS_CLASS[progress] || ''}`}>
      {t(`jobo.view.progress.${progress}`)}
    </span>
  );
}

function PlanCard({ item, formatTime, t }) {
  const { task, plan, labels } = item;
  const color = task.color || 'bg-blue-500';
  return (
    <article
      className={`jobo5-card jobo5-plan-card ${color} text-white`}
      style={cardStyle(item)}
      data-jobo-plan={String(task.id)}
    >
      <div className="jobo5-card-title">{task.title}</div>
      <div className="jobo5-card-meta">
        <span>{formatTime(plan.startTime)}</span>
        <span>·</span>
        <span>{formatDuration(plan.duration, t)}</span>
      </div>
      <SummaryBadges labels={labels} t={t} />
    </article>
  );
}

function DoCard({ item, formatTime, t, writable, onEdit }) {
  const { record, task, labels } = item;
  const color = task?.color || 'bg-slate-600';
  return (
    <article
      className={`jobo5-card jobo5-do-card ${color} text-white`}
      style={cardStyle(item)}
      data-jobo-do={record.id}
    >
      <div className="jobo5-card-title-row">
        <div className="jobo5-card-title">{record.title}</div>
        <button
          type="button"
          className="jobo5-edit-button"
          onClick={() => onEdit(record)}
          disabled={!writable}
          title={t('jobo.view.editDo')}
          aria-label={t('jobo.view.editDo')}
        >
          <Pencil size={12} />
        </button>
      </div>
      <div className="jobo5-card-meta">
        <span>{formatTime(record.startTime)}</span>
        <span>–</span>
        <span>{formatTime(record.endTime)}</span>
      </div>
      <div className="jobo5-card-footer">
        <ProgressBadge progress={record.progress} t={t} />
        <SummaryBadges labels={labels} t={t} />
      </div>
    </article>
  );
}

function UntimedShelf({ records, t, writable, onEdit }) {
  if (!records.length) return null;
  return (
    <div className="jobo5-untimed-row">
      <div className="jobo5-untimed-spacer" />
      <div className="jobo5-untimed-label">
        <Clock size={12} />
        {t('jobo.view.untimed')}
      </div>
      <div className="jobo5-untimed-list">
        {records.map(({ record, task, labels }) => (
          <button
            key={record.id}
            type="button"
            className={`jobo5-untimed-card ${task?.color || 'bg-slate-600'} text-white`}
            onClick={() => onEdit(record)}
            disabled={!writable}
          >
            <span className="jobo5-untimed-title">{record.title}</span>
            <ProgressBadge progress={record.progress} t={t} />
            <SummaryBadges labels={labels} t={t} />
            <span className="jobo5-untimed-hint">{t('jobo.view.timeNotRecorded')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EditDoDialog({ record, writable, recordJobo, onClose, t, darkMode }) {
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
      if (Number.isFinite(previousMs) && nowMs <= previousMs) {
        throw new Error(t('jobo.view.editClock'));
      }

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
      if (intervalChanged) {
        next = updateDoRecord(next, patch, new Date(stampMs).toISOString());
      }

      if (draft.progress !== next.progress) {
        if (draft.progress === DO_PROGRESS.COMPLETED) {
          throw new Error(t('jobo.view.completedByCompletion'));
        }
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
    <div className="jobo5-modal-mask" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <section className={`jobo5-dialog ${darkMode ? 'jobo5-dialog-dark' : ''}`} role="dialog" aria-modal="true" aria-label={t('jobo.view.editDo')}>
        <div className="jobo5-dialog-head">
          <div>
            <div className="jobo5-dialog-title">{record.title}</div>
            <div className="jobo5-dialog-subtitle">{t('jobo.view.editDo')}</div>
          </div>
          <button type="button" className="jobo5-close-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        <label className="jobo5-field">
          <span>{t('jobo.view.timing')}</span>
          <select
            value={draft.timing}
            onChange={(e) => setDraft((prev) => ({ ...prev, timing: e.target.value }))}
          >
            <option value={DO_TIMING.TIMED}>{t('jobo.view.timed')}</option>
            <option value={DO_TIMING.UNTIMED}>{t('jobo.view.untimed')}</option>
          </select>
        </label>

        <div className="jobo5-edit-grid">
          <label className="jobo5-field">
            <span>{t('jobo.view.date')}</span>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value }))}
            />
          </label>
          {draft.timing === DO_TIMING.TIMED && (
            <>
              <label className="jobo5-field">
                <span>{t('jobo.view.start')}</span>
                <input
                  type="time"
                  value={draft.startTime}
                  onChange={(e) => setDraft((prev) => ({ ...prev, startTime: e.target.value }))}
                />
              </label>
              <label className="jobo5-field">
                <span>{t('jobo.view.endDate')}</span>
                <input
                  type="date"
                  value={draft.endDate}
                  onChange={(e) => setDraft((prev) => ({ ...prev, endDate: e.target.value }))}
                />
              </label>
              <label className="jobo5-field">
                <span>{t('jobo.view.end')}</span>
                <input
                  type="time"
                  value={draft.endTime}
                  onChange={(e) => setDraft((prev) => ({ ...prev, endTime: e.target.value }))}
                />
              </label>
            </>
          )}
        </div>

        <label className="jobo5-field">
          <span>{t('jobo.view.progressLabel')}</span>
          <select
            value={draft.progress}
            onChange={(e) => setDraft((prev) => ({ ...prev, progress: e.target.value }))}
          >
            {progressOptions.map((progress) => (
              <option key={progress} value={progress}>{t(`jobo.view.progress.${progress}`)}</option>
            ))}
          </select>
        </label>

        {record.progress !== DO_PROGRESS.COMPLETED && (
          <p className="jobo5-dialog-note">{t('jobo.view.completedByCompletion')}</p>
        )}

        {error && <p className="jobo5-dialog-error">{error}</p>}

        <div className="jobo5-dialog-actions">
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="jobo5-save-button" onClick={save} disabled={saving || !writable}>
            {saving ? t('jobo.view.saving') : t('common.save')}
          </button>
        </div>
      </section>
    </div>
  );
}

// Slice 5 is deliberately a view over the contracts already landed in slices
// 2 and 3. It derives timing labels from core and writes every Do edit through
// recordJobo; it owns no second ledger, task mutation or day-level Check state.
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
    darkMode,
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
  const scrollRef = useRef(null);
  const lastAutoScrollDate = useRef(null);
  const date = dateToString(selectedDate);
  const clock = currentTime instanceof Date ? currentTime : new Date();
  const today = dateToString(clock);

  const dayTasks = useMemo(
    () => getTasksForDate(selectedDate).filter((task) => !task.isAllDay && task.startTime),
    [getTasksForDate, selectedDate],
  );
  const lookupTasks = useMemo(
    () => [...tasks, ...unscheduledTasks, ...(expandedRecurringTasks || [])],
    [tasks, unscheduledTasks, expandedRecurringTasks],
  );

  const model = useMemo(() => buildJoboDayModel({
    date,
    tasks: dayTasks,
    taskLookup: lookupTasks,
    records: joboRecords || [],
    now: date === today ? { date: today, time: localTime(clock) } : undefined,
  }), [date, dayTasks, lookupTasks, joboRecords, today, clock]);

  const hourLabels = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);
  const nowMinute = date === today ? clock.getHours() * 60 + clock.getMinutes() : null;
  const nowTop = nowMinute == null ? null : (nowMinute / 60) * HOUR_HEIGHT;

  useEffect(() => {
    if (!joboLoaded || !scrollRef.current || lastAutoScrollDate.current === date) return;
    const starts = [
      ...model.plans.map((item) => item.startMinute),
      ...model.timedRecords.map((item) => item.startMinute),
    ];
    const contentStart = starts.length ? Math.min(...starts) : 8 * 60;
    const targetMinute = date === today && nowMinute != null
      ? Math.min(contentStart, Math.max(0, nowMinute - 90))
      : Math.max(0, contentStart - 60);
    scrollRef.current.scrollTop = (targetMinute / 60) * HOUR_HEIGHT;
    lastAutoScrollDate.current = date;
  }, [date, today, nowMinute, joboLoaded, model.plans, model.timedRecords]);

  if (!joboLoaded) {
    return (
      <div data-jobo-view className="h-full flex items-center justify-center p-8">
        <p className={`text-sm ${textSecondary}`}>{t('jobo.view.loading')}</p>
      </div>
    );
  }

  return (
    <div data-jobo-view className={`jobo5-root ${textPrimary}`}>
      <div className={`jobo5-head border-b ${borderClass}`}>
        <div className="jobo5-head-cell">
          <strong>{t('jobo.view.plan')}</strong>
          <span className={textSecondary}>{model.plans.length}</span>
        </div>
        <div className={`jobo5-head-ruler ${textSecondary}`}>{t('jobo.view.time')}</div>
        <div className="jobo5-head-cell">
          <strong>{t('jobo.view.do')}</strong>
          <span className={textSecondary}>{model.timedRecords.length + model.untimedRecords.length}</span>
        </div>
      </div>

      {(joboError || !joboWritable || model.invalidRecordCount > 0) && (
        <div className={`jobo5-notice border-b ${borderClass} ${textSecondary}`}>
          <AlertTriangle size={13} />
          {joboError
            ? t('jobo.view.storageError')
            : !joboWritable
              ? t('jobo.view.readOnly')
              : t('jobo.view.invalidRecords', { count: model.invalidRecordCount })}
        </div>
      )}

      <UntimedShelf
        records={model.untimedRecords}
        t={t}
        writable={joboWritable}
        onEdit={setEditingRecord}
      />

      <div ref={scrollRef} className="jobo5-scroll">
        <div
          className={`jobo5-grid ${darkMode ? 'jobo5-dark' : ''}`}
          style={{ height: `${(DAY_MINUTES / 60) * HOUR_HEIGHT}px` }}
        >
          <div className="jobo5-lane jobo5-plan-lane">
            {hourLabels.map((hour) => (
              <div key={hour} className={`jobo5-hour-line border-t ${borderClass}`} style={{ top: `${hour * HOUR_HEIGHT}px` }} />
            ))}
            {model.plans.map((item) => (
              <PlanCard key={item.id} item={item} formatTime={formatTime} t={t} />
            ))}
            {!model.plans.length && (
              <div className={`jobo5-empty ${textSecondary}`}>{t('jobo.view.emptyPlan')}</div>
            )}
          </div>

          <div className={`jobo5-ruler border-x ${borderClass} ${textSecondary}`}>
            {hourLabels.map((hour) => (
              <div key={hour} className="jobo5-hour-label" style={{ top: `${hour * HOUR_HEIGHT}px` }}>
                {formatTime(`${two(hour)}:00`)}
              </div>
            ))}
          </div>

          <div className="jobo5-lane jobo5-do-lane">
            {hourLabels.map((hour) => (
              <div key={hour} className={`jobo5-hour-line border-t ${borderClass}`} style={{ top: `${hour * HOUR_HEIGHT}px` }} />
            ))}
            {model.timedRecords.map((item) => (
              <DoCard
                key={item.id}
                item={item}
                formatTime={formatTime}
                t={t}
                writable={joboWritable}
                onEdit={setEditingRecord}
              />
            ))}
            {!model.timedRecords.length && !model.untimedRecords.length && (
              <div className={`jobo5-empty ${textSecondary}`}>{t('jobo.view.emptyDo')}</div>
            )}
          </div>

          {nowTop != null && (
            <div className="jobo5-now-line" style={{ top: `${nowTop}px` }} aria-hidden="true">
              <span />
            </div>
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
        />
      )}
    </div>
  );
}
