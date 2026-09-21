import { createElement, useEffect, useRef, useState } from 'react';
import SelectionPresentation from './SelectionPresentation.jsx';

const EMPTY = Object.freeze({ group: null, ids: [] });

function isInteractive(target) {
  return !!target?.closest?.('textarea, input, select, button, a, [contenteditable="true"]');
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function marqueeRect(start, current) {
  const left = Math.min(start.x, current.x), top = Math.min(start.y, current.y);
  const right = Math.max(start.x, current.x), bottom = Math.max(start.y, current.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export default function useNotebookSelection(root, { onContextMenu, onMove, onClear, enabled = true } = {}) {
  const [selection, setSelection] = useState(EMPTY);
  const [marquee, setMarquee] = useState(null);
  const selectionRef = useRef(EMPTY);
  const anchorRef = useRef(null);
  const marqueeRef = useRef(null);
  const latest = useRef({ onContextMenu, onMove, onClear, enabled });
  latest.current = { onContextMenu, onMove, onClear, enabled };

  const rows = () => [...(root.current?.querySelectorAll('[data-lp-sort]') || [])];
  const rowIds = group => rows().filter(row => row.dataset.lpGroup === group).map(row => row.dataset.lpSort);
  const apply = next => {
    selectionRef.current = next.ids.length ? { group: next.group, ids: next.ids } : EMPTY;
    setSelection(selectionRef.current);
  };
  const clear = () => {
    const hadSelection = selectionRef.current.ids.length > 0;
    anchorRef.current = null; apply(EMPTY);
    if (hadSelection) latest.current.onClear?.();
  };
  const selectedIds = group => selectionRef.current.group === group ? [...selectionRef.current.ids] : [];
  const activeGroup = selection.group;
  function selectOne(group, id) {
    anchorRef.current = { group, id }; apply({ group, ids: [id] });
  }
  function toggle(group, id) {
    const current = selectedIds(group);
    anchorRef.current = { group, id };
    apply({ group, ids: current.includes(id) ? current.filter(item => item !== id) : [...current, id] });
  }
  function range(group, id) {
    const all = rowIds(group), anchor = anchorRef.current?.group === group ? anchorRef.current.id : id;
    const from = all.indexOf(anchor), to = all.indexOf(id);
    if (from < 0 || to < 0) return selectOne(group, id);
    anchorRef.current = { group, id };
    apply({ group, ids: all.slice(Math.min(from, to), Math.max(from, to) + 1) });
  }
  function isSelected(group, id) {
    return selectionRef.current.group === group && selectionRef.current.ids.includes(id);
  }
  function rowProps(group, id) {
    const selected = isSelected(group, id);
    return {
      'data-lp-selected': selected ? 'true' : undefined,
      'aria-selected': selected ? 'true' : undefined,
      onPointerDownCapture(event) {
        if (!latest.current.enabled || event.button !== 0 || !event.isPrimary || (!event.shiftKey && !event.ctrlKey && !event.metaKey) || !event.target.closest?.('.lp-block-handle')) return;
        event.preventDefault(); event.stopPropagation();
        if (event.shiftKey) range(group, id);
        else toggle(group, id);
      },
      onPointerDown(event) {
        if (!latest.current.enabled || event.currentTarget !== event.target || event.button !== 0 || !event.isPrimary || isInteractive(event.target)) return;
        if (event.shiftKey) range(group, id);
        else if (event.ctrlKey || event.metaKey) toggle(group, id);
        else selectOne(group, id);
        event.stopPropagation();
      },
      onContextMenu(event) {
        if (!latest.current.enabled) return;
        const blockHandle = event.target.closest?.('.lp-block-handle');
        if (isInteractive(event.target) && !blockHandle && !event.ctrlKey && !event.metaKey) return;
        const ids = isSelected(group, id) ? selectedIds(group) : [id];
        if (!isSelected(group, id)) selectOne(group, id);
        if (latest.current.onContextMenu) {
          event.preventDefault();
          latest.current.onContextMenu(group, id, event, ids);
        }
      },
    };
  }
  function finishMarquee(event) {
    const active = marqueeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    marqueeRef.current = null; setMarquee(null);
    if (!active.moved) {
      if (!active.row) return;
      if (active.shiftKey) range(active.row.group, active.row.id);
      else if (active.additive) toggle(active.row.group, active.row.id);
      else selectOne(active.row.group, active.row.id);
      return;
    }
    const rect = marqueeRect(active.start, { x: event.clientX, y: event.clientY });
    const hits = rows().filter(row => intersects(rect, row.getBoundingClientRect()));
    if (!hits.length) { if (!active.additive) clear(); return; }
    const counts = new Map();
    hits.forEach(row => counts.set(row.dataset.lpGroup, (counts.get(row.dataset.lpGroup) || 0) + 1));
    const group = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const ids = hits.filter(row => row.dataset.lpGroup === group).map(row => row.dataset.lpSort);
    const current = active.additive && selectionRef.current.group === group ? selectionRef.current.ids : [];
    anchorRef.current = { group, id: ids[0] };
    apply({ group, ids: [...new Set([...current, ...ids])] });
  }
  const rootProps = {
    'data-lp-selection-surface': '',
    onPointerDown(event) {
      if (!latest.current.enabled || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch' || isInteractive(event.target)) return;
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) clear();
      marqueeRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false,
        additive: event.shiftKey || event.ctrlKey || event.metaKey, shiftKey: event.shiftKey,
        row: event.target.closest?.('[data-lp-sort]') ? { group: event.target.closest('[data-lp-sort]').dataset.lpGroup, id: event.target.closest('[data-lp-sort]').dataset.lpSort } : null };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event) {
      if (!latest.current.enabled) return;
      const active = marqueeRef.current;
      if (!active || event.pointerId !== active.pointerId) return;
      active.moved = active.moved || Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) > 4;
      if (active.moved) setMarquee(marqueeRect(active.start, { x: event.clientX, y: event.clientY }));
    },
    onPointerUp: finishMarquee,
    onPointerCancel(event) {
      if (marqueeRef.current?.pointerId === event.pointerId) { marqueeRef.current = null; setMarquee(null); }
    },
  };
  function moveSelected(delta) {
    const group = selectionRef.current.group;
    const all = group ? rowIds(group) : [];
    const movingIds = all.filter(id => selectionRef.current.ids.includes(id));
    if (!group || !movingIds.length) return false;
    const indexes = movingIds.map(id => all.indexOf(id));
    const targetIndex = delta < 0 ? Math.min(...indexes) - 1 : Math.max(...indexes) + 1;
    if (targetIndex < 0 || targetIndex >= all.length) return false;
    const targetId = all[targetIndex], after = delta > 0;
    const args = [group, movingIds[0], targetId, after, all, movingIds];
    return latest.current.onMove ? latest.current.onMove(...args) : { group, id: movingIds[0], targetId, after, expectedIds: all, movingIds };
  }
  useEffect(() => {
    if (!enabled) { clear(); return undefined; }
    const escape = event => {
      if (event.key !== 'Escape' || !selectionRef.current.ids.length) return;
      event.preventDefault(); event.stopImmediatePropagation(); clear();
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const group = selectionRef.current.group;
    if (!group || !selectionRef.current.ids.length) return;
    const available = new Set(rowIds(group));
    const ids = selectionRef.current.ids.filter(id => available.has(id));
    if (ids.length === selectionRef.current.ids.length) return;
    if (ids.length) apply({ group, ids });
    else clear();
  });
  return { rootProps, rowProps, selectedIds, activeGroup, moveSelected, clear, toggle, range,
    presentation: createElement(SelectionPresentation, { marquee }), selection };
}
