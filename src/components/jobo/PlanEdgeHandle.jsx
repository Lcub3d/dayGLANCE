import React, { useEffect, useRef, useState } from 'react';
import './PlanEdgeHandle.css';

export const EDGE_SNAP_HOVER_MS = 350;

export default function PlanEdgeHandle({ edge, target, label, hint, onSnap, onResize, onTouchResize, onEdit }) {
  const [armed, setArmed] = useState(false);
  const hoveredAt = useRef(null);
  const timer = useRef(null);
  const dragCleanup = useRef(null);
  const clearHover = () => {
    window.clearTimeout(timer.current); hoveredAt.current = null; setArmed(false);
  };
  useEffect(() => () => { window.clearTimeout(timer.current); dragCleanup.current?.(); }, []);
  const snap = () => { if (target) { onSnap(target); clearHover(); } };
  const beginResizeIntent = event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (!onResize) return;
    dragCleanup.current?.();
    const origin = { clientY: event.clientY, preventDefault() {}, stopPropagation() {} };
    const cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('blur', cleanup);
      window.removeEventListener('keydown', cancel);
      dragCleanup.current = null;
    };
    const move = next => {
      if (Math.abs(next.clientY - origin.clientY) < 4) return;
      cleanup(); clearHover(); onResize(origin);
    };
    const cancel = next => { if (next.key === 'Escape') cleanup(); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('blur', cleanup);
    window.addEventListener('keydown', cancel);
    dragCleanup.current = cleanup;
  };
  return <button type="button" className={`jobo-plan-edge jobo-plan-edge-${edge} ${armed && target ? 'is-armed' : ''}`}
    aria-label={label} title={target ? hint : label} data-snap-time={target?.targetTime}
    onMouseEnter={() => {
      window.clearTimeout(timer.current); hoveredAt.current = performance.now();
      timer.current = window.setTimeout(() => setArmed(true), EDGE_SNAP_HOVER_MS);
    }}
    onMouseLeave={clearHover} onMouseDown={beginResizeIntent}
    onTouchStart={onTouchResize}
    onDoubleClick={event => {
      event.preventDefault(); event.stopPropagation();
      if (hoveredAt.current !== null && performance.now() - hoveredAt.current >= EDGE_SNAP_HOVER_MS) snap();
    }}
    onClick={event => {
      event.stopPropagation();
      if (event.detail === 0) { if (target) snap(); else onEdit?.(); }
    }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <span className="jobo-plan-edge-line" aria-hidden="true" />
    {armed && target && <span className="jobo-plan-edge-hint" aria-hidden="true">{hint}</span>}
  </button>;
}
