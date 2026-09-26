import React, { useLayoutEffect, useRef, useState } from 'react';
import { Check, Clock, FileText, History, MoreHorizontal } from 'lucide-react';
import TimelineTaskCardContent from '../TimelineTaskCardContent.jsx';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { extractTags } from '../../utils/taskUtils.js';
import { editPlan, planCapabilities, startPlanResize, togglePlanCompletion } from '../../jobo/nativePlanAdapter.js';

export const progressText = (progress, t) => progress === 'completed' ? t('common.completed') : t(`jobo.view.progress.${progress}`);

export function timingText(comparison, t) {
  if (!comparison) return '';
  const { metrics, comparable, notStarted, planContext } = comparison;
  if (metrics.untimedAttemptCount) return t('jobo.view.timeIncomplete');
  if (notStarted) return t('jobo.view.summary.notStarted');
  if (planContext === 'noPlan') return t('jobo.view.summary.unplanned');
  if (!comparable) return '';
  return [
    t(`jobo.view.timeStart.${comparison.startTiming}`, { minutes: Math.abs(metrics.startOffsetMinutes) }),
    t(`jobo.view.timeFinish.${comparison.finishTiming}`, { minutes: Math.abs(metrics.finishOffsetMinutes) }),
    t(`jobo.view.timeDuration.${comparison.durationComparison}`, { minutes: Math.abs(metrics.durationDifferenceMinutes) }),
  ].join(' · ');
}

export function TimingSummary({ comparison, t }) {
  const text = timingText(comparison, t);
  return text ? <span className="jobo-s5-timing-summary" title={text}><Clock size={12} aria-hidden="true" /><span>{text}</span></span> : null;
}

export default function PlanCard({ item, scale, startHour, ctx, t, onFocus, onSelect, onDragStart, onDragEnd, onDetails, onNotes, onToggleNotes, onComplete, completionDisabled = false, notesColumnOpen = false, noteVisible = false, selected }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const task = item.currentTask || item.task;
  const capability = planCapabilities(item);
  const height = Math.max(40, (item.endMinute - item.startMinute) / 60 * scale - 2);
  const compact = height < 55 || width < 180;
  const completed = !item.historical && !!task.completed;
  const focus = { group: item.groupKey, task: item.noteKey || '' };
  const expanded = ctx.expandedNotesTaskId === task.id || ctx.expandedTaskMenu === task.id;
  const native = !item.historical && !(task.imported && task.isTaskCalendar);
  const detailsButton = (inMenu = false) => <button type="button"
    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
    aria-label={`${t('jobo.view.details')}: ${task.title}`}
    onClick={(event) => { event.stopPropagation(); onDetails(item, inMenu ? ref.current : event.currentTarget); if (inMenu) ctx.setExpandedTaskMenu(null); }}>
    <MoreHorizontal size={14} />{inMenu && <span className="text-xs">{t('jobo.view.details')}</span>}
  </button>;
  const notesOpen = notesColumnOpen ? noteVisible : ctx.expandedNotesTaskId === task.id;
  const notesButton = onToggleNotes && item.noteKey ? (inMenu = false) => <button type="button"
    className={`notes-toggle-button jobo-s5-notes-toggle hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : 'inline-flex items-center'} ${notesOpen ? 'bg-white/20' : !task.notes ? 'opacity-40' : ''}`}
    aria-label={`${t('task.notes')}: ${task.title}`} title={t('task.notes')} aria-expanded={notesOpen}
    onClick={(event) => { event.stopPropagation(); onToggleNotes(item); }}>
    <FileText size={13} /><svg className="jobo-s5-note-arrow" width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M0 5H7M4 2L7 5L4 8" /></svg>{inMenu && <span className="text-xs">{t('task.notes')}</span>}
  </button> : undefined;
  const colorStyle = task.imported ? ctx.getTaskCalendarStyle?.(task, ctx.darkMode) || {} : {};
  return <article ref={ref} tabIndex={0} aria-label={`${t('jobo.view.plan')}: ${task.title}`}
    className={`jobo-s5-card jobo-s5-plan-card jobo-s5-native-plan text-white rounded-lg shadow-md ${task.isTaskCalendar ? '' : task.color || 'bg-blue-500'} ${completed ? 'opacity-50' : ''} ${item.historical ? 'jobo-s5-historical' : ''} ${selected ? 'jobo-s5-selected' : ''} ${expanded ? 'jobo-s5-expanded-card' : ''}`}
    style={{ top: `${(item.startMinute - startHour * 60) / 60 * scale}px`, height, left: `calc(${item.leftPct}% + 3px)`, width: `calc(${item.widthPct}% - 6px)`, ...colorStyle }}
    data-jobo-plan-link={item.groupKey} data-jobo-task={item.noteKey || ''} data-jobo-card={item.id}
    draggable={capability.draggable && !expanded} onDragStart={(event) => onDragStart(event, item, 'plan')} onDragEnd={onDragEnd}
    onMouseEnter={() => onFocus(focus)} onMouseLeave={() => onFocus(null)} onFocus={() => onFocus(focus)}
    onClick={(event) => { event.stopPropagation(); onSelect(focus); }}
    onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onDetails(item, event.currentTarget); } }}
    onContextMenu={(event) => { if (!capability.editable || !ctx.setTaskContextMenu) return; event.preventDefault(); event.stopPropagation(); ctx.setTaskContextMenu({ x: event.clientX, y: event.clientY, taskId: task.id, isRecurring: String(task.id).startsWith('recurring-'), isImported: !!task.imported, isAllDay: false, dateStr: task.date }); }}>
    <div className="jobo-s5-plan-content" style={{ height, paddingRight: !native && compact ? 30 : 0 }}>
      {native ? <TimelineTaskCardContent task={task} height={height} isNarrowWidth={width < 300} flipNotesPanel={item.endMinute >= 1320} renderExtraActions={detailsButton} renderNotesAction={notesButton} suppressNotesPanel={notesColumnOpen} onToggleComplete={onComplete ? () => onComplete(item) : undefined} completionDisabled={completionDisabled}
      /> :
        <div className="jobo-s5-plan-shell">
          <div className="jobo-s5-title-row">
            {capability.completable && <button type="button" role="checkbox" aria-checked={completed} disabled={completionDisabled} className="jobo-s5-check" onClick={() => onComplete ? onComplete(item) : togglePlanCompletion(ctx, item)} aria-label={`${t(completed ? 'jobo.view.reopenTask' : 'jobo.view.completeTask')}: ${task.title}`}>{completed && <Check size={11} />}</button>}
            {item.historical && <History size={13} aria-label={t('jobo.view.capturedPlan')} />}
            <span className={`jobo-s5-title ${completed ? 'line-through' : ''}`} title={task.title}>{renderTitleWithoutTags(task.title)}</span>
          </div>
          {!compact && <div className="text-xs italic opacity-75 truncate">{extractTags(task.title).map(tag => `#${tag}`).join(' ')}</div>}
          {!compact && <div className="text-xs">{ctx.formatTime(item.plan.startTime)} · {t('common.minutesShort', { count: item.plan.duration })}{item.historical && ` · ${t('jobo.view.capturedPlan')}`}</div>}
        </div>}
    </div>
    {!native && <div className={`jobo-s5-plan-inspect ${compact ? 'is-compact' : ''}`}>
      {!native && item.noteKey && !compact && <button type="button" className="jobo-s5-card-action" onClick={() => onNotes(item)} aria-label={`${t('jobo.view.locateNotes')}: ${task.title}`}><FileText size={13} /></button>}
      {!native && <button type="button" className="jobo-s5-card-action" onClick={(event) => onDetails(item, event.currentTarget)} aria-label={`${t('jobo.view.details')}: ${task.title}`}><MoreHorizontal size={15} /></button>}
    </div>}
    {capability.editable && <button type="button" className="jobo-s5-resize jobo-s5-resize-end"
      aria-label={`${t('jobo.view.resizeEnd')}: ${task.title}`}
      onMouseDown={(event) => { if (event.button === 0) startPlanResize(ctx, item, event, scale); }}
      onTouchStart={(event) => startPlanResize(ctx, item, event, scale, { touch: true })}
      onClick={(event) => { event.stopPropagation(); if (event.detail === 0) editPlan(ctx, item); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }} />}
  </article>;
}
