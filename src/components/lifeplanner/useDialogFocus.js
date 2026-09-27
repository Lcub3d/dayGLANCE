import { useEffect, useRef } from 'react';

// One active sheet at a time. Returning focus to its trigger is important when
// coming back from a nested vision/project editor. Native global hotkeys remain
// inert while this workspace is open (also guarded in useKeyboardShortcuts).
export default function useDialogFocus(ref, onClose, active = true) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    const root = ref.current;
    if (!root) return;
    const controls = () => [...root.querySelectorAll('button, input, textarea, select, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length > 0);
    (root.querySelector('[data-initial-focus]') || controls()[0] || root).focus({ preventScroll: true });
    const keydown = event => {
      if (event.key === 'Escape' && !event.target.closest('[data-inline-edit]')) {
        event.preventDefault(); event.stopImmediatePropagation(); close.current(); return;
      }
      if (event.key !== 'Tab') return;
      const list = controls(), first = list[0], last = list.at(-1);
      if (!first) { event.preventDefault(); root.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !list.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !list.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}
