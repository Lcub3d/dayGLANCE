import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import MobileTimeGrid from '../MobileTimeGrid.jsx';
import DoColumn from './DoColumn.jsx';
import { DO_STRIPES } from './PastDoCard.jsx';
import useJoboDay from '../../hooks/useJoboDay.js';
import useJoboDoActions from '../../hooks/useJoboDoActions.js';
import DoEditor from './DoEditor.jsx';
import {
  DIVIDER_PX, HOUR_GUTTER_PX, NARROW_LANE_PX, SWAP_MS,
  doBar, laneWidths, planIsWide, swapped, tappedTaskId,
} from '../../jobo/mobileLanes.js';

// JOBO on the phone and on a tablet held upright (slice 8,
// docs/jobo-mobile.md). Plan and Do side by side on one hour grid, sharing
// the width unevenly: one side wide with full cards, the other a narrow lane
// of bars at the same times, a map of the other half of the day. Plan stays
// left and Do right; a swap changes their widths, never their order.
//
// The wide Plan side IS the phone timeline (MobileTimeGrid), so its cards,
// tap-to-add, long-press, card swipes and notes come with it, and its bars
// mode draws the narrow Plan lane. The wide Do side is the Do column: tap an
// empty slot to add a Do there, tap a Do to edit it, both in the Do editor
// as a sheet (step 2). Keep and Continue work as on desktop; nothing drags,
// since dragging competes with scrolling the day.
//
// It renders inside the timeline's own scroll area (the layout's
// calendarRef), as MobileTimeGrid needs, under the layout's sticky date
// header, whose element `stickyHeaderRef` names.

// The phone timeline's hour: 160px rows plus their 1px border
// (hooks/useDragDrop.js), until the real rows are measured. On a screen with
// a fractional pixel ratio the border can draw thinner than 1px, an hour then
// a little under 161px, and a fixed 161 would drift from the timeline
// through the day; the Do side draws to the measured height instead.
const PHONE_HOUR_PX = 161;

// The divider between the sides, blue (the app's accent, Tailwind blue-500)
// so the boundary between Plan and Do reads at a glance.
const DIVIDER_COLOR = 'rgb(59 130 246)';

const reducedMotion = () => typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A task id inside an attribute selector (as JoboView).
const cssEscape = (value) => (typeof CSS !== 'undefined' && CSS.escape
  ? CSS.escape(String(value))
  : String(value).replace(/["\\]/g, '\\$&'));

/** The narrow Plan lane's bars: each timed task at its time, solid, in its colour. */
function PlanBars({ tasks, selectedTaskId, ctx }) {
  return tasks.map((task) => {
    const { top, height } = ctx.calculateTaskPosition(task);
    const pos = ctx.calculateConflictPosition(task, tasks);
    const selected = selectedTaskId != null && String(task.id) === String(selectedTaskId);
    return (
      <div
        key={task.id}
        data-jobo-bar-task={task.id}
        data-jobo-bar="plan"
        data-selected={selected ? 'true' : undefined}
        className={`absolute rounded-sm ${task.color || 'bg-gray-500'} ${task.completed ? 'opacity-50' : ''} ${selected ? 'ring-2 ring-blue-500 ring-offset-1 z-10' : ''}`}
        style={{
          top: `${top}px`,
          height: `${Math.max(3, height)}px`,
          ...(pos.width ? { left: pos.left, width: pos.width } : { left: 3, right: 3 }),
        }}
      />
    );
  });
}

/** The narrow Do lane: the Do items as striped bars, on the Do column's hour rows. */
function DoBars({ items, date, hourPx, selectedTaskId, onTap, ctx, t }) {
  const { darkMode, borderClass, currentTime } = ctx;
  const now = currentTime instanceof Date ? currentTime : new Date();
  const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowY = (now.getHours() * 60 + now.getMinutes()) * hourPx / 60;
  return (
    <div
      data-jobo-bars-lane="do"
      role="button"
      tabIndex={0}
      aria-label={t('jobo.mobile.showDo')}
      className="relative cursor-pointer"
      onClick={onTap}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(e); } }}
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <div key={hour} className={`border-b ${borderClass} ${hour % 2 === 1 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`} style={{ height: `${hourPx}px` }} />
      ))}
      {isToday && (
        // The timeline's now line structure (an 8px row, the line centred),
        // so it meets the Plan side's at the same height.
        <div className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: `${nowY}px` }}>
          <div className="flex items-center"><div className="w-2 h-2 -ml-1" /><div className="flex-1 h-0.5 bg-red-500" /></div>
        </div>
      )}
      {items.map((item) => {
        const bar = doBar(item, hourPx);
        const selected = selectedTaskId != null && bar.taskId != null && String(bar.taskId) === String(selectedTaskId);
        return (
          <div
            key={item.id}
            data-jobo-bar="do"
            data-jobo-bar-task={bar.taskId ?? undefined}
            data-selected={selected ? 'true' : undefined}
            className={`absolute rounded-sm ${bar.color} ${item.estimate ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-blue-500 ring-offset-1 z-10' : ''}`}
            style={{
              top: `${bar.top}px`, height: `${bar.height}px`,
              left: `calc(${bar.leftPct}% + 3px)`, width: `calc(${bar.widthPct}% - 6px)`,
              backgroundImage: item.estimate ? undefined : DO_STRIPES,
            }}
          />
        );
      })}
    </div>
  );
}

export default function MobileJoboView({ stickyHeaderRef }) {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const { joboLoaded, joboError, joboWritable, reloadJobo } = useFeaturesCtx();
  // The timeline's hour as drawn (see PHONE_HOUR_PX), measured from its
  // second row: the first carries the grid's top border as well.
  const [hourPx, setHourPx] = useState(PHONE_HOUR_PX);
  const { date, dayTasks, model, doItems, currentTime, nowDate } = useJoboDay({ hourHeight: hourPx });
  // Add, edit, continue and keep: the desktop view's own actions, so a Do is
  // written the same way from either, every write a step of the undo history.
  const {
    writer, editorProps, error: actionError,
    openAdd, openEdit, openContinue, keepEstimate,
  } = useJoboDoActions({ date, model, doItems, currentTime, nowDate, announce: true });

  // Which side is wide: the default for the date until a swap, which holds
  // while the date does.
  const [swap, setSwap] = useState(null);
  const planWide = planIsWide(swap, date, nowDate);
  // The task tapped on either side: its counterparts in the narrow lane
  // light up (the phone's version of desktop's hover pairing). Per date.
  const [selection, setSelection] = useState(null);
  const selectedTaskId = selection?.date === date ? selection.id : null;
  const select = useCallback((id) => setSelection(id == null ? null : { date, id: String(id) }), [date]);

  // The view's width, for the two sides' widths.
  const rootRef = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [joboLoaded]);
  const widths = laneWidths(width, planWide);
  const { timeGridRef } = ctx;
  useLayoutEffect(() => {
    const row = timeGridRef?.current?.children?.[1];
    const measured = row?.getBoundingClientRect().height;
    if (measured > 0 && Math.abs(measured - hourPx) > 0.01) setHourPx(measured);
  }, [timeGridRef, hourPx, width, joboLoaded]);

  // The layout's sticky date header: the Plan/Do row sticks just under it.
  const [stickyTop, setStickyTop] = useState(0);
  useLayoutEffect(() => {
    const el = stickyHeaderRef?.current;
    if (!el) return undefined;
    const measure = () => setStickyTop(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stickyHeaderRef]);

  // The swap slides: the wide side narrows as the other widens. The side
  // arriving at full width is laid out at that width from the start and
  // fades in once it gets there, so its text never reflows mid-slide.
  // Instant with reduced motion.
  const [arriving, setArriving] = useState(null);
  const arrivingTimer = useRef(null);
  useEffect(() => () => clearTimeout(arrivingTimer.current), []);
  const doSwap = useCallback((taskId = null) => {
    const next = swapped(swap, date, nowDate);
    setSwap(next);
    if (taskId != null) select(taskId);
    clearTimeout(arrivingTimer.current);
    if (reducedMotion()) { setArriving(null); return; }
    setArriving(next.planWide ? 'plan' : 'do');
    arrivingTimer.current = setTimeout(() => setArriving(null), SWAP_MS);
  }, [swap, date, nowDate, select]);
  // A tap on the narrow lane swaps; on a bar, it highlights that item too.
  const onLaneTap = useCallback((event) => doSwap(tappedTaskId(event.target)), [doSwap]);
  const motion = reducedMotion() ? 'none' : `width ${SWAP_MS}ms ease-out`;

  // Open on the part of the day that matters, as JOBO does on desktop: an
  // hour before now on today, an hour before the first Plan or Do on another
  // day, or an hour before a Do opened from elsewhere ("Open in JOBO").
  const focusRef = useRef(null);
  if (ctx.joboFocus) focusRef.current = ctx.joboFocus;
  const { setJoboFocus } = ctx;
  useEffect(() => { if (ctx.joboFocus) setJoboFocus?.(null); }, [ctx.joboFocus, setJoboFocus]);
  useEffect(() => {
    if (!joboLoaded) return;
    const scroller = ctx.calendarRef?.current;
    if (!scroller) return;
    const firstMinute = Math.min(
      ...model.plans.map((item) => item.startMinute),
      ...doItems.map((item) => item.startMinute),
      8 * 60,
    );
    const focus = focusRef.current?.date === date ? focusRef.current : null;
    if (!focus) focusRef.current = null;
    const anchor = focus ? focus.minute : date === nowDate ? currentTime.getHours() * 60 : firstMinute;
    // The timeline's own rule (useTimelineScroll): the hour's top at the
    // scroll top lands it just under the sticky headers.
    scroller.scrollTop = Math.max(0, Math.floor(anchor / 60 - 1) * hourPx);
    // Only on a new day, or once the ledger has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, joboLoaded]);

  if (!joboLoaded) {
    return (
      <div data-jobo-mobile className={`flex items-center justify-center gap-2 p-6 ${ctx.textSecondary}`} role={joboError ? 'alert' : 'status'}>
        {joboError ? (
          <>
            <AlertTriangle size={16} />{t('jobo.view.loadError')}
            {reloadJobo && <button type="button" className="underline" onClick={() => reloadJobo()}>{t('jobo.view.retryLoad')}</button>}
          </>
        ) : t('common.loading')}
      </div>
    );
  }

  const status = actionError
    || (writer.conflict ? t('jobo.view.recordChanged')
      : joboError ? t('jobo.view.storageError')
        : !joboWritable ? t('jobo.view.readOnly') : '');
  const fadeIn = (side) => ({
    opacity: arriving === side ? 0 : 1,
    transition: arriving === side ? 'none' : `opacity ${reducedMotion() ? 0 : 150}ms ease-out`,
  });

  return (
    <div ref={rootRef} data-jobo-mobile data-plan-wide={planWide ? 'true' : 'false'} className={ctx.textPrimary}>
      {status && (
        <div data-jobo-status className="flex items-center gap-2 px-3 py-1 text-xs" role="status"><AlertTriangle size={14} />{status}</div>
      )}
      {/* The Plan/Do row: the wide side's name (the narrow lane has no room
          for one in every language) and the swap button on the divider,
          sticking under the date header. */}
      <div className={`sticky z-30 flex items-stretch h-7 border-b text-[11px] font-semibold uppercase tracking-wide ${ctx.cardBg} ${ctx.borderClass}`} style={{ top: `${stickyTop}px` }}>
        <div className={`flex-shrink-0 border-r ${ctx.borderClass}`} style={{ width: `${HOUR_GUTTER_PX}px` }} />
        <div data-jobo-side-label="plan" className="flex-shrink-0 min-w-0 flex items-center px-2 overflow-hidden whitespace-nowrap" style={{ width: `${widths.plan}px`, transition: motion }}>
          {planWide && t('jobo.view.plan')}
        </div>
        {/* The divider, carried up through this row: the swap button sits on it. */}
        <div className="relative flex-shrink-0" style={{ width: `${DIVIDER_PX}px`, background: DIVIDER_COLOR }}>
          <button
            type="button"
            data-jobo-swap
            onClick={() => doSwap()}
            aria-label={t(planWide ? 'jobo.mobile.showDo' : 'jobo.mobile.showPlan')}
            title={t(planWide ? 'jobo.mobile.showDo' : 'jobo.mobile.showPlan')}
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full border-2 border-blue-500 flex items-center justify-center shadow-sm ${ctx.cardBg} text-blue-500 active:scale-95`}
            style={{ transition: 'none' }}
          >
            <ArrowLeftRight size={14} />
          </button>
        </div>
        <div data-jobo-side-label="do" className="flex-1 min-w-0 flex items-center pl-5 pr-2 overflow-hidden whitespace-nowrap">
          {!planWide && t('jobo.view.do')}
        </div>
      </div>

      <div className="flex items-start">
        {/* Plan: the phone timeline (hour gutter included), wide or as bars. */}
        <div
          data-jobo-plan
          className="flex-shrink-0 overflow-hidden"
          style={{ width: `${HOUR_GUTTER_PX + widths.plan}px`, transition: motion }}
          // Capture: the timeline's cards stop their own clicks.
          onClickCapture={planWide ? (event) => {
            const id = event.target.closest?.('[data-task-id]')?.getAttribute('data-task-id');
            if (id != null) select(selectedTaskId === id ? null : id);
          } : undefined}
        >
          <style>{`[data-jobo-plan] [data-date-column]{transition:opacity 150ms ease-out}${arriving === 'plan' ? '[data-jobo-plan] [data-date-column]{opacity:0;transition:none}' : ''}${planWide && selectedTaskId != null ? `[data-jobo-plan] [data-task-id="${cssEscape(selectedTaskId)}"]{outline:2px solid rgb(59 130 246);outline-offset:1px;border-radius:0.5rem}` : ''}`}</style>
          {/* Wide: laid out at its full width from the start of a slide.
              Bars: the lane's own width as it slides, bars have no text. */}
          <div style={{ width: planWide ? `${HOUR_GUTTER_PX + widths.wide}px` : '100%' }}>
            <MobileTimeGrid
              planOnly
              barsMode={!planWide}
              onLaneTap={onLaneTap}
              barsOverlay={planWide ? null : <PlanBars tasks={dayTasks} selectedTaskId={selectedTaskId} ctx={ctx} />}
            />
          </div>
        </div>

        {/* Do: the Do column, wide and read only, or as bars. The 1px top
            border matches the timeline's first row. */}
        <div data-jobo-do className={`flex-1 min-w-0 overflow-hidden border-t ${ctx.borderClass}`} style={{ borderLeft: `${DIVIDER_PX}px solid ${DIVIDER_COLOR}` }}>
          <div style={planWide ? { width: '100%' } : { width: `${widths.wide}px`, ...fadeIn('do') }}>
            {planWide ? (
              <DoBars items={doItems} date={date} hourPx={hourPx} selectedTaskId={selectedTaskId} onTap={onLaneTap} ctx={ctx} t={t} />
            ) : (
              <DoColumn
                date={date}
                hourHeight={hourPx}
                edge={false}
                items={doItems}
                ctx={ctx}
                t={t}
                writable={joboWritable}
                gestures={false}
                pendingIds={writer.pendingIds}
                preview={null}
                onAddAt={openAdd}
                onEdit={openEdit}
                onKeep={keepEstimate}
                onContinue={openContinue}
                hoverTaskId={selectedTaskId}
                onHoverTask={() => {}}
                startHour={0}
                endHour={24}
                // A tap on a Do pairs it with its plan and opens it in the
                // editor; read only, it pairs alone.
                onDetails={(item) => {
                  const id = item.sourceTask?.id;
                  if (id != null) select(id);
                  if (joboWritable && item.record) openEdit(item.record);
                }}
                onPointGesture={() => {}}
                onResizeGesture={() => {}}
              />
            )}
          </div>
        </div>
      </div>
      {editorProps && (
        <DoEditor
          {...editorProps}
          sheet
          t={t}
          cardBg={ctx.cardBg}
          textPrimary={ctx.textPrimary}
          textSecondary={ctx.textSecondary}
          borderClass={ctx.borderClass}
          darkMode={ctx.darkMode}
        />
      )}
    </div>
  );
}
