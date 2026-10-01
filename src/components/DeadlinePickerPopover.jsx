import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';
import { dateToString, formatDeadlineDate } from '../utils/taskUtils.js';
import { formatLocalizedDate } from '../utils/localeFormatting.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// `portal`: render to document.body at fixed coordinates, anchored to the
// wrapper this popover is placed in. For hosts that clip or stack their
// content (ProjectCard is overflow-hidden; the PLANNER is a z-70 overlay).
// The wrapper must still carry `deadline-picker-container` so App's
// click-outside handler treats the trigger button as inside.
const DeadlinePickerPopover = ({ taskId, currentDeadline, onClose, portal = false }) => {
  const { setDeadline, clearDeadline, cardBg, borderClass, hoverBg, textSecondary, textPrimary, darkMode } = useDayPlannerCtx();

  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarPos, setCalendarPos] = useState({ x: 0, y: 0 });
  const [openAbove, setOpenAbove] = useState(false);
  const popoverRef = useRef(null);
  const anchorRef = useRef(null);
  const [anchorRect, setAnchorRect] = useState(null);

  useLayoutEffect(() => {
    if (!portal) return;
    const measure = () => {
      const el = anchorRef.current?.parentElement;
      if (el) setAnchorRect(el.getBoundingClientRect());
    };
    measure();
    // A fixed popover can't follow its anchor through a scroll, so close.
    const onScroll = (e) => {
      if (e.target instanceof Node && e.target.closest?.('.deadline-picker-popover')) return;
      onClose();
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [portal, onClose]);
  const [viewDate, setViewDate] = useState(() => {
    if (currentDeadline) {
      const parts = currentDeadline.split('-');
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
    }
    return new Date();
  });

  useLayoutEffect(() => {
    if (portal) {
      if (anchorRect) setOpenAbove(anchorRect.bottom > window.innerHeight - 240);
      return;
    }
    if (popoverRef.current && !showCalendar) {
      const rect = popoverRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      setOpenAbove(rect.bottom > viewportHeight - 80);
    }
  }, [showCalendar, portal, anchorRect]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showCalendar) {
          setShowCalendar(false);
        } else {
          onClose();
        }
      }
    };
    // Capture phase, so an open popover takes Escape before the overlay
    // it sits in (the PLANNER, GoalDashboard's chain) closes underneath it.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [showCalendar, onClose]);

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayStr = dateToString(today);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = dateToString(tomorrow);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = dateToString(nextWeek);

  const handleQuickOption = (dateStr) => {
    setDeadline(taskId, dateStr);
  };

  const getDaysInMonth = () => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const changeMonth = (delta) => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
  };

  // React events bubble through a portal to the host row, whose touch and
  // double-click handlers (long-press reorder, open task) must not see them.
  const portalGuards = portal
    ? { onTouchStart: (e) => e.stopPropagation(), onDoubleClick: (e) => e.stopPropagation() }
    : {};

  if (showCalendar) {
    const days = getDaysInMonth();
    const calWidth = 260;
    const calHeight = 340;
    const pad = 8;
    const clampedLeft = Math.max(pad, Math.min(calendarPos.x - calWidth / 2, window.innerWidth - calWidth - pad));
    const clampedTop = Math.max(pad, Math.min(calendarPos.y - 150, window.innerHeight - calHeight - pad));
    const calendar = (
      <div
          className="deadline-picker-container deadline-picker-popover fixed z-[9999]"
          style={{ left: clampedLeft, top: clampedTop }}
          {...portalGuards}
        >
        <div
          className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-3 w-[260px]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => changeMonth(-1)}
              className={`p-1 rounded ${hoverBg}`}
            >
              <ChevronLeft size={16} className={textSecondary} />
            </button>
            <span className={`text-sm font-semibold ${textPrimary}`}>
              {formatLocalizedDate(viewDate, { month: 'short', year: 'numeric' })}
            </span>
            <button
              onClick={() => changeMonth(1)}
              className={`p-1 rounded ${hoverBg}`}
            >
              <ChevronRight size={16} className={textSecondary} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
              <div key={i} className={`text-center text-xs font-semibold p-1 ${textSecondary}`}>
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className="p-1"></div>;
              }
              const dayStr = dateToString(day);
              const isSelected = dayStr === currentDeadline;
              const isToday = dayStr === todayStr;

              return (
                <button
                  key={index}
                  onClick={() => {
                    setDeadline(taskId, dayStr);
                    onClose();
                  }}
                  className={`p-1 text-center text-sm rounded transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold'
                      : isToday
                        ? darkMode ? 'bg-blue-900 text-blue-200 font-semibold' : 'bg-blue-100 text-blue-900 font-semibold'
                        : darkMode
                          ? 'hover:bg-gray-700 text-gray-300'
                          : 'hover:bg-stone-100 text-stone-700'
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className={`border-t ${borderClass} mt-2 pt-2 flex gap-2`}>
            <button
              onClick={() => setShowCalendar(false)}
              className={`flex-1 px-2 py-1 text-sm rounded ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg}`}
            >
              Back
            </button>
            {currentDeadline && (
              <button
                onClick={() => {
                  clearDeadline(taskId);
                  onClose();
                }}
                className="flex-1 px-2 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    );
    return portal
      ? <><span ref={anchorRef} hidden />{createPortal(calendar, document.body)}</>
      : calendar;
  }

  const portalStyle = portal && anchorRect
    ? {
        right: Math.max(8, window.innerWidth - anchorRect.right),
        ...(openAbove
          ? { bottom: window.innerHeight - anchorRect.top + 4 }
          : { top: anchorRect.bottom + 4 }),
      }
    : undefined;

  const menu = (
    <div
      ref={popoverRef}
      className={portal
        ? 'deadline-picker-container deadline-picker-popover fixed z-[9999]'
        : `deadline-picker-container deadline-picker-popover absolute ${openAbove ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 z-30`}
      style={portalStyle}
      {...portalGuards}
    >
      <div
        className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <button
            onClick={() => handleQuickOption(todayStr)}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Today
          </button>
          <button
            onClick={() => handleQuickOption(tomorrowStr)}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Tomorrow
          </button>
          <button
            onClick={() => handleQuickOption(nextWeekStr)}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Next week
          </button>
          <div className={`border-t ${borderClass} my-1`}></div>
          <button
            onClick={(e) => {
              setCalendarPos({ x: e.clientX, y: e.clientY });
              setShowCalendar(true);
            }}
            className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
          >
            <Calendar size={14} />
            Pick date...
          </button>
          {currentDeadline && (
            <>
              <div className={`border-t ${borderClass} my-1`}></div>
              <div className={`px-3 py-1 text-sm font-medium ${darkMode ? 'text-blue-400' : 'text-blue-600'} flex items-center gap-2`}>
                <Calendar size={14} />
                Due {formatDeadlineDate(currentDeadline)}
              </div>
              <button
                onClick={() => clearDeadline(taskId)}
                className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}
              >
                <X size={14} />
                Clear deadline
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (!portal) return menu;
  return (
    <>
      <span ref={anchorRef} hidden />
      {anchorRect && createPortal(menu, document.body)}
    </>
  );
};

export default DeadlinePickerPopover;
