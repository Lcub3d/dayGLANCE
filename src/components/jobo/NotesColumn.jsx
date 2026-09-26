import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Minus, Pencil, Plus } from 'lucide-react';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { writePlanNotes, writeDailyNotes } from '../../jobo/nativePlanAdapter.js';

function NoteTile({ title, subtitle, text, color, editable, onSave, t, link, onFocus, request, selected }) {
  const [expanded, setExpanded] = useState(!!text);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [openedText, setOpenedText] = useState(text);
  const [height, setHeight] = useState(180);
  const ref = useRef(null);
  const textarea = useRef(null);
  const changed = text !== openedText;
  const edit = () => { setDraft(text); setOpenedText(text); setExpanded(true); setEditing(true); };
  useEffect(() => {
    if (request?.key !== link) return;
    setExpanded(true);
    if (editable) { setDraft(text); setOpenedText(text); setEditing(true); }
    const frame = requestAnimationFrame(() => { ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (editable) textarea.current?.focus(); else ref.current?.focus(); });
    return () => cancelAnimationFrame(frame);
    // A new request is an explicit navigation action, not an external note refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  return <section ref={ref} tabIndex={-1} style={expanded ? { height } : undefined}
    className={`jobo-s5-note-tile rounded-lg ${color || 'jobo-s5-daily-note'} ${expanded ? 'is-open' : 'is-collapsed'} ${selected ? 'jobo-s5-selected' : ''}`}
    data-jobo-note-link={link} onFocus={() => onFocus({ task: link })}
    onMouseEnter={() => onFocus({ task: link })} onMouseLeave={() => onFocus(null)}>
    <div className="jobo-s5-note-title">
      <button type="button" className="jobo-s5-card-action" aria-expanded={expanded} aria-label={`${t('jobo.view.toggleNote')}: ${title}`} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      <FileText size={13} /><b title={title}>{renderTitleWithoutTags(title)}{subtitle && <small className="jobo-s5-note-source-date">{subtitle}</small>}</b>
      {editable && !editing && <button type="button" className="jobo-s5-card-action" onClick={edit} aria-label={`${t('common.edit')}: ${title}`}><Pencil size={13} /></button>}
    </div>
    {expanded && <>
      {editing ? <form onSubmit={(event) => { event.preventDefault(); if (!changed && onSave(draft)) setEditing(false); }}>
        <textarea ref={textarea} aria-label={`${t('task.notes')}: ${title}`} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
        {changed && <p role="alert">{t('jobo.view.recordChanged')}</p>}
        <div className="jobo-s5-note-actions"><button type="button" onClick={() => setEditing(false)}>{t('common.cancel')}</button><button type="submit" disabled={changed}>{t('common.save')}</button></div>
      </form> : <div className="jobo-s5-note-text">{text || t('common.empty')}</div>}
      <div className="jobo-s5-note-size"><button type="button" disabled={height <= 120} aria-label={t('jobo.view.shrinkNote')} onClick={() => setHeight(value => Math.max(120, value - 60))}><Minus size={12} /></button><button type="button" disabled={height >= 960} aria-label={t('jobo.view.growNote')} onClick={() => setHeight(value => Math.min(960, value + 60))}><Plus size={12} /></button></div>
    </>}
  </section>;
}

export default function NotesColumn({ tasks, date, ctx, t, onFocus, request, focus }) {
  const seen = new Set();
  const noteTasks = tasks.filter(task => { if (!task?.id || seen.has(String(task.id))) return false; seen.add(String(task.id)); return true; });
  return <aside className={`jobo-s5-notes-column border-l ${ctx.borderClass}`} data-jobo-notes>
    <NoteTile key={`daily:${date}`} title={t('common.dailyNote')} text={ctx.dailyNotes?.[date]?.text || ''} editable t={t} link={`daily:${date}`}
      onSave={text => writeDailyNotes(ctx, date, text)} onFocus={onFocus} request={request} />
    {noteTasks.map(task => <NoteTile key={String(task.id)} title={task.title} subtitle={task.recurringTemplateId ? task.date : null} text={task.notes || ''}
      color={`${task.color || 'bg-blue-500'} text-white`} editable={!task.imported && !task.isJoboSyntheticOccurrence} t={t} link={String(task.id)} selected={focus?.task === String(task.id)}
      onSave={text => writePlanNotes(ctx, task, text)} onFocus={onFocus} request={request} />)}
  </aside>;
}
