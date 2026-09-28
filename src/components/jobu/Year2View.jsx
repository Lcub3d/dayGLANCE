import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useMonthItemsForDate } from '../month/MonthView.jsx';
import MonthDaySheet from '../month/MonthDaySheet.jsx';
import { monthCellLabel } from '../month/MonthGrid.jsx';
import { dateToString } from '../../utils/taskUtils.js';
import { formatLocalizedDate, localizedWeekdays } from '../../utils/localeFormatting.js';
import { adjacentDay, shiftDateByMonths } from '../../utils/monthGrid.js';
import { year2Months, year2Range, year2Items, YEAR2_MIN, YEAR2_MAX } from '../../jobu/year2.js';
import './Year2View.css';

const EMPTY = Object.freeze({});

/** Native React month cards, visually inspired by Trilium's multiMonthYear.
 * No Trilium/FullCalendar source, dependency, schema or event writer is used. */
export function Year2Month({ model, selected, today, itemsByDate, notes = EMPTY, onSelect, onOpenMonth, onMove, taskStyle }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const names = useMemo(() => localizedWeekdays('short', language), [language]);
  const title = formatLocalizedDate(new Date(model.year, model.month - 1, 1, 12), { month: 'long' }, language);
  const isCurrentMonth = today.startsWith(`${model.year}-${String(model.month).padStart(2, '0')}`);
  return <section className="year2-month" data-year2-month={model.month} data-current-month={isCurrentMonth || undefined} aria-label={`${title} ${model.year}`}>
    <h2>{onOpenMonth ? <button type="button" onClick={() => onOpenMonth(model.month)} title={t('jobu.year2OpenMonth', { month: title })}>{title}</button> : title}</h2>
    <div className="year2-weekdays" aria-hidden="true">{model.weekdays.map(day => <span key={day} data-weekend={day === 0 || day === 6 || undefined}>{names[day]}</span>)}</div>
    <div className="year2-days" role="group" aria-label={title}>
      {model.cells.map(cell => {
        if (!cell.inMonth) return <span key={cell.dateStr} className="year2-blank" aria-hidden="true" />;
        const items = itemsByDate[cell.dateStr] || [];
        const hasNote = !!notes[cell.dateStr]?.text?.trim() && !notes[cell.dateStr]?.deleted;
        const isToday = cell.dateStr === today;
        const label = `${monthCellLabel(cell.dateStr, items, isToday, t, language)}${hasNote ? ` · ${t('common.dailyNote')}` : ''}`;
        const preview = items.map(item => item.title || t(item.kind === 'deadline' ? 'task.deadline' : 'common.schedule')).join('\n');
        return <button type="button" key={cell.dateStr}
          className="year2-day" data-year2-date={cell.dateStr}
          data-today={isToday || undefined} data-selected={cell.dateStr === selected || undefined}
          data-weekend={cell.weekday === 0 || cell.weekday === 6 || undefined}
          aria-current={isToday ? 'date' : undefined} aria-pressed={cell.dateStr === selected}
          aria-label={label} title={`${label}${preview ? `\n${preview}` : ''}`}
          tabIndex={cell.dateStr === selected ? 0 : -1}
          onKeyDown={event => onMove(event, cell.dateStr)} onClick={() => onSelect(cell.dateStr)}>
          <span className="year2-day-heading"><span className="year2-day-number">{cell.day}</span>{hasNote && <FileText size={10} aria-hidden="true" />}</span>
          <span className="year2-events" aria-hidden="true">
            {items.slice(0, 2).map(item => <span key={`${item.kind || 'task'}:${item.id}`} className="year2-event" data-completed={item.completed || undefined}>
              <i className={item.color || 'bg-blue-500'} style={taskStyle?.(item)} />
              <span>{item.title || t(item.kind === 'deadline' ? 'task.deadline' : 'common.schedule')}</span>
            </span>)}
            {items.length > 2 && <span className="year2-more">+{new Intl.NumberFormat(language).format(items.length - 2)}</span>}
          </span>
        </button>;
      })}
    </div>
  </section>;
}

export default function Year2View() {
  const ctx = useDayPlannerCtx();
  const { selectedDate, weekStartDay, goToDate, setViewMode, setMonthViewRange,
    dailyNotes = EMPTY, darkMode, getTaskCalendarStyle, dataLoaded } = ctx;
  const { t } = useTranslation();
  const year = selectedDate.getFullYear();
  const selected = dateToString(selectedDate);
  const today = dateToString(ctx.currentTime instanceof Date ? ctx.currentTime : new Date());
  const months = useMemo(() => year2Months(year, weekStartDay), [year, weekStartDay]);
  const itemsForDate = useMonthItemsForDate();
  const itemsByDate = useMemo(() => Object.fromEntries(months.flatMap(model => model.cells.filter(cell => cell.inMonth).map(cell => [cell.dateStr, year2Items(itemsForDate(cell.dateStr))]))), [months, itemsForDate]);
  const [sheetDate, setSheetDate] = useState(null);
  const rootRef = useRef(null);
  const pendingFocus = useRef(null);

  // Publish the dates actually drawn, using the existing MONTH range seam.
  // This expands recurring occurrences even for a year far from today, and
  // releases the range on exit. No duplicate task/calendar store is created.
  useEffect(() => {
    setMonthViewRange?.(year2Range(year));
    return () => setMonthViewRange?.(null);
  }, [year, setMonthViewRange]);

  const focusDate = useCallback(date => {
    const button = rootRef.current?.querySelector(`[data-year2-date="${date}"]`);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest' });
  }, []);
  useEffect(() => {
    if (!pendingFocus.current) return;
    focusDate(pendingFocus.current);
    pendingFocus.current = null;
  }, [selected, focusDate]);

  const showDay = date => { goToDate(date); setSheetDate(date); };
  const openMonth = month => {
    goToDate(`${year}-${String(month).padStart(2, '0')}-01`);
    setViewMode('month');
  };
  const move = (event, date) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let next;
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in deltas) next = adjacentDay(date, deltas[event.key]).dateStr;
    else if (event.key === 'Home' || event.key === 'End') {
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const offset = (weekday - weekStartDay + 7) % 7;
      next = adjacentDay(date, event.key === 'Home' ? -offset : 6 - offset).dateStr;
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      next = dateToString(shiftDateByMonths(new Date(`${date}T12:00:00`), (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); showDay(date); return;
    } else return;
    event.preventDefault(); event.stopPropagation();
    if (Number(next.slice(0, 4)) < YEAR2_MIN || Number(next.slice(0, 4)) > YEAR2_MAX) return;
    pendingFocus.current = next;
    goToDate(next);
  };
  const taskStyle = item => {
    if (!item.imported || !getTaskCalendarStyle) return undefined;
    const style = getTaskCalendarStyle(item, darkMode);
    return { backgroundColor: style.backgroundColor || style.background || style.borderColor };
  };

  return <div ref={rootRef} data-year2-view className={`year2-view ${darkMode ? 'year2-dark' : ''}`} aria-label={t('jobu.year2')}>
    <div className="year2-toolbar"><span><CalendarDays size={15} aria-hidden="true" />{t('jobu.year2Hint')}</span>
      <button type="button" onClick={() => { pendingFocus.current = today; goToDate(today); if (today === selected) focusDate(today); }}>{t('common.today')}</button>
    </div>
    {(ctx.isAndroidApp || ctx.isIOSApp) && <p className="year2-loading">{t('jobu.year2DeviceCalendarHint')}</p>}
    {!dataLoaded && <p role="status" className="year2-loading">{t('common.loading')}</p>}
    <div className="year2-months">{months.map(model => <Year2Month key={`${year}-${model.month}`} model={model} selected={selected} today={today}
      itemsByDate={itemsByDate} notes={dailyNotes} taskStyle={taskStyle}
      onSelect={showDay} onOpenMonth={ctx.hiddenViews?.desktop?.includes('month') ? undefined : openMonth} onMove={move} />)}</div>
    {sheetDate && <MonthDaySheet date={sheetDate} onNavigate={showDay} onClose={() => { setSheetDate(null); focusDate(selected); }} />}
  </div>;
}
