import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DatePicker from '../DatePicker.jsx';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { isDate } from '../../lifeplanner/model.js';
import './lifeGantt.css';

// Reuse the app's picker. Values remain in the existing editor draft until its
// guarded save; opening/closing a picker never writes anything.
export default function LifeScheduleFields({ schedule, startDate, targetDate, onChange, disabled, invalid }) {
  const { t, i18n } = useTranslation(), G = key => t(`lifeGantt.${key}`);
  const [picker, setPicker] = useState(null), returnFocus = useRef(null);
  const close = () => { setPicker(null); queueMicrotask(() => returnFocus.current?.focus()); };
  const fmt = value => isDate(value) ? formatLocalizedDate(new Date(`${value}T12:00:00`),
    { year: 'numeric', month: 'short', day: 'numeric' }, i18n.resolvedLanguage || i18n.language) : value || G('unset');
  return <fieldset className="lg-dates">
    <legend>{G('dates')}</legend>
    <p>{G(`source.${schedule.source}`)}{!schedule.editable ? ` · ${G('editNotebook')}` : ''}</p>
    {[['startDate', startDate, 'goals.startDate'], ['targetDate', targetDate, 'common.targetDate']].map(([field, value, label]) =>
      <label key={field} htmlFor={`life-${field}`}>{t(label)}<span className="lg-date-value">
        <button id={`life-${field}`} type="button" disabled={disabled || !schedule.editable}
          aria-label={`${t(label)}: ${fmt(value)}`} onClick={e => { returnFocus.current = e.currentTarget; setPicker(field); }}>
          <CalendarDays size={13} className="inline mr-1" />{fmt(value)}
        </button>
        {value && schedule.editable && <button type="button" disabled={disabled} aria-label={G(field === 'startDate' ? 'clearStart' : 'clearTarget')}
          onClick={() => onChange(field, '')}><X size={14} /></button>}
      </span></label>)}
    {invalid && <p role="alert">{G('invalidDate')}</p>}
    {picker && createPortal(<DatePicker value={isDate(picker === 'startDate' ? startDate : targetDate) ? (picker === 'startDate' ? startDate : targetDate) : ''}
      onChange={value => { if (!disabled && schedule.editable) onChange(picker, value); }} onClose={close} />, document.body)}
  </fieldset>;
}
