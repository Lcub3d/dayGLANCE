import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatDuration } from '../../utils/formatDuration.js';

export default function DraftDoCard({ draft, style, ctx, t, onCommit, onCancel, canLinkPlan = false, onLinkPlan }) {
  const [title, setTitle] = useState(draft.title || '');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  useEffect(() => { if (draft.accepted) setTitle(draft.title || ''); }, [draft.accepted, draft.title]);
  const submit = async () => {
    if (!title.trim() || submitting.current || draft.accepted) return;
    submitting.current = true;
    setSaving(true);
    const accepted = await onCommit(draft, title.trim());
    if (!accepted) { submitting.current = false; setSaving(false); }
  };
  const linkable = canLinkPlan && !title.trim() && !saving && !draft.accepted;
  const linkPlan = async (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!linkable || submitting.current) return;
    submitting.current = true; setSaving(true);
    const accepted = await onLinkPlan(draft);
    if (!accepted) { submitting.current = false; setSaving(false); }
  };
  const clock = (minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return <article className="jobo-s5-card jobo-s5-draft-card bg-purple-500 text-white rounded-lg" style={style} data-jobo-card={draft.id} data-jobo-draft title={!title.trim() ? t('jobo.view.linkBlankDoHint') : undefined}
    onDragOver={(event) => { event.stopPropagation(); if (linkable) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={linkPlan}>
    <div className="jobo-s5-title-row">
      <span title={t('jobo.view.progress.started')} aria-label={t('jobo.view.progress.started')}>○</span>
      <input autoFocus={!draft.accepted} className="jobo-s5-draft-title" aria-label={t('jobo.view.draftDoTitle')}
        placeholder={t('jobo.view.draftDoTitle')} value={title} disabled={draft.accepted || saving}
        onChange={event => setTitle(event.target.value)} onBlur={submit}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); submit(); } if (event.key === 'Escape' && !submitting.current) { event.preventDefault(); onCancel(draft.id); } }} />
      {!draft.accepted && <button type="button" className="jobo-s5-card-action jobo-s5-hover-actions" aria-label={t('common.cancel')} disabled={saving}
        onMouseDown={event => event.preventDefault()} onClick={() => { if (!submitting.current) onCancel(draft.id); }}><X size={13} /></button>}
    </div>
    <div className="jobo-s5-meta-row"><span>{ctx.formatTime(clock(draft.startMinute))}–{ctx.formatTime(clock(draft.endMinute))}</span><span>{formatDuration(draft.duration, t)}</span></div>
  </article>;
}
