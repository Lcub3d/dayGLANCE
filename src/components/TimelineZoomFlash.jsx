import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// The level, shown for a moment while a pinch or Ctrl+scroll changes a
// timeline's size (hooks/useTimelineZoom.js announces it). Nothing stays on
// screen: the setting itself lives in Settings.
export const ZOOM_FLASH_EVENT = 'dg-timeline-zoom-flash';
const SHOWN_MS = 1200;

export default function TimelineZoomFlash() {
  const [level, setLevel] = useState(null);
  useEffect(() => {
    let timer = null;
    const show = (event) => {
      setLevel(event.detail);
      clearTimeout(timer);
      timer = setTimeout(() => setLevel(null), SHOWN_MS);
    };
    window.addEventListener(ZOOM_FLASH_EVENT, show);
    return () => { window.removeEventListener(ZOOM_FLASH_EVENT, show); clearTimeout(timer); };
  }, []);
  if (level == null || typeof document === 'undefined') return null;
  return createPortal(
    <div data-timeline-zoom-flash role="status" aria-live="polite"
      className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] pointer-events-none px-4 py-2 rounded-xl bg-black/70 text-white text-lg font-semibold tabular-nums shadow-lg">
      {Math.round(level * 100)}%
    </div>,
    document.body,
  );
}
