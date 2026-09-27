import { createElement, useEffect, useId, useRef, useState } from 'react';
import DragPresentation from './DragPresentation.jsx';
import './notebookDrag.css';

// Handle-only Pointer Events: text remains selectable, normal touch scrolling
// remains native, and dragging commits once on drop rather than on every move.
export default function useNotebookDrag(root, { onMove, onMenu, onTrash, getSelectedIds, t }) {
  const active = useRef(null), latest = useRef({ onMove, onMenu, onTrash, getSelectedIds, t });
  latest.current = { onMove, onMenu, onTrash, getSelectedIds, t };
  const [message, setMessage] = useState('');
  const [dragView, setDragView] = useState(null);
  const descriptionId = useId();
  const raf = useRef(null);
  const viewFrame = useRef(null);
  const viewFrameType = useRef(null);
  const viewRef = useRef(null);
  const rows = group => [...(root.current?.querySelectorAll('[data-lp-sort]') || [])].filter(el => el.dataset.lpGroup === group);
  function cancelViewFrame() {
    if (viewFrame.current === null) return;
    if (viewFrameType.current === 'raf') window.cancelAnimationFrame(viewFrame.current);
    else window.clearTimeout(viewFrame.current);
    viewFrame.current = null; viewFrameType.current = null;
  }
  function publishView(value, immediate = false) {
    viewRef.current = value ? { ...value } : null;
    if (immediate) {
      cancelViewFrame();
      setDragView(viewRef.current ? { ...viewRef.current } : null);
      return;
    }
    if (viewFrame.current !== null) return;
    const update = () => {
      viewFrame.current = null; viewFrameType.current = null;
      setDragView(viewRef.current ? { ...viewRef.current } : null);
    };
    if (typeof window.requestAnimationFrame === 'function') {
      viewFrameType.current = 'raf'; viewFrame.current = window.requestAnimationFrame(update);
    } else {
      viewFrameType.current = 'timeout'; viewFrame.current = window.setTimeout(update, 0);
    }
  }
  function syncView(item) {
    publishView({ group: item.group, id: item.id, title: item.title, x: item.x, y: item.y,
      dragging: !!item.dragging, keyboard: !!item.keyboard, overTrash: !!item.overTrash, count: item.movingIds?.length || 1 });
  }
  function focusHandle(item) {
    if (item?.handle?.isConnected) item.handle.focus({ preventScroll: true });
  }
  function clean() {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    root.current?.querySelectorAll('[data-lp-dragging], [data-lp-drop]').forEach(el => {
      delete el.dataset.lpDragging; delete el.dataset.lpDrop;
    });
  }
  function cancel(restoreFocus = true) {
    const item = active.current;
    active.current = null; clean(); publishView(null, true);
    if (restoreFocus) focusHandle(item);
  }
  function mark(target, after) {
    root.current?.querySelectorAll('[data-lp-drop]').forEach(el => delete el.dataset.lpDrop);
    if (target && active.current) {
      target.dataset.lpDrop = after ? 'after' : 'before';
      active.current.targetId = target.dataset.lpSort;
      active.current.after = after;
    }
  }
  function ownTrashAt(x, y) {
    if (!root.current || typeof document.elementFromPoint !== 'function') return false;
    const hit = document.elementFromPoint(x, y)?.closest?.('[data-lp-trash]');
    const presentation = hit?.closest?.('[data-lp-drag-presentation]');
    return !!(hit && presentation && presentation.dataset.lpDragOwner === descriptionId && root.current.contains(presentation));
  }
  function locate() {
    const a = active.current;
    if (!a || !a.dragging || a.keyboard) return;
    if (ownTrashAt(a.x, a.y)) {
      mark(null, false); a.targetId = null; a.overTrash = true; syncView(a); return;
    }
    a.overTrash = false;
    const hit = document.elementFromPoint(a.x, a.y)?.closest('[data-lp-sort]');
    if (hit?.dataset.lpGroup === a.group && !a.movingIds?.includes(hit.dataset.lpSort)) mark(hit, a.y > hit.getBoundingClientRect().top + hit.getBoundingClientRect().height / 2);
    else { mark(null, false); a.targetId = null; }
    syncView(a);
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
    active.current = null; clean(); publishView(null, true);
    if (!a) return;
    if (a.overTrash) {
      let ok = false;
      try { ok = typeof latest.current.onTrash === 'function' ? await latest.current.onTrash(a.group, a.id, a.ids, a.movingIds) !== false : false; }
      catch { ok = false; }
      setMessage(latest.current.t(ok ? 'lifeplanner.removed' : 'lifeplanner.moveFailed', { title: a.title }));
      focusHandle(a); return;
    }
    if (!a.targetId || a.targetId === a.id || a.movingIds?.includes(a.targetId)) { focusHandle(a); return; }
    const ok = await latest.current.onMove(a.group, a.id, a.targetId, a.after, a.ids, a.movingIds);
    setMessage(latest.current.t(ok === false ? 'lifeplanner.moveFailed' : 'lifeplanner.moved', { title: a.title }));
    focusHandle(a);
  }
  function requestTrash() {
    const a = active.current;
    if (!a || (!a.dragging && !a.keyboard)) return;
    a.overTrash = true;
    drop();
  }
  useEffect(() => {
    // This listener is registered before the workspace focus hook, so Escape
    // cancels a drag without unexpectedly closing the notebook.
    const escape = event => {
      if (event.key !== 'Escape' || !active.current) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
      setMessage(latest.current.t('lifeplanner.moveCancelled'));
    };
    const blur = () => cancel(false);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); cancel(false); cancelViewFrame(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleProps(group, id, title, disabled = false) {
    return {
      type: 'button', disabled, className: 'lp-block-handle',
      'aria-label': latest.current.t('lifeplanner.moveBlock', { title }),
      'aria-describedby': descriptionId,
      title: latest.current.t('lifeplanner.handleHint'),
      onPointerDown(event) {
        if (disabled || event.button !== 0 || !event.isPrimary) return;
        if (active.current) cancel(false);
        const handle = event.currentTarget;
        const allIds = rows(group).map(el => el.dataset.lpSort);
        const requested = latest.current.getSelectedIds?.(group, id) || [];
        const movingIds = allIds.filter(itemId => requested.includes(itemId));
        if (!movingIds.includes(id)) movingIds.push(id);
        movingIds.sort((a, b) => allIds.indexOf(a) - allIds.indexOf(b));
        active.current = { group, id, title, handle, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
          pointerId: event.pointerId, ids: allIds, movingIds, dragging: false, overTrash: false };
        handle.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        const a = active.current;
        if (!a || a.keyboard || event.pointerId !== a.pointerId) return;
        a.x = event.clientX; a.y = event.clientY;
        if (!a.dragging && Math.hypot(a.x - a.startX, a.y - a.startY) > 5) {
          a.dragging = true;
          a.handle.closest('[data-lp-sort]').dataset.lpDragging = 'true';
          syncView(a);
          scrollTick();
        }
      },
      onPointerUp(event) {
        const a = active.current;
        if (!a || a.keyboard || event.pointerId !== a.pointerId) return;
        a.x = event.clientX; a.y = event.clientY;
        if (a.dragging) { event.preventDefault(); locate(); drop(); }
        else { cancel(false); latest.current.onMenu?.(group, id); }
      },
      onPointerCancel: () => cancel(),
      onLostPointerCapture() { if (active.current && !active.current.keyboard) cancel(); },
      onKeyDown(event) {
        const a = active.current;
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault(); event.stopPropagation();
          if (a?.keyboard) drop();
          else {
            const row = event.currentTarget.closest('[data-lp-sort]');
            const rect = row?.getBoundingClientRect();
            const allIds = rows(group).map(el => el.dataset.lpSort);
            const requested = latest.current.getSelectedIds?.(group, id) || [];
            const movingIds = allIds.filter(itemId => requested.includes(itemId));
            if (!movingIds.includes(id)) movingIds.push(id);
            movingIds.sort((a, b) => allIds.indexOf(a) - allIds.indexOf(b));
            active.current = { group, id, title, handle: event.currentTarget, ids: allIds, movingIds, keyboard: true, targetId: id, after: false, overTrash: false,
              x: rect?.left ?? 0, y: Math.max(0, (rect?.top ?? 0) - 42) };
            row?.setAttribute('data-lp-dragging', 'true');
            syncView(active.current);
            setMessage(latest.current.t('lifeplanner.moveInstructions'));
          }
        } else if (a?.keyboard && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const list = rows(group), current = list.findIndex(el => el.dataset.lpSort === a.targetId);
          const position = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
          const target = list[position];
          mark(target, position > list.findIndex(el => el.dataset.lpSort === id));
          target?.scrollIntoView({ block: 'nearest' });
          const rect = target?.getBoundingClientRect();
          if (rect) { a.x = rect.left; a.y = Math.max(0, rect.top - 42); syncView(a); }
          setMessage(latest.current.t('lifeplanner.movePosition', { number: position + 1 }));
        } else if (a?.keyboard && ['Delete', 'Backspace'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); a.overTrash = true; drop();
        } else if (event.key === 'F10' && event.shiftKey) {
          event.preventDefault(); latest.current.onMenu?.(group, id);
        }
      },
      onClick(event) { if (event.detail === 0 && !active.current) latest.current.onMenu?.(group, id); },
    };
  }
  const fallbackDelete = latest.current.t('lifeplanner.delete');
  const presentation = createElement(DragPresentation, {
    active: dragView,
    owner: descriptionId,
    overTrash: !!dragView?.overTrash,
    onTrashClick: requestTrash,
    trashLabel: latest.current.t('lifeplanner.moveToTrash', { defaultValue: fallbackDelete }),
    dropToTrashLabel: latest.current.t('lifeplanner.dropToTrash', { defaultValue: fallbackDelete }),
  });
  return { handleProps, descriptionId, message, cancel, presentation };
}
