import React, { useLayoutEffect, useRef, useState } from 'react';
import { GripVertical, Check, FolderPlus, Layers, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { FormOverlay, ProjectForm } from '../goals/GoalDashboard.jsx';
import { createVision, measureText, milestoneDate, parseVisionText, pretty, projectFields, saveVision, totalYears, uid, validateVision, years, MAX_VISION_STEPS } from '../../lifeplanner/model.js';
import useDialogFocus from './useDialogFocus.js';
import useNotebookDrag from './useNotebookDrag.js';
import { moveNotebookItem } from '../../lifeplanner/notebook.js';

export default function VisionEditor({ wish, original, seed = '', store, onClose, onOpenProject }) {
  const ctx = useDayPlannerCtx();
  const { projects, goals, addProject, setGoalsProjectsEnabled } = useFeaturesCtx();
  const { createProjectNote } = useSyncCtx();
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => original ? structuredClone(original) : createVision(seed));
  const [expected, setExpected] = useState(original || null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectStep, setProjectStep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState(false);
  const outcome = useRef(null);
  useLayoutEffect(() => {
    if (!outcome.current) return;
    outcome.current.style.height = '1px';
    outcome.current.style.height = `${Math.max(34, outcome.current.scrollHeight)}px`;
  }, [draft.title]);
  const saving = useRef(false);
  const root = useRef(null);
  const projectRoot = useRef(null);
  const initial = useRef(structuredClone(draft));
  const dirty = JSON.stringify(draft) !== JSON.stringify(expected || initial.current);
  const close = () => {
    if (saving.current) return;
    if (options) { setOptions(false); return; }
    if (!dirty || window.confirm(t('lifeplanner.discard'))) onClose();
  };
  const drag = useNotebookDrag(root, {
    t,
    onMove: (_group, id, targetId, after, expectedIds) => {
      try { field('steps', moveNotebookItem(draft.steps, id, targetId, after, expectedIds)); return true; }
      catch { setError(t('lifeplanner.errors.conflict')); return false; }
    },
  });
  useDialogFocus(root, close, !projectStep);
  useDialogFocus(projectRoot, () => setProjectStep(null), !!projectStep);
  const metric = parseVisionText(draft.title);
  const field = (key, value) => setDraft(v => ({ ...v, [key]: value }));
  const stageField = (id, key, value) => setDraft(v => ({ ...v, steps: v.steps.map(s => s.id === id ? { ...s, [key]: value } : s) }));
  const input = 'lp-input';
  const explainError = err => t(`lifeplanner.errors.${err.message}`, { defaultValue: t('lifeplanner.errors.unknown') });
  async function persist() {
    const invalid = validateVision(draft);
    if (invalid) { setError(explainError(new Error(invalid))); return null; }
    try {
      const next = await store.commit(doc => saveVision(doc, wish.id, draft, expected));
      const saved = next.wishes.find(w => w.id === wish.id).visions.find(v => v.id === draft.id);
      setExpected(saved); setDraft(structuredClone(saved)); setError('');
      return saved;
    } catch (err) { setError(explainError(err)); return null; }
  }
  async function save(event) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true);
    if (await persist()) onClose();
    saving.current = false; setBusy(false);
  }
  async function arrange(step) {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    const saved = await persist();
    if (saved) {
      const existing = projects.find(p => p.id === step.projectId);
      if (existing) onOpenProject(existing.id);
      else setProjectStep(saved.steps.find(s => s.id === step.id));
    }
    saving.current = false; setBusy(false);
  }
  async function createProject(fields) {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      // Reserve the stable native identity durably BEFORE inserting in native
      // state. Retry uses the same id, and addProject's optional id is idempotent.
      const projectId = projectStep.projectId || `life-${projectStep.id}`;
      const linked = { ...draft, steps: draft.steps.map(s => s.id === projectStep.id ? { ...s, projectId } : s) };
      const next = await store.commit(doc => saveVision(doc, wish.id, linked, expected));
      const saved = next.wishes.find(w => w.id === wish.id).visions.find(v => v.id === draft.id);
      setDraft(structuredClone(saved)); setExpected(saved);
      if (!projects.some(p => p.id === projectId)) {
        const { createNote, ...nativeFields } = fields;
        const milestone = measureText(draft.title, projectStep.value);
        const base = projectFields(wish, draft, projectStep, t('lifeplanner.projectDescription', {
          wish: wish.title, vision: draft.title, milestone, date: milestoneDate(draft, projectStep.id),
        }));
        const created = addProject({ ...base, ...nativeFields }, { id: projectId });
        setGoalsProjectsEnabled(true);
        if (createNote && created?.id) createProjectNote?.('project', created.id, { title: created.title, goalId: created.goalId });
      }
      setProjectStep(null); setNotice(t('lifeplanner.projectSaved')); setError('');
    } catch (err) { setError(explainError(err)); }
    saving.current = false; setBusy(false);
  }
  function timeFields(value, onChange, label, outer = false) {
    const units = ['year', 'month', 'day'];
    return <div className="lp-duration">
      {outer && <span className="sr-only">{t('lifeplanner.horizon')}</span>}
      <input className={input} type="number" min="1" step="1" value={value.amount}
        style={{ width: `${Math.max(2, String(value.amount).length + 1)}ch` }}
        aria-label={label} onChange={e => onChange('amount', e.target.value)} required />
      <select className={input} value={value.unit} aria-label={`${label} · ${t('lifeplanner.time')}`}
        style={{ width: `${Math.max(3, ...units.map(unit => t(`lifeplanner.${unit}`).length + 1))}ch` }}
        onChange={e => onChange('unit', e.target.value)}>
        {units.map(unit => <option key={unit} value={unit}>{t(`lifeplanner.${unit}`)}</option>)}
      </select>
      {outer && <span className="lp-duration-tail">{t('lifeplanner.within')}</span>}
    </div>;
  }
  function measureInput(value, onChange, label) {
    return <div className="lp-measure">
      <span>{metric.valid ? metric.prefix : ''}</span>
      <input type="number" step="any" className={input} aria-label={label} value={value}
        style={{ width: `${Math.min(18, Math.max(2, String(value).length + 1))}ch` }}
        onChange={e => onChange(e.target.value)} required />
      <span>{metric.valid ? metric.suffix : ''}</span>
    </div>;
  }
  const total = totalYears(draft), horizon = years(draft.amount, draft.unit);
  function appendStage() {
    const fraction = Math.min(1, (total + 1) / (horizon || 5));
    const current = Number(draft.current) || 0;
    field('steps', [...draft.steps, { id: uid(), value: Math.round((current + (metric.target - current) * fraction) * 100) / 100, amount: 1, unit: 'year' }]);
  }
  return <div className="lp-sheet-mask" data-life-vision onClick={event => { if (event.target === event.currentTarget && !projectStep && !busy) close(); }}>
    <form ref={root} className={`lp-vision-sheet ${ctx.darkMode ? 'lp-paper-dark' : ''}`} onSubmit={save}
      role="dialog" aria-modal={!projectStep} aria-label={t('lifeplanner.vision')} tabIndex={-1} inert={projectStep ? '' : undefined}>
      <div className="lp-vision-body" data-lp-scroll>
        <fieldset className="lp-note-fields" disabled={busy}>
          <div className="lp-outcome-row lp-note-line">
            <span className="lp-note-gutter" aria-hidden="true" />
            <textarea ref={outcome} rows={1} id="lp-outcome" data-initial-focus className="lp-note-outcome" aria-label={t('lifeplanner.outcome')}
              value={draft.title} maxLength={2000} placeholder={t('lifeplanner.outcomePlaceholder')} onChange={e => field('title', e.target.value)}
              onBlur={() => {
                const p = parseVisionText(draft.title);
                if (p.outcome !== draft.title.trim()) setDraft(v => ({ ...v, title: p.outcome, amount: p.amount, unit: p.unit }));
              }} required />
            {timeFields(draft, field, t('lifeplanner.horizon'), true)}
            <span className="lp-note-tools-space" />
          </div>
          <div className="lp-now lp-note-line"><span className="lp-note-gutter" aria-hidden="true" />
            {measureInput(draft.current, value => field('current', value), t('lifeplanner.current'))}
            <span className="lp-now-label">{t('lifeplanner.now')}</span><span className="lp-note-tools-space" />
          </div>
          <div className="lp-stages">
            {draft.steps.map((step, index) => {
              const existing = projects.find(p => p.id === step.projectId);
              const projectLabel = existing ? t('lifeplanner.openProject') : step.projectId ? t('lifeplanner.missingProject') : t('lifeplanner.project');
              return <div key={step.id} className="lp-stage lp-note-line" data-life-stage={step.id} data-lp-sort={step.id} data-lp-group="stages">
                <button {...drag.handleProps('stages', step.id, t('lifeplanner.milestone', { number: index + 1 }), busy)}><GripVertical size={14} /></button>
                {measureInput(step.value, value => stageField(step.id, 'value', value), t('lifeplanner.milestoneValue', { number: index + 1 }))}
                {timeFields(step, (key, value) => stageField(step.id, key, value), t('lifeplanner.stepDuration', { number: index + 1 }))}
                <div className="lp-note-actions">
                  <button type="button" disabled={busy} className={`lp-icon lp-project-link ${step.projectId ? 'lp-linked-project' : 'lp-row-action'}`}
                    title={projectLabel} aria-label={projectLabel} onClick={() => arrange(step)}>{existing ? <Layers size={14} /> : <FolderPlus size={14} />}</button>
                  <button type="button" disabled={busy} className="lp-icon lp-row-action" aria-label={t('lifeplanner.delete')}
                    title={t('lifeplanner.delete')} onClick={() => { if (!step.projectId || window.confirm(t('lifeplanner.removeConfirm'))) field('steps', draft.steps.filter(s => s.id !== step.id)); }}><Trash2 size={13} /></button>
                </div>
              </div>;
            })}
          </div>
          <div className="lp-note-tail"><button type="button" className="lp-add-stage" disabled={draft.steps.length >= MAX_VISION_STEPS || busy} onClick={appendStage}><Plus size={13} />{t('lifeplanner.addLine')}</button>
            {draft.steps.length > 0 && <output className="lp-total" aria-label={t('lifeplanner.totalTime')}>{t('lifeplanner.totalShort')} {Number.isFinite(total) ? pretty(total) : '—'} {t('lifeplanner.year')}</output>}
          </div>
        </fieldset>
        {error && !projectStep && <p role="alert" className="lp-error">{error}</p>}
        {notice && <p role="status" className="lp-note-notice">{notice}</p>}
      </div>
      <footer className="lp-sheet-footer">
        <div className="lp-note-options-anchor"><button type="button" className="lp-icon" aria-label={t('lifeplanner.noteOptions')}
          title={t('lifeplanner.noteOptions')} aria-expanded={options} onClick={() => setOptions(value => !value)}><MoreHorizontal size={17} /></button>
          {options && <div className="lp-note-options"><label htmlFor="lp-start-date">{t('lifeplanner.startDate')}</label><input className={input} id="lp-start-date" type="date" value={draft.startDate} onChange={e => field('startDate', e.target.value)} disabled={busy} /></div>}
        </div>
        <button type="button" className="lp-button" disabled={busy} onClick={close}>{t('lifeplanner.cancel')}</button>
        <button type="submit" disabled={busy} className="lp-button lp-note-save"><Check size={14} />{t('lifeplanner.save')}</button>
      </footer>
      <span className="sr-only" id={drag.descriptionId}>{t('lifeplanner.moveInstructions')}</span><span className="sr-only" role="status">{drag.message}</span>
    </form>
    {projectStep && <div className="lp-project-mask" ref={projectRoot} role="dialog" aria-modal="true" aria-label={t('lifeplanner.project')}>
      <FormOverlay onClose={() => setProjectStep(null)} mobile={ctx.isMobile} cardBg={ctx.cardBg}>
        <div className={`${ctx.cardBg} rounded-2xl max-w-md w-full`} onClick={e => e.stopPropagation()}>
          <ProjectForm prefill={{ title: measureText(draft.title, projectStep.value) }} goals={goals} onSave={createProject} onCancel={() => setProjectStep(null)} mobile={ctx.isMobile} />
          {error && <p role="alert" className="lp-error px-5 pb-4">{error}</p>}
        </div>
      </FormOverlay>
    </div>}
  </div>;
}
