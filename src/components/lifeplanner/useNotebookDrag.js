import { useEffect, useId, useRef, useState } from 'react';

// Handle-only Pointer Events: text remains selectable, normal touch scrolling
// remains native, and dragging commits once on drop rather than on every move.
export default function useNotebookDrag(root, { onMove, onMenu, t }) {
  const active = useRef(null), latest = useRef({ onMove, onMenu, t });
  latest.current = { onMove, onMenu, t };
  const [message, setMessage] = useState('');
  const descriptionId = useId();
  const raf = useRef(null);
  const rows = group => [...(root.current?.querySelectorAll('[data-lp-sort]') || [])].filter(el => el.dataset.lpGroup === group);
  function clean() {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    root.current?.querySelectorAll('[data-lp-dragging], [data-lp-drop]').forEach(el => {
      delete el.dataset.lpDragging; delete el.dataset.lpDrop;
    });
  }
  function cancel() {
    active.current = null; clean();
  }
  function mark(target, after) {
    root.current?.querySelectorAll('[data-lp-drop]').forEach(el => delete el.dataset.lpDrop);
    if (target && active.current) {
      target.dataset.lpDrop = after ? 'after' : 'before';
      active.current.targetId = target.dataset.lpSort;
      active.current.after = after;
    }
  }
  function locate() {
    const a = active.current;
    if (!a || !a.dragging || a.keyboard) return;
    const hit = document.elementFromPoint(a.x, a.y)?.closest('[data-lp-sort]');
    if (hit?.dataset.lpGroup === a.group) mark(hit, a.y > hit.getBoundingClientRect().top + hit.getBoundingClientRect().height / 2);
    else { mark(null, false); a.targetId = null; }
  }
  function scrollTick() {
    const a = active.current;
    if (!a?.dragging || a.keyboard) return;
    const scroller = a.handle.closest('[data-lp-scroll]');
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const speed = a.y < box.top + 36 ? -10 : a.y > box.bottom - 36 ? 10 : 0;
      if (speed) scroller.scrollTop += speed;
    }
    locate(); raf.current = requestAnimationFrame(scrollTick);
  }
  async function drop() {
    const a = active.current;
    active.current = null; clean();
    if (!a?.targetId || a.targetId === a.id) return;
    const ok = await latest.current.onMove(a.group, a.id, a.targetId, a.after, a.ids);
    setMessage(latest.current.t(ok === false ? 'lifeplanner.moveFailed' : 'lifeplanner.moved', { title: a.title }));
    if (a.handle.isConnected) a.handle.focus({ preventScroll: true });
  }
  useEffect(() => {
    // This listener is registered before the workspace focus hook, so Escape
    // cancels a drag without unexpectedly closing the notebook.
    const escape = event => {
      if (event.key !== 'Escape' || !active.current) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
      setMessage(latest.current.t('lifeplanner.moveCancelled'));
    };
    const blur = () => cancel();
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); cancel(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleProps(group, id, title, disabled = false) {
    return {
      type: 'button', disabled, className: 'lp-block-handle',
      'aria-label': latest.current.t('lifeplanner.moveBlock', { title }),
      'aria-describedby': descriptionId,
      title: latest.current.t('lifeplanner.handleHint'),
      onPointerDown(event) {
        if (disabled || event.button !== 0 || !event.isPrimary) return;
        if (active.current) cancel();
        const handle = event.currentTarget;
        active.current = { group, id, title, handle, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
          pointerId: event.pointerId, ids: rows(group).map(el => el.dataset.lpSort), dragging: false };
        handle.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        const a = active.current;
        if (!a || a.keyboard || event.pointerId !== a.pointerId) return;
        a.x = event.clientX; a.y = event.clientY;
        if (!a.dragging && Math.hypot(a.x - a.startX, a.y - a.startY) > 5) {
          a.dragging = true;
          a.handle.closest('[data-lp-sort]').dataset.lpDragging = 'true';
          scrollTick();
        }
      },
      onPointerUp(event) {
        const a = active.current;
        if (!a || a.keyboard || event.pointerId !== a.pointerId) return;
        if (a.dragging) { event.preventDefault(); drop(); }
        else { cancel(); latest.current.onMenu?.(group, id); }
      },
      onPointerCancel: cancel,
      onLostPointerCapture() { if (active.current && !active.current.keyboard) cancel(); },
      onKeyDown(event) {
        const a = active.current;
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault(); event.stopPropagation();
          if (a?.keyboard) drop();
          else {
            active.current = { group, id, title, handle: event.currentTarget, ids: rows(group).map(el => el.dataset.lpSort), keyboard: true, targetId: id, after: false };
            event.currentTarget.closest('[data-lp-sort]').dataset.lpDragging = 'true';
            setMessage(latest.current.t('lifeplanner.moveInstructions'));
          }
        } else if (a?.keyboard && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const list = rows(group), current = list.findIndex(el => el.dataset.lpSort === a.targetId);
          const position = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
          mark(list[position], position > list.findIndex(el => el.dataset.lpSort === id));
          list[position]?.scrollIntoView({ block: 'nearest' });
          setMessage(latest.current.t('lifeplanner.movePosition', { number: position + 1 }));
        } else if (event.key === 'F10' && event.shiftKey) {
          event.preventDefault(); latest.current.onMenu?.(group, id);
        }
      },
      onClick(event) { if (event.detail === 0 && !active.current) latest.current.onMenu?.(group, id); },
    };
  }
  return { handleProps, descriptionId, message, cancel };
}
