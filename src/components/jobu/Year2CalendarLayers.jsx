import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { chineseDateMeta, calendarDescription } from '../../jobu/calendar/chineseCalendar.js';
import { chinaHoliday, chinaHolidaySchedule } from '../../jobu/calendar/chinaHolidays.js';

export function CalendarLayers({ calendar, year }) {
  const { t } = useTranslation();
  const T = (key, args) => t(`jobu.year2Calendar.${key}`, args);
  const { preferences: options, error, change, reset } = calendar;
  const root = useRef(null), trigger = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const schedule = chinaHolidaySchedule(year);
  return <div className="year2-layers" ref={root}>
    <button ref={trigger} type="button" className="year2-layer-button" data-year2-layers-toggle aria-expanded={open} aria-controls="year2-layer-options" onClick={() => setOpen(value => !value)}>
      <SlidersHorizontal size={14} aria-hidden="true" />{T('layers')}<ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <div id="year2-layer-options" className="year2-layer-options" role="group" aria-label={T('layers')} onKeyDown={event => event.stopPropagation()}>
      <h3>{T('calendarContent')}</h3>
      {['lunar', 'terms', 'festivals'].map(key => <label key={key} className="year2-switch-label">
        <span>{T(key)}</span><input type="checkbox" checked={options[key]} onChange={event => change({ [key]: event.target.checked })} />
      </label>)}
      <p className="year2-option-hint">{T('civilHint')}</p>
      <label className="year2-region-label"><span>{T('region')}</span><select data-year2-region value={options.region} onChange={event => change({ region: event.target.value })}>
        <option value="none">{T('none')}</option><option value="CN">{T('mainland')}</option>
      </select></label>
      {options.region === 'CN' && <div className="year2-source-info">
        <p>{schedule ? T('coverage', { years: '2025–2026' }) : T('scheduleMissing', { year })}</p>
        {schedule && <a href={schedule.source} target="_blank" rel="noopener noreferrer">{T('source')}<ExternalLink size={11} aria-hidden="true" /></a>}
        <p>{T('scopeHint')}</p>
      </div>}
      {error && <p className="year2-preference-error" role="alert">{T('preferenceError')}</p>}
      <div className="year2-options-footer"><span>{T('localOnly')}</span><button type="button" onClick={reset}>{T('reset')}</button></div>
    </div>}
  </div>;
}

export function Year2HolidayRail({ year, selected, onSelect }) {
  const { t } = useTranslation();
  const schedule = chinaHolidaySchedule(year);
  if (!schedule) return <p className="year2-coverage-note" role="status">{t('jobu.year2Calendar.scheduleMissing', { year })}</p>;
  const shortDate = date => date.slice(5).split('-').map(Number).join('.');
  return <nav className="year2-holiday-rail" aria-label={t('jobu.year2Calendar.holidayRail')}>
    {schedule.breaks.map(holiday => <button type="button" key={holiday.start} onClick={() => onSelect(holiday.start)}
      aria-pressed={selected >= holiday.start && selected <= holiday.end}
      aria-label={`${holiday.name} · ${holiday.start} — ${holiday.end} · ${t('jobu.year2Calendar.days', { count: holiday.days })}`}>
      <span lang="zh-Hans">{holiday.name}</span><small>{shortDate(holiday.start)}{holiday.end === holiday.start ? '' : `–${shortDate(holiday.end)}`}</small>
    </button>)}
  </nav>;
}

export function Year2CalendarDetail({ date, options }) {
  const { t } = useTranslation();
  const meta = options.lunar || options.terms || options.festivals ? chineseDateMeta(date) : null;
  const text = calendarDescription(meta, options);
  const holiday = options.region === 'CN' ? chinaHoliday(date) : null;
  if (!text && !holiday) return null;
  return <div className="year2-date-meta" data-year2-calendar-detail>
    {text && <span lang="zh-Hans">{text}</span>}
    {holiday && <div className="year2-date-arrangement"><b className={`year2-status year2-status-${holiday.type}`}>{t(`jobu.year2Calendar.${holiday.type}`)}</b>
      <span><span lang="zh-Hans">{holiday.name}</span> · {t(`jobu.year2Calendar.${holiday.type}Detail`)}</span>
      {holiday.type === 'rest' && <small>{holiday.start} — {holiday.end} · {t('jobu.year2Calendar.days', { count: holiday.days })}</small>}
    </div>}
  </div>;
}
