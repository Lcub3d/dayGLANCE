import { useEffect, useLayoutEffect, useRef } from 'react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { ZOOM_STEP, anchoredScrollTop, clampZoom, wheelSteps, zoomFor } from '../utils/timelineZoom.js';
import { ZOOM_FLASH_EVENT } from '../components/TimelineZoomFlash.jsx';

// A scrolling timeline's magnification (utils/timelineZoom.js), for MULTI,
// WEEK and JOBO. Returns the level to draw at, and takes a pinch or
// Ctrl+wheel over `scrollRef` as a step. Whatever changes the level (the
// gesture or the header control), the scroll moves with it so the time
// under the pointer, or at the middle of the view, stays where it was.
// `originRef` is the element whose top is the timeline's midnight, below
// any header that does not zoom.
export default function useTimelineZoom(view, { scrollRef, originRef } = {}) {
  const { timelineZooms, setTimelineZoom } = useDayPlannerCtx();
  const zoom = zoomFor(timelineZooms, view);
  const zoomRef = useRef(zoom);
  const anchorRef = useRef(null);
  const wheelRef = useRef(0);
  // The scroll position as it stood before a change. By the time the zoomed
  // rows are laid out, the browser's own scroll anchoring may already have
  // moved it to keep something in view; anchoring from that value would
  // compensate twice. Scroll events arrive after layout, so this still
  // holds the old position when the zoom's layout effect runs.
  const scrollTopRef = useRef(0);

  // The listeners follow the scroll element, which a view may mount after
  // its first render (JOBO shows a loading state first): checked on every
  // commit, attached once per element.
  const setZoomRef = useRef(setTimelineZoom);
  setZoomRef.current = setTimelineZoom;
  const attachedRef = useRef({ el: null, detach: null });
  useEffect(() => {
    const el = scrollRef?.current || null;
    if (attachedRef.current.el === el) return;
    attachedRef.current.detach?.();
    attachedRef.current = { el, detach: null };
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    const onScroll = () => { scrollTopRef.current = el.scrollTop; };
    const onWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey) || typeof setZoomRef.current !== 'function') return;
      // Ours, not the page's: the browser would zoom everything.
      event.preventDefault();
      const { steps, rest } = wheelSteps(wheelRef.current, event.deltaY);
      wheelRef.current = rest;
      if (!steps) return;
      anchorRef.current = event.clientY - el.getBoundingClientRect().top;
      const next = clampZoom(view, zoomRef.current + steps * ZOOM_STEP);
      setZoomRef.current(view, next);
      // Said for a moment over the timeline (TimelineZoomFlash).
      window.dispatchEvent(new CustomEvent(ZOOM_FLASH_EVENT, { detail: next }));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    attachedRef.current.detach = () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
    };
  });
  useEffect(() => () => attachedRef.current.detach?.(), []);

  useLayoutEffect(() => {
    const previous = zoomRef.current;
    zoomRef.current = zoom;
    if (previous === zoom) return;
    const el = scrollRef?.current;
    const anchorY = anchorRef.current ?? (el ? el.clientHeight / 2 : 0);
    anchorRef.current = null;
    if (!el) return;
    const origin = originRef?.current;
    const originOffset = origin
      ? origin.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
      : 0;
    const before = scrollTopRef.current;
    const next = anchoredScrollTop({ scrollTop: before, anchorY, originOffset, ratio: zoom / previous });
    el.scrollTop = next;
    scrollTopRef.current = el.scrollTop;
  }, [zoom, scrollRef, originRef]);

  return zoom;
}
