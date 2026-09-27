import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import NotesSubtasksPanel from '../NotesSubtasksPanel.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { extractWikilinks } from '../../utils/taskUtils.js';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';

// The native panel owns formatting, task notes, subtasks and Obsidian links.
// This wrapper only places it; it does not keep another note draft or writer.
export default function JoboTaskNotes({ task, anchor, ctx, t, onClose }) {
  const sync = useSyncCtx() || {};
  const features = useFeaturesCtx();
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 80 });
  useLayoutEffect(() => {
    const place = () => {
      const box = anchor?.isConnected ? anchor.getBoundingClientRect() : { left: 8, bottom: 80, top: 80 };
      const panel = ref.current?.getBoundingClientRect();
      if (!panel) return;
      setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - panel.width - 8)),
        top: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - panel.height - 8)) });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(ref.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);
  useEffect(() => {
    const previous = anchor || document.activeElement;
    ref.current?.focus();
    const close = event => { if (!ref.current?.contains(event.target) && !anchor?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('pointerdown', close); if (previous?.isConnected) previous.focus(); };
  }, [anchor, onClose]);
  const wikilinks = extractWikilinks(task.title);
  return createPortal(<section ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-label={`${t('task.notes')}: ${task.title}`}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    className={`notes-panel-container fixed z-50 w-80 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg shadow-xl ${task.color || 'bg-blue-500'} text-white`}
    style={position}>
    <div className="flex items-center justify-between gap-2 p-3 pb-0"><b className="truncate text-sm">{renderTitleWithoutTags(task.title)}</b>
      <button type="button" className="p-1 rounded hover:bg-white/10" aria-label={t('common.close')} onClick={onClose}><X size={16} /></button></div>
    <NotesSubtasksPanel key={task.id} task={task} isInbox={(ctx.unscheduledTasks || []).some(item => item.id === task.id)}
      darkMode={ctx.darkMode} updateTaskNotes={ctx.updateTaskNotes} addSubtask={ctx.addSubtask}
      toggleSubtask={ctx.toggleSubtask} deleteSubtask={ctx.deleteSubtask} updateSubtaskTitle={ctx.updateSubtaskTitle}
      compact={false} noAutoFocus aiConfig={features.aiConfig} aiSubtasksLoadingForTask={features.aiSubtasksLoadingForTask}
      onGenerateSubtasks={features.generateAISubtasks} wikilinks={wikilinks.length ? wikilinks : undefined}
      onLoadWikiNote={sync.loadWikiNote} onSaveWikiNote={sync.saveWikiNote} onOpenInObsidian={sync.openInObsidian} />
  </section>, document.body);
}
