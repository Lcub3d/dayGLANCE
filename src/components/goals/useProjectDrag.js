import { useCallback, useRef, useState } from 'react';

/**
 * Drag state for reassigning and reordering project cards in the Goals &
 * Projects space. One instance is shared by the sidebar (whose goal rows are
 * the cross-goal drop targets) and the main area (whose card slots are the
 * within-group reorder targets), so a card picked up in the main area can be
 * dropped on either.
 *
 * Two input paths feed the same state:
 *   - HTML5 drag events (desktop mouse): the card's grip is `draggable`, drop
 *     targets handle onDragOver/onDrop themselves and call moveProject.
 *   - Touch drag (iPad — the desktop layout runs there, and iOS WebKit never
 *     fires HTML5 drag events for touch): the drag is tracked in a ref and the
 *     drop target under the finger is resolved via elementFromPoint. Drop
 *     targets carry the move semantics in data-* attributes (data-move-goal:
 *     '' = standalone; optional data-move-before: a project id to insert
 *     before), so one handler covers goal rows, group containers and card
 *     slots. Two iOS gotchas force document-level listeners rather than
 *     React's onTouch* props: React's synthetic touchmove is passive (so
 *     e.preventDefault() is ignored), and the grip's draggable={true} would
 *     otherwise start a native iOS drag that hijacks the gesture — so we add
 *     touchmove with { passive: false } and cancel dragstart for the drag's
 *     life.
 *
 * `dropZoneTarget`: undefined = no cross-group target hovered, null = the
 * standalone group, string = a goal id.
 */
export default function useProjectDrag({ moveProject, projectCardRefs }) {
  const [dragProjectId, setDragProjectId] = useState(null);
  const [dropZoneTarget, setDropZoneTarget] = useState(undefined);
  // Which card to insert before during within-group reorder (null = append)
  const [dropInsertBeforeId, setDropInsertBeforeId] = useState(null);

  const startDrag = useCallback((e, projId) => {
    e.dataTransfer.effectAllowed = 'move';
    const cardEl = projectCardRefs.current[projId];
    if (cardEl) e.dataTransfer.setDragImage(cardEl, 30, 30);
    // Use setTimeout so React state update doesn't cancel the drag
    setTimeout(() => setDragProjectId(projId), 0);
  }, [projectCardRefs]);

  const endDrag = useCallback(() => {
    setDragProjectId(null);
    setDropZoneTarget(undefined);
    setDropInsertBeforeId(null);
  }, []);

  const touchDragRef = useRef({ active: false, projId: null, goalId: undefined, beforeId: null });

  const finishDragTouch = useCallback(() => {
    const st = touchDragRef.current;
    touchDragRef.current = { active: false, projId: null, goalId: undefined, beforeId: null };
    if (st.active && st.projId && st.goalId !== undefined) {
      moveProject(st.projId, st.goalId, st.beforeId || null);
    }
    endDrag();
  }, [moveProject, endDrag]);

  const startDragTouch = useCallback((projId) => () => {
    touchDragRef.current = { active: true, projId, goalId: undefined, beforeId: null };
    setDragProjectId(projId);

    const onMove = (moveEvent) => {
      const st = touchDragRef.current;
      if (!st.active) return;
      moveEvent.preventDefault(); // honoured: this listener is non-passive
      const touch = moveEvent.touches[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const target = el?.closest('[data-move-goal]');
      if (!target) return;
      const goalAttr = target.getAttribute('data-move-goal'); // '' = standalone
      const beforeAttr = target.getAttribute('data-move-before');
      const goalId = goalAttr === '' ? null : goalAttr;
      const beforeId = beforeAttr && beforeAttr !== st.projId ? beforeAttr : null;
      st.goalId = goalId;
      st.beforeId = beforeId;
      // Drive the same visual affordances as the mouse path.
      setDropInsertBeforeId(beforeId);
      setDropZoneTarget(beforeId ? undefined : goalId);
    };
    // Block the grip's draggable from starting a native iOS drag mid-gesture.
    const preventDrag = (de) => de.preventDefault();
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('dragstart', preventDrag);
      finishDragTouch();
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('dragstart', preventDrag);
  }, [finishDragTouch]);

  /** Props for a ProjectCard's grip so it can be picked up by mouse or touch. */
  const dragHandleProps = useCallback((projId) => ({
    draggable: true,
    onDragStart: (e) => startDrag(e, projId),
    onDragEnd: endDrag,
    onTouchStart: startDragTouch(projId),
  }), [startDrag, endDrag, startDragTouch]);

  return {
    dragProjectId,
    dropZoneTarget, setDropZoneTarget,
    dropInsertBeforeId, setDropInsertBeforeId,
    endDrag,
    dragHandleProps,
  };
}
