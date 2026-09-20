import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, Check, FolderPlus, Layers, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { FormOverlay, ProjectForm } from '../goals/GoalDashboard.jsx';
import { createVision, measureText, milestoneDate, parseVisionText, pretty, projectFields, reorder, saveVision, totalYears, uid, validateVision, years, MAX_VISION_STEPS } from '../../lifeplanner/model.js';
import useDialogFocus from './useDialogFocus.js';

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
  const saving = useRef(false);
  const root = useRef(null);
  const projectRoot = useRef(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(expected);
  const close = () => { if (!dirty || window.confirm(t('lifeplanner.discard'))) onClose(); };
  useDialogFocus(root, close, !projectStep);
  useDialogFocus(projectRoot, () => setProjectStep(null), !!projectStep);
  const metric = parseVisionText(draft.title);
  const field = (key, value) => setDraft(v => ({ ...v, [key]: value }));
  const stageField = (id, key, value) => setDraft(v => ({ ...v, steps: v.steps.map(s => s.id === id ? { ...s, [key]: value } : s) }));
  const input = `lp-input ${ctx.cardBg} ${ctx.borderClass} ${ctx.textPrimary}`;
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
  function timeFields(value, onChange, label) {
    return <div className="lp-duration">
      <span className={ctx.textSecondary}>{t('lifeplanner.in')}</span>
      <input className={input} type="number" min="1" step="1" value={value.amount} aria-label={label} onChange={e => onChange('amount', e.target.value)} required />
      <select className={input} value={value.unit} aria-label={`${label} · ${t('lifeplanner.time')}`} onChange={e => onChange('unit', e.target.value)}>
        {['year', 'month', 'day'].map(unit => <option key={unit} value={unit}>{t(`lifeplanner.${unit}`)}</option>)}
      </select>
    </div>;
  }
  function measureInput(value, onChange, label) {
    return <div className="lp-measure">
      <span>{metric.valid ? metric.prefix : ''}</span>
      <input type="number" step="any" className={input} aria-label={label} value={value} onChange={e => onChange(e.target.value)} required />
      <span>{metric.valid ? metric.suffix : ''}</span>
    </div>;
  }
  const total = totalYears(draft), horizon = years(draft.amount, draft.unit);
  return <div className="lp-sheet-mask" data-life-vision>
    <form ref={root} className={`lp-vision-sheet ${ctx.cardBg} ${ctx.textPrimary}`} onSubmit={save} role="dialog" aria-modal={!projectStep} aria-labelledby="lp-vision-heading" tabIndex={-1} inert={projectStep ? '' : undefined}>
      <header className={`lp-sheet-header border-b ${ctx.borderClass}`}>
        <div><div className={`lp-eyebrow ${ctx.textSecondary}`}>{wish.title}</div><h2 id="lp-vision-heading">{t('lifeplanner.vision')}</h2></div>
        <button type="button" className={`lp-icon ${ctx.hoverBg}`} aria-label={t('lifeplanner.close')} onClick={close}><X size={19} /></button>
      </header>
      <div className="lp-vision-body">
        <p className={`lp-helper ${ctx.textSecondary}`}>{t('lifeplanner.measureHelp')}</p>
        <div className={`lp-vision-target border ${ctx.borderClass} ${ctx.darkMode ? 'bg-gray-700/40' : 'bg-stone-50'}`}>
          <label className="lp-label" htmlFor="lp-outcome">{t('lifeplanner.outcome')}</label>
          <div className="lp-outcome-row">
            <input id="lp-outcome" data-initial-focus className={`${input} font-semibold`} value={draft.title} maxLength={2000} placeholder={t('lifeplanner.outcomePlaceholder')} onChange={e => field('title', e.target.value)} onBlur={() => {
              const p = parseVisionText(draft.title);
              if (p.outcome !== draft.title.trim()) setDraft(v => ({ ...v, title: p.outcome, amount: p.amount, unit: p.unit }));
            }} required />
            {timeFields(draft, field, t('lifeplanner.horizon'))}
          </div>
          <div className="lp-start"><CalendarDays size={14} className={ctx.textSecondary} /><label htmlFor="lp-start-date" className={ctx.textSecondary}>{t('lifeplanner.startDate')}</label><input className={input} id="lp-start-date" type="date" value={draft.startDate} onChange={e => field('startDate', e.target.value)} required /></div>
        </div>
        <div className={`lp-now border-b ${ctx.borderClass}`}><span className={`lp-step-index ${ctx.textSecondary}`}>○</span>{measureInput(draft.current, value => field('current', value), t('lifeplanner.current'))}<span className={`lp-now-label ${ctx.textSecondary}`}>{t('lifeplanner.now')}</span></div>
        <div className="lp-stages">
          {draft.steps.map((step, index) => {
            const existing = projects.find(p => p.id === step.projectId);
            let date = '';
            try { date = milestoneDate(draft, step.id); } catch { /* Incomplete durations stay editable. */ }
            return <div key={step.id} className={`lp-stage border-b ${ctx.borderClass}`} data-life-stage={step.id}>
              <div className="lp-stage-main"><span className={`lp-step-index ${ctx.textSecondary}`}>{String(index + 1).padStart(2, '0')}</span>{measureInput(step.value, value => stageField(step.id, 'value', value), t('lifeplanner.milestoneValue', { number: index + 1 }))}{timeFields(step, (key, value) => stageField(step.id, key, value), t('lifeplanner.stepDuration', { number: index + 1 }))}</div>
              <div className="lp-stage-bottom"><span className={`lp-helper ${ctx.textSecondary}`}>{date && t('lifeplanner.nextDate', { date })}</span><div className="lp-stage-actions">
                <button type="button" disabled={busy} className={`lp-project-link ${ctx.hoverBg} text-blue-500`} onClick={() => arrange(step)}>{existing ? <Layers size={14} /> : <FolderPlus size={14} />}{existing ? t('lifeplanner.openProject') : step.projectId ? t('lifeplanner.missingProject') : t('lifeplanner.project')}</button>
                <button type="button" className={`lp-icon ${ctx.hoverBg}`} disabled={!index || busy} aria-label={t('lifeplanner.up')} onClick={() => field('steps', reorder(draft.steps, step.id, -1))}><ArrowUp size={13} /></button>
                <button type="button" className={`lp-icon ${ctx.hoverBg}`} disabled={index === draft.steps.length - 1 || busy} aria-label={t('lifeplanner.down')} onClick={() => field('steps', reorder(draft.steps, step.id, 1))}><ArrowDown size={13} /></button>
                <button type="button" className={`lp-icon ${ctx.hoverBg}`} aria-label={t('lifeplanner.delete')} onClick={() => { if (!step.projectId || window.confirm(t('lifeplanner.removeConfirm'))) field('steps', draft.steps.filter(s => s.id !== step.id)); }}><Trash2 size={13} /></button>
              </div></div>
            </div>;
          })}
          {!draft.steps.length && <p className={`lp-empty-stages ${ctx.textSecondary}`}>{t('lifeplanner.noSteps')}</p>}
        </div>
        <button type="button" className={`lp-add-stage ${ctx.hoverBg} text-blue-500`} disabled={draft.steps.length >= MAX_VISION_STEPS || busy} onClick={() => {
          const fraction = Math.min(1, (total + 1) / (horizon || 5));
          const current = Number(draft.current) || 0;
          field('steps', [...draft.steps, { id: uid(), value: Math.round((current + (metric.target - current) * fraction) * 100) / 100, amount: 1, unit: 'year' }]);
        }}><Plus size={15} />{t('lifeplanner.addStep')}</button>
        <div className={`lp-total ${ctx.darkMode ? 'bg-gray-700/40' : 'bg-stone-50'}`}><span>{t('lifeplanner.totalTime')}</span><b>{Number.isFinite(total) ? pretty(total) : '—'} {t('lifeplanner.year')}</b><span className={ctx.textSecondary}>{t('lifeplanner.planned', { planned: Number.isFinite(total) ? pretty(total) : '—', total: Number.isFinite(horizon) ? pretty(horizon) : '—' })}</span></div>
        <p className={`lp-helper ${ctx.textSecondary}`}>{t('lifeplanner.durationHelp')}</p>
        <p className={`lp-helper ${ctx.textSecondary}`}>{t('lifeplanner.projectHint')} {t('lifeplanner.savedProjectHint')}</p>
        {error && !projectStep && <p role="alert" className="lp-error">{error}</p>}
        {notice && <p role="status" className="text-sm text-blue-500">{notice}</p>}
      </div>
      <footer className={`lp-sheet-footer border-t ${ctx.borderClass}`}><span className={`lp-helper ${ctx.textSecondary}`}>{dirty ? t('lifeplanner.unsaved') : t('lifeplanner.saved')}</span><button type="button" className={`lp-button ${ctx.hoverBg}`} onClick={close}>{t('lifeplanner.cancel')}</button><button type="submit" disabled={busy} className="lp-button bg-blue-600 hover:bg-blue-700 text-white"><Check size={15} />{t('lifeplanner.save')}</button></footer>
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
