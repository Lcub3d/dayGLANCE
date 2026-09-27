import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Timer, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { POMODORO_CLOCK_MIME, POMODORO_TASK_MIME } from '../jobo/pomodoro.js';
import { priorityLevel } from '../utils/taskPriority.js';
import './TaskPriority.css';
import './TaskPomodoroFab.css';

export default function TaskPomodoroFab({ tablet = false }) {
  const ctx = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dialog = useRef(null);
  const fab = useRef(null);
  const highlighted = useRef(null);
  const { tasks: scheduledTasks, unscheduledTasks, expandedRecurringTasks, getTasksForDate, selectedDate, isVisibleForUser } = ctx;
  const tasks = useMemo(() => {
    const byId = new Map();
    for (const task of [...(scheduledTasks || []), ...(unscheduledTasks || []), ...(expandedRecurringTasks || []), ...(getTasksForDate?.(selectedDate) || [])]) {
      if (task?.id && !task.deleted && !task.isExample && !task.isJoboSyntheticOccurrence && (!isVisibleForUser || isVisibleForUser(task))) byId.set(String(task.id), task);
    }
    return [...byId.values()];
  }, [scheduledTasks, unscheduledTasks, expandedRecurringTasks, getTasksForDate, selectedDate, isVisibleForUser]);
  const available = features.joboLoaded && features.joboWritable && !features.showFocusMode;
  const resolve = (taskId, recordId) => {
    const record = recordId ? features.joboRecords?.find(row => row.id === recordId && !row.deleted) : null;
    const task = tasks.find(row => String(row.id) === String(taskId));
    return task || record ? { task, record } : null;
  };
  const fromElement = element => {
    const card = element?.closest?.('[data-pomodoro-task],[data-pomodoro-do],[data-task-id]');
    return card ? { card, target: resolve(card.dataset.pomodoroTask || card.dataset.taskId, card.dataset.pomodoroDo) } : null;
  };
  const fromDrag = event => {
    try {
      const payload = event.dataTransfer.getData(POMODORO_TASK_MIME);
      if (payload) {
        const parsed = JSON.parse(payload);
        return resolve(parsed.taskId, parsed.recordId);
      }
    } catch { return null; }
    const id = event.dataTransfer.getData('application/x-dayglance-task');
    return id ? resolve(id, null) : null;
  };
  const clearHighlight = () => {
    highlighted.current?.classList.remove('task-pomodoro-drop-target');
    highlighted.current = null;
  };
  const open = target => {
    if (!available || !target) return;
    clearHighlight();
    setChoosing(false);
    setDragOver(false);
    ctx.handleDragEnd?.();
    features.enterTaskPomodoro(target.task, target.record);
  };

  useEffect(() => {
    if (!available) return;
    const over = event => {
      if (!event.dataTransfer?.types?.includes(POMODORO_CLOCK_MIME)) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = 'link';
      const found = fromElement(event.target);
      clearHighlight();
      if (!found?.target) return;
      highlighted.current = found.card;
      found.card.classList.add('task-pomodoro-drop-target');
    };
    const drop = event => {
      if (!event.dataTransfer?.types?.includes(POMODORO_CLOCK_MIME)) return;
      event.preventDefault(); event.stopPropagation();
      open(fromElement(event.target)?.target);
      clearHighlight();
    };
    document.addEventListener('dragover', over, true);
    document.addEventListener('dragenter', over, true);
    document.addEventListener('drop', drop, true);
    document.addEventListener('dragend', clearHighlight);
    return () => {
      document.removeEventListener('dragover', over, true);
      document.removeEventListener('dragenter', over, true);
      document.removeEventListener('drop', drop, true);
      document.removeEventListener('dragend', clearHighlight);
      clearHighlight();
    };
  });

  useEffect(() => {
    if (choosing) dialog.current?.querySelector('input')?.focus();
  }, [choosing]);
  const close = () => { setChoosing(false); fab.current?.focus(); };
  const pick = () => {
    const selected = [...document.querySelectorAll('[data-jobo-selected="true"]')];
    const target = selected.length === 1 ? fromElement(selected[0])?.target : null;
    if (target) open(target);
    else { setQuery(''); setChoosing(true); }
  };
  const listed = tasks.filter(task => String(task.title || '').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(!!a.completed) - Number(!!b.completed) || (b.priority || 0) - (a.priority || 0));
  const acceptTaskDrag = event => {
    if (!available || ![POMODORO_TASK_MIME, 'application/x-dayglance-task'].some(type => event.dataTransfer.types.includes(type))) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    setDragOver(true);
  };
  const trapKeys = event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const items = [...dialog.current.querySelectorAll('input,button:not(:disabled)')];
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  };
  return <>
    <button ref={fab} type="button" draggable={available} disabled={!available}
      className={`task-pomodoro-fab ${dragOver ? 'is-drag-over' : ''} ${ctx.darkMode ? 'is-dark' : ''}`}
      style={{ right: tablet ? '1rem' : '1.5rem' }}
      aria-label={t('focus.pomodoroTimer')} title={t('focus.taskDragHint')}
      onClick={pick}
      onDragStart={event => { event.dataTransfer.setData(POMODORO_CLOCK_MIME, 'clock'); event.dataTransfer.effectAllowed = 'link'; }}
      onDragEnd={clearHighlight}
      onDragEnter={acceptTaskDrag} onDragOver={acceptTaskDrag}
      onDragLeave={() => setDragOver(false)}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragOver(false); open(fromDrag(event)); }}>
      <Timer size={25} aria-hidden="true" />
    </button>
    {choosing && createPortal(<div className="task-pomodoro-mask" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="task-pomodoro-title" onKeyDown={trapKeys}
        className={`task-pomodoro-picker ${ctx.darkMode ? 'is-dark' : ''}`}>
        <header><h2 id="task-pomodoro-title">{t('focus.chooseTask')}</h2><button type="button" aria-label={t('common.close')} onClick={close}><X size={20} /></button></header>
        <p>{t('focus.taskDragHint')}</p>
        <input type="search" aria-label={t('focus.searchTasks')} placeholder={t('focus.searchTasks')} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="task-pomodoro-options">
          {listed.map(task => <button type="button" key={task.id} onClick={() => open({ task })}>
            <i className="task-priority-surface" data-priority={priorityLevel(task.priority)} aria-hidden="true" />
            <span>{task.title || t('jobo.view.untitledPlan')}<small>{task.date || t('settings.inbox')}{task.completed ? ` · ${t('common.completed')}` : ''}</small></span><Timer size={16} />
          </button>)}
          {!listed.length && <p>{t('jobu.noTasks')}</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
