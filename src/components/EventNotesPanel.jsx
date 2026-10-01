import React from 'react';
import { useTranslation } from 'react-i18next';
import { isNativeApp, nativeUpdateEvent } from '../native.js';
import { renderFormattedText } from '../utils/textFormatting.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// The notes panel for an imported calendar event, in every view that opens
// one (timeline and all-day cards, the phone's notes sheet and agenda).
//
// Two kinds of event, two rules:
//  • An event from this device's own calendar (`nativeEventId`, native app):
//    its description is the event's real notes, edited here and written back
//    to the device calendar, as it always was.
//  • An event from a calendar feed (ICS, CalDAV): its description is rebuilt
//    from the feed on every refresh, so an edit to it was lost. It shows
//    read-only, and beneath it your own note, kept apart on this device
//    (utils/eventNotes.js) so a refresh cannot take it.
const TONES = {
  // On the event's own colour (desktop cards): white text.
  onColor: {
    label: 'text-xs font-semibold opacity-75 mb-1',
    text: 'text-sm whitespace-pre-wrap p-2 rounded bg-white/10 max-h-40 overflow-y-auto',
    field: 'w-full text-sm p-2 rounded bg-white/10 text-white placeholder:text-white/40 resize-y focus:outline-none focus:bg-white/20',
  },
  // On the app's surface (phone sheets): theme colours.
  themed: (darkMode) => ({
    label: `text-xs font-semibold mb-1 ${darkMode ? 'text-gray-400' : 'text-stone-500'}`,
    text: `text-sm whitespace-pre-wrap p-3 rounded-lg max-h-48 overflow-y-auto ${darkMode ? 'bg-white/5 text-gray-100' : 'bg-black/5 text-stone-900'}`,
    field: `w-full text-sm p-3 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-white/5 text-white placeholder:text-white/40' : 'bg-black/5 text-stone-900 placeholder:text-stone-400'}`,
  }),
};

export default function EventNotesPanel({ task, tone = 'onColor', rows = 3, allDay = false }) {
  const { t } = useTranslation();
  const { setTasks, setEventNote, timeToMinutes, minutesToTime, darkMode } = useDayPlannerCtx();
  const th = tone === 'themed' ? TONES.themed(darkMode) : TONES.onColor;
  const description = task.notes || '';

  if (isNativeApp() && task.nativeEventId) {
    return (
      <div data-event-notes="device">
        <div className={th.label}>{t('common.description')}</div>
        <textarea
          defaultValue={description}
          placeholder={t('task.descriptionPlaceholder', { defaultValue: 'Add description…' })}
          rows={rows}
          className={th.field}
          onBlur={async (e) => {
            const newNotes = e.target.value;
            if (newNotes === description) return;
            setTasks(prev => prev.map(row => row.id === task.id ? { ...row, notes: newNotes, transitionId: crypto.randomUUID() } : row));
            const start = task.startTime || '00:00';
            await nativeUpdateEvent({
              id: task.nativeEventId,
              title: task.title,
              start: `${task.date}T${start}:00`,
              end: `${task.date}T${minutesToTime(timeToMinutes(start) + (task.duration || 0))}:00`,
              allDay,
              notes: newNotes,
              location: task.location || '',
            });
          }}
        />
      </div>
    );
  }

  return (
    <div data-event-notes="feed" className="space-y-3">
      {description.trim() && (
        <div data-event-description>
          <div className={th.label}>{t('task.calendarDescription')}</div>
          <div className={th.text}>{renderFormattedText(description)}</div>
        </div>
      )}
      <div>
        <div className={th.label}>{t('task.yourNotes')}</div>
        <textarea
          data-event-note
          key={task.id}
          defaultValue={task.eventNote || ''}
          placeholder={t('task.notesPlaceholder')}
          rows={rows}
          className={th.field}
          onBlur={(e) => {
            const text = e.target.value;
            if (text !== (task.eventNote || '')) setEventNote?.(task.id, text);
          }}
        />
      </div>
    </div>
  );
}
