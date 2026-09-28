import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Forward, X } from 'lucide-react';
import { dateToString } from '../../utils/taskUtils.js';
import { appendCarriedTasks, carryForwardCandidates, carryForwardTask } from '../../jobo/carryForward.js';

function CarryDialog({ ctx, records, tasks, t, onClose }) {
  const dialog = useRef(null);
  const busy = useRef(false);
  const now = new Date();
  const visible = task => !ctx.isVisibleForUser || ctx.isVisibleForUser(task);
  const candidates = carryForwardCandidates({ tasks: tasks.filter(visible), inbox: ctx.unscheduledTasks, records,
    now: { date: dateToString(now), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` } });
  const [chosen, setChosen] = useState(() => candidates.map(item => item.token));
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  const selected = candidates.filter(item => chosen.includes(item.token));
  const submit = () => {
    if (busy.current || !selected.length) return;
    busy.current = true;
    const stamp = new Date().toISOString();
    const additions = selected.map(item => carryForwardTask(item, crypto.randomUUID(), stamp));
    ctx.pushUndo?.();
    ctx.setUnscheduledTasks(inbox => appendCarriedTasks(inbox, tasks, additions));
    onClose();
  };
  return createPortal(<div className="jobo-s5-modal-mask" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`jobo-s5-dialog jobo-carry-dialog ${ctx.cardBg} ${ctx.textPrimary} border ${ctx.borderClass}`} role="dialog" aria-modal="true" aria-labelledby="jobo-carry-title" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const fields = [...dialog.current.querySelectorAll('button:not(:disabled),input')];
        if (document.activeElement === (event.shiftKey ? fields[0] : fields.at(-1))) { event.preventDefault(); (event.shiftKey ? fields.at(-1) : fields[0])?.focus(); }
      }
    }}>
      <div className="jobo-s5-dialog-head"><h2 id="jobo-carry-title">Carry Forward</h2><button type="button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button></div>
      <p className="jobo-s5-dialog-note">{t('jobo.view.carryHint')}</p>
      {!candidates.length ? <p className="jobo-carry-empty">{t('jobo.view.carryEmpty')}</p> : <>
        <label className="jobo-carry-all"><input type="checkbox" checked={selected.length === candidates.length} onChange={event => setChosen(event.target.checked ? candidates.map(item => item.token) : [])} />{t('common.selectAll', { defaultValue: 'Select all' })}</label>
        <div className="jobo-carry-list">{candidates.map(item => <label key={item.token}><input type="checkbox" checked={chosen.includes(item.token)} onChange={event => setChosen(previous => event.target.checked ? [...previous, item.token] : previous.filter(token => token !== item.token))} /><span><b>{item.task.title}</b><small>{item.date} · {t(item.kind === 'notStarted' ? 'jobo.view.summary.notStarted' : `jobo.view.progress.${item.kind}`)}</small></span></label>)}</div>
      </>}
      <div className="jobo-s5-dialog-actions"><button type="button" onClick={onClose}>{t('common.cancel')}</button><button type="button" className="jobo-s5-save-button" disabled={!selected.length} onClick={submit}>{t('jobo.view.carryToInbox', { count: selected.length })}</button></div>
    </section>
  </div>, document.body);
}

export default function CarryForward(props) {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}><Forward size={14} />Carry Forward</button>{open && <CarryDialog {...props} onClose={() => setOpen(false)} />}</>;
}
