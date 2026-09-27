import React from 'react';
import { Trash2 } from 'lucide-react';

// The presentation is deliberately separate from the sortable row.  Keeping
// the preview pointer-transparent means the existing hit testing can continue
// to use elementFromPoint while the item appears to lift from the notebook.
export default function DragPresentation({ active, owner, overTrash, onTrashClick, trashLabel, dropToTrashLabel }) {
  const dragging = !!active?.dragging || !!active?.keyboard;
  const title = String(active?.title || '').trim();
  const left = Number.isFinite(active?.x) ? active.x + 14 : 20;
  const top = Number.isFinite(active?.y) ? active.y + 14 : 20;
  return <div className="lp-drag-presentation" data-lp-drag-presentation data-lp-drag-owner={owner} data-active={dragging ? 'true' : 'false'}>
    {dragging && <div className="lp-drag-ghost" style={{ transform: `translate3d(${left}px, ${top}px, 0)` }} aria-hidden="true">
      <span>{title}</span>
    </div>}
    <button type="button" className="lp-drag-trash" data-lp-trash data-over={overTrash ? 'true' : 'false'}
      disabled={!dragging} aria-disabled={!dragging} aria-label={overTrash ? dropToTrashLabel : trashLabel}
      title={overTrash ? dropToTrashLabel : trashLabel} onPointerDown={event => { if (dragging) event.preventDefault(); }} onClick={onTrashClick}>
      <Trash2 size={17} strokeWidth={1.8} />
    </button>
  </div>;
}
