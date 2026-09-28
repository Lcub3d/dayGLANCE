import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';

export default function OrganizerDialog({ title, children, onClose, dirty = false, busy = false }) {
  const { t } = useTranslation(), f = useFeaturesCtx(), ref = useRef(null), status = useRef({});
  status.current = { dirty, busy, onClose };
  const canLeave = () => !status.current.busy && (!status.current.dirty || window.confirm(t('organizer.discard')));
  const close = () => { if (canLeave()) status.current.onClose(); };
  useEffect(() => {
    const previous = document.activeElement;
    (ref.current?.querySelector('input,textarea,select') || ref.current?.querySelector('button'))?.focus();
    const unregister = f.registerJobuNavigationGuard?.(canLeave);
    const unload = e => { if (status.current.dirty || status.current.busy) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    const keys = event => {
      // A temporarily disabled async checkbox can lose DOM focus. Escape must
      // still close this dialog, not leak to the underlying calendar shortcuts.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'Tab' && !ref.current?.contains(document.activeElement)) {
        event.preventDefault(); event.stopPropagation(); ref.current?.querySelector('input:not(:disabled),button:not(:disabled)')?.focus();
      }
    };
    document.addEventListener('keydown', keys, true);
    return () => { unregister?.(); window.removeEventListener('beforeunload', unload); document.removeEventListener('keydown', keys, true); if (previous?.isConnected) previous.focus(); };
  // Callback identity changes during typing must not reinstall focus/guards.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="jobu-dialog-backdrop ju-organizer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }} onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const controls = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(x => x.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); ref.current.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }}>
    <section ref={ref} tabIndex={-1} className="jobu-dialog ju-organizer-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ju-organizer-heading"><h2>{title}</h2><button type="button" disabled={busy} onClick={close} aria-label={t('common.close')}>×</button></div>
      {children}
    </section>
  </div>;
}
