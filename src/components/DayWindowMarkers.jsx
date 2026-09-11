import { useEffect, useMemo } from 'react';
import { Check, NotebookPen } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useTranslation } from 'react-i18next';
import { dateToString } from '../utils/taskUtils.js';
import useJournalTimeline from '../hooks/useJournalTimeline.js';
import ActualTimelineLayer from './ActualTimelineLayer.jsx';

// START/STOP day-window marker lines on the timeline grid. Render-only in
// phase A - the window is set and moved from the summary strip's day-window
// menu; making the lines themselves draggable is a later phase because it has
// to integrate with both the desktop and the phone drag systems.
//
// Dashed teal/indigo, deliberately distinct from the solid red current-time
// line and from the GTD frame bands. Labels sit centered on the line, both
// along it and straddling it, clear of the frame labels (top-left) and the
// current-time dot (left edge).

const START_COLOR = '#14b8a6'; // teal-500
const STOP_COLOR = '#6366f1'; // indigo-500

function MarkerLine({ topPx, color, label, onOpenMenu }) {
  return (
    <div className="absolute left-0 right-0 pointer-events-none z-[24]" style={{ top: `${topPx}px` }}>
      <div className="border-t-2 border-dashed" style={{ borderColor: color }} />
      {/* The chip (just the word, not the line) opens the day-window popover.
          The line itself stays click-transparent so blocks under it remain
          reachable. */}
      <button
        onClick={(e) => {
          // The chip sits inside a grid column whose own onClick opens the
          // new-task form at the tapped time. Stop propagation so a chip tap
          // opens only the popover.
          e.stopPropagation();
          onOpenMenu();
        }}
        className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 px-1 rounded text-[9px] font-semibold uppercase tracking-wide text-white pointer-events-auto cursor-pointer"
        style={{ backgroundColor: color }}
      >
        {label}
      </button>
    </div>
  );
}

function dateFromString(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * @param dateStr      Day this column renders ('YYYY-MM-DD').
 * @param minToTop     Optional minutes-to-px transform for views whose columns
 *                     cover a slice of the day (DayView's 8-hour blocks).
 *                     Defaults to the shared minutesToPosition.
 * @param clipStartMin Optional visible range: content outside it is not drawn.
 * @param clipEndMin   End of the visible range.
 */
export default function DayWindowMarkers({ dateStr, minToTop, clipStartMin = 0, clipEndMin = 1440 }) {
  const { minutesToPosition, timeToMinutes, getTasksForDate } = useDayPlannerCtx();
  const { getDayWindow, setDayWindowMenuOpen } = useFeaturesCtx();
  const { t } = useTranslation();
  const { recordActual, hasMatchingActual, observePlans } = useJournalTimeline();

  const toTop = minToTop ?? minutesToPosition;
  const dayDate = useMemo(() => dateFromString(dateStr), [dateStr]);
  const dayTasks = useMemo(() => {
    const tasks = getTasksForDate?.(dayDate) || [];
    return tasks.filter(task => !task.isAllDay && task.startTime && task.date === dateStr);
  }, [dateStr, dayDate, getTasksForDate]);

  // Plan history is captured passively while a day is visible. The first sighting
  // establishes a baseline; later schedule changes append revisions instead of
  // erasing the earlier intent. This gives PDCA review a stable plan history while
  // leaving the existing planner free to reschedule unfinished work.
  const planFingerprint = useMemo(() => dayTasks
    .map(task => [task.id, task.date, task.startTime, task.duration, task.title, task.projectId].join('|'))
    .sort()
    .join('||'), [dayTasks]);

  useEffect(() => {
    if (dayTasks.length) observePlans(dayTasks);
  }, [observePlans, planFingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayWindow = getDayWindow?.(dateStr);
  const markerLines = [];
  if (dayWindow?.start) {
    const min = timeToMinutes(dayWindow.start);
    if (min >= clipStartMin && min < clipEndMin) {
      markerLines.push(
        <MarkerLine
          key="start"
          topPx={Math.round(toTop(min))}
          color={START_COLOR}
          label={t('strip.markerStart')}
          onOpenMenu={() => setDayWindowMenuOpen?.(true)}
        />
      );
    }
  }
  if (dayWindow?.stop) {
    const min = timeToMinutes(dayWindow.stop);
    if (min >= clipStartMin && min < clipEndMin) {
      markerLines.push(
        <MarkerLine
          key="stop"
          topPx={Math.round(toTop(min))}
          color={STOP_COLOR}
          label={t('strip.markerEnd')}
          onOpenMenu={() => setDayWindowMenuOpen?.(true)}
        />
      );
    }
  }

  const todayStr = dateToString(new Date());
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const occupiedStarts = new Map();

  const recordButtons = dayTasks.map(task => {
    const start = timeToMinutes(task.startTime);
    const end = start + Math.max(1, Number(task.duration) || 30);
    if (end <= clipStartMin || start >= clipEndMin) return null;

    // Recording a future plan as fact is deliberately blocked. Past blocks and
    // blocks that have already started today can be accepted as actual with one tap.
    if (dateStr > todayStr || (dateStr === todayStr && start > nowMinutes)) return null;

    const slotKey = `${start}`;
    const sameStartIndex = occupiedStarts.get(slotKey) || 0;
    occupiedStarts.set(slotKey, sameStartIndex + 1);
    const recorded = hasMatchingActual(task);
    const label = recorded
      ? t('journal.actualRecorded', { defaultValue: 'Actual recorded' })
      : t('journal.recordActual', { defaultValue: 'Record planned block as actual' });

    return (
      <button
        key={`journal-record:${task.id}`}
        type="button"
        aria-label={`${label}: ${task.title}`}
        title={label}
        disabled={recorded}
        onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          recordActual(task);
        }}
        className={`absolute z-[32] pointer-events-auto w-5 h-5 rounded-full border shadow-sm flex items-center justify-center transition-opacity ${recorded
          ? 'bg-stone-800/80 border-white/60 text-white opacity-80 cursor-default'
          : 'bg-white/90 border-stone-800/60 text-stone-800 hover:bg-stone-100 cursor-pointer'}`}
        style={{
          top: `${Math.round(toTop(Math.max(start, clipStartMin))) + 3}px`,
          right: `${4 + sameStartIndex * 22}px`,
        }}
      >
        {recorded ? <Check size={11} strokeWidth={3} /> : <NotebookPen size={11} />}
      </button>
    );
  });

  return (
    <>
      <ActualTimelineLayer
        dateStr={dateStr}
        minToTop={minToTop}
        clipStartMin={clipStartMin}
        clipEndMin={clipEndMin}
      />
      {markerLines}
      {recordButtons}
    </>
  );
}
