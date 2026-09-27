import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripVertical, FolderPlus, Layers, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { FormOverlay, ProjectForm } from '../goals/GoalDashboard.jsx';
import { createVision, maxVisionOffset, measureText, milestoneDate, parseVisionText, pretty, projectFields, saveVision, suggestVisionStep, toAbsoluteVision, toStoredVision, uid, validateVision, years, UNIT_YEARS, MAX_VISION_STEPS } from '../../lifeplanner/model.js';
import { provenanceForStep, stableProjectId } from '../../lifeplanner/hierarchy.js';
import useLifePlannerHierarchy from '../../hooks/useLifePlannerHierarchy.js';
import useDialogFocus from './useDialogFocus.js';
import useNotebookDrag from './useNotebookDrag.js';
import { moveNotebookItem } from '../../lifeplanner/notebook.js';
import { saveStrategyVision } from '../../lifeplanner/swot.js';
import './visionEditor.css';

function readNativeTombstones(key) {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export default function VisionEditor({ wish, original, seed = '', strategySource = null, store, onClose, onOpenProject }) {
  const ctx = useDayPlannerCtx();
  const { projects, goals, addGoal, updateGoal, addProject, updateProject, setGoalsProjectsEnabled, multiUserEnabled } = useFeaturesCtx();
  const { createProjectNote } = useSyncCtx();
  const { t } = useTranslation();
  const deletedGoalIds = readNativeTombstones('day-planner-deleted-goal-ids');
  const deletedProjectIds = readNativeTombstones('day-planner-deleted-project-ids');
  const { ensureStepGoal, ensureStepProject, guardReason } = useLifePlannerHierarchy({
    wishes: [wish],
    goals,
    projects,
    dataLoaded: !!ctx.dataLoaded,
    multiUserEnabled: !!multiUserEnabled,
    readOnly: !!store?.error?.(),
    deletedGoalIds,
    deletedProjectIds,
    addGoal,
    updateGoal,
    addProject,
    updateProject,
  });
  const initialStored = useRef(original ? structuredClone(original) : createVision(seed)).current;
  const initialDraft = useRef(toAbsoluteVision(initialStored)).current;
  const blankFromSuggestion = suggestion => suggestion ? { ...suggestion, value: '', suggestedValue: suggestion.value, touched: false } : null;
  const [draft, setDraft] = useState(() => structuredClone(initialDraft));
  const [expected, setExpected] = useState(() => original ? structuredClone(original) : null);
  const [emptyStage, setEmptyStage] = useState(() => blankFromSuggestion(suggestVisionStep(initialDraft)));
  const [source, setSource] = useState(strategySource);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectStep, setProjectStep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState(false);
  const focusEmpty = useRef(false);
  const draftRef = useRef(initialDraft);
  const outcome = useRef(null);
  useLayoutEffect(() => {
    const element = outcome.current;
    if (!element) return;
    const fit = () => {
      element.style.height = '1px';
      element.style.height = `${Math.max(34, element.scrollHeight)}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; fit(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft.title]);
  const saving = useRef(false);
  const root = useRef(null);
  const projectRoot = useRef(null);
  const initial = useRef(structuredClone(initialDraft));
  const expectedDraft = expected ? toAbsoluteVision(expected) : initial.current;
  const dirty = JSON.stringify(draft) !== JSON.stringify(expectedDraft);
  const needsSave = !expected && !original ? true : dirty;
  const close = async () => {
    if (saving.current) return;
    if (options) { setOptions(false); return; }
    const pendingBlank = !!emptyStage?.touched;
    if (pendingBlank) commitEmptyStage(false);
    if (!original && !expected && !draft.title.trim() && !dirty && !pendingBlank && draft.steps.length === 0) { onClose(); return; }
    if (!needsSave && !pendingBlank) { onClose(); return; }
    saving.current = true; setBusy(true);
    if (await persist()) onClose();
    saving.current = false; setBusy(false);
  };
  const drag = useNotebookDrag(root, {
    t,
    onMove: (_group, id, targetId, after, expectedIds) => {
      try {
        const next = moveNotebookItem(draft.steps, id, targetId, after, expectedIds);
        if (next.some((step, index) => index && years(step.amount, step.unit) <= years(next[index - 1].amount, next[index - 1].unit))) {
          setError(t('lifeplanner.errors.duration'));
          return false;
        }
        field('steps', next); return true;
      }
      catch { setError(t('lifeplanner.errors.conflict')); return false; }
    },
    onTrash: (_group, id) => removeStep(id),
  });
  useDialogFocus(root, close, !projectStep);
  useDialogFocus(projectRoot, () => setProjectStep(null), !!projectStep);
  const metric = parseVisionText(draft.title);
  const field = (key, value) => setDraft(v => { const next = { ...v, [key]: value }; draftRef.current = next; return next; });
  const stageField = (id, key, value) => setDraft(v => { const next = { ...v, steps: v.steps.map(s => s.id === id ? { ...s, [key]: value } : s) }; draftRef.current = next; return next; });
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    setEmptyStage(blankFromSuggestion(suggestVisionStep(draft)));
  }, [draft]);
  useEffect(() => {
    if (!focusEmpty.current) return;
    const input = root.current?.querySelector('[data-life-stage-empty] input[type="number"]');
    if (input) { focusEmpty.current = false; input.focus(); }
  }, [emptyStage]);
  function removeStep(id) {
    const step = draft.steps.find(item => item.id === id);
    if (!step) return false;
    if (step.projectId && !window.confirm(t('lifeplanner.removeConfirm'))) return false;
    field('steps', draft.steps.filter(item => item.id !== id));
    return true;
  }
  const input = 'lp-input';
  const explainError = err => t(`lifeplanner.errors.${err.message}`, { defaultValue: t('lifeplanner.errors.unknown') });
  async function persist() {
    const liveDraft = draftRef.current;
    let storedDraft;
    try { storedDraft = toStoredVision(liveDraft, expected); }
    catch (err) { setError(explainError(err)); return null; }
    const invalid = validateVision(storedDraft);
    if (invalid) { setError(explainError(new Error(invalid))); return null; }
    try {
      const next = await store.commit(doc => source
        ? saveStrategyVision(doc, wish.id, storedDraft, expected, source)
        : saveVision(doc, wish.id, storedDraft, expected));
      const saved = next.wishes.find(w => w.id === wish.id).visions.find(v => v.id === liveDraft.id);
      const savedDraft = toAbsoluteVision(saved);
      setExpected(saved); draftRef.current = savedDraft; setDraft(savedDraft); setError('');
      if (source) setSource({ ...source, visionId: saved.id });
      return saved;
    } catch (err) { setError(explainError(err)); return null; }
  }
  async function save(event) {
    event.preventDefault();
    await close();
  }
  async function persistGoalLink(saved, savedStep, goalId) {
    if (savedStep.goalId === goalId) return saved;
    const linked = {
      ...saved,
      steps: saved.steps.map(step => step.id === savedStep.id ? { ...step, goalId } : step),
    };
    const next = await store.commit(doc => saveVision(doc, wish.id, linked, saved));
    const linkedSaved = next.wishes.find(item => item.id === wish.id).visions.find(item => item.id === saved.id);
    const linkedDraft = toAbsoluteVision(linkedSaved);
    setExpected(linkedSaved);
    draftRef.current = linkedDraft;
    setDraft(linkedDraft);
    setError('');
    return linkedSaved;
  }
  function nativeLinkError(link) {
    if (link?.status === 'skipped' && guardReason === 'multi-user') return t('lifeplanner.multiUser');
    return t('lifeplanner.errors.conflict');
  }
  async function arrange(step) {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const saved = await persist();
      if (saved) {
        const existing = projects.find(p => p.id === step.projectId);
        if (existing) onOpenProject(existing.id);
        else {
          let linkedSaved = saved;
          let savedStep = linkedSaved.steps.find(s => s.id === step.id);
          const goalLink = ensureStepGoal({ wish, vision: saved, step: savedStep });
          if (goalLink.status === 'conflict' || goalLink.status === 'skipped' || !goalLink.id) {
            setError(nativeLinkError(goalLink));
          } else {
            linkedSaved = await persistGoalLink(linkedSaved, savedStep, goalLink.id);
            savedStep = linkedSaved.steps.find(s => s.id === step.id);
            setProjectStep({ ...savedStep, goalId: goalLink.id, nativeGoal: goalLink.goal || null });
          }
        }
      }
    } catch (err) { setError(explainError(err)); }
    finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function createProject(fields) {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      // Reserve the stable native identity durably BEFORE inserting in native
      // state. Retry uses the same id, and addProject's optional id is idempotent.
      const projectId = projectStep.projectId || stableProjectId(projectStep.id);
      const storedVision = toStoredVision(draft, expected);
      const goalLink = ensureStepGoal({ wish, vision: storedVision, step: projectStep });
      if (goalLink.status === 'skipped') {
        setError(nativeLinkError(goalLink));
        return;
      }
      if (goalLink.status === 'conflict') throw new Error('conflict');
      const goalId = goalLink.id || projectStep.goalId;
      if (!goalId) throw new Error('conflict');
      const linked = { ...draft, steps: draft.steps.map(s => s.id === projectStep.id ? { ...s, goalId, projectId } : s) };
      const linkedStored = toStoredVision(linked, expected);
      const next = await store.commit(doc => saveVision(doc, wish.id, linkedStored, expected));
      const saved = next.wishes.find(w => w.id === wish.id).visions.find(v => v.id === draft.id);
      setDraft(toAbsoluteVision(saved)); setExpected(saved);
      const savedStep = saved.steps.find(s => s.id === projectStep.id);
      if (!projects.some(p => p.id === projectId)) {
        const { createNote, goalId: _selectedGoalId, ...nativeFields } = fields;
        const milestone = measureText(saved.title, savedStep.value);
        const provenance = provenanceForStep(wish, saved, savedStep);
        const base = projectFields(wish, saved, savedStep, t('lifeplanner.projectDescription', {
          wish: wish.title, vision: saved.title, milestone, date: milestoneDate(saved, savedStep.id),
        }), { goalId, lifeplanner: provenance.lifeplanner });
        const projectLink = ensureStepProject({
          wish, vision: saved, step: savedStep, goal: goalLink.goal || { id: goalId }, projects,
          addProject, updateProject, fields: { ...base, ...nativeFields, ...provenance, goalId },
        });
        if (projectLink.status === 'conflict' || !projectLink.project) throw new Error('conflict');
        const created = projectLink.project;
        setGoalsProjectsEnabled(true);
        if (createNote && projectLink.created && created?.id) createProjectNote?.('project', created.id, { title: created.title, goalId: created.goalId });
      }
      setProjectStep(null); setNotice(t('lifeplanner.projectSaved')); setError('');
    } catch (err) { setError(explainError(err)); }
    finally { saving.current = false; setBusy(false); }
  }
  function timeFields(value, onChange, label, outer = false) {
    const units = ['year', 'month', 'day'];
    const cycleUnit = () => {
      const current = units.indexOf(value.unit);
      const duration = years(value.amount, value.unit);
      if (!Number.isFinite(duration)) return;
      for (let offset = 1; offset < units.length; offset += 1) {
        const unit = units[(current + offset + units.length) % units.length];
        const exactAmount = duration / UNIT_YEARS[unit];
        if (Math.abs(exactAmount - Math.round(exactAmount)) > 1e-8) continue;
        onChange('amount', Math.max(1, Math.round(exactAmount))); onChange('unit', unit);
        return;
      }
    };
    return <div className="lp-duration">
      {outer && <span className="sr-only">{t('lifeplanner.horizon')}</span>}
      <input className={input} type="number" min="1" step="1" value={value.amount}
        style={{ width: `${Math.max(2, String(value.amount).length + 1)}ch` }}
        aria-label={label} onChange={e => onChange('amount', e.target.value)} required />
      <button type="button" className="lp-duration-unit" aria-label={`${label} · ${t('lifeplanner.time')}`}
        title={t('lifeplanner.cycleUnit', { defaultValue: '切换时长单位' })} onClick={cycleUnit}>{t(`lifeplanner.${value.unit}`)}</button>
      {outer && <span className="lp-duration-tail">{t('lifeplanner.within')}</span>}
    </div>;
  }
  function measureInput(value, onChange, label, options = {}) {
    return <div className="lp-measure">
      <span>{metric.valid ? metric.prefix : ''}</span>
      <input type="number" step="any" className={input} aria-label={label} placeholder={options.placeholder} value={value}
        style={{ width: `${Math.min(18, Math.max(2, String(value).length + 1))}ch` }}
        onChange={e => onChange(e.target.value)} onBlur={options.onBlur} onKeyDown={options.onKeyDown} required={options.required ?? true} />
      <span>{metric.valid ? metric.suffix : ''}</span>
    </div>;
  }
  const total = maxVisionOffset(draft), horizon = years(draft.amount, draft.unit);
  const boundGoal = projectStep && (goals.find(goal => goal.id === projectStep.goalId) || projectStep.nativeGoal);
  function suggestedValueFor(amount, unit) {
    const offset = years(amount, unit), targetHorizon = years(draft.amount, draft.unit);
    if (!Number.isFinite(offset) || !Number.isFinite(targetHorizon) || targetHorizon <= 0) return null;
    const current = Number(draft.current), target = metric.target;
    if (!Number.isFinite(current) || !Number.isFinite(target)) return null;
    return Math.round((current + (target - current) * (offset / targetHorizon)) * 100) / 100;
  }
  function changeEmptyStageTime(key, value) {
    setEmptyStage(current => {
      if (!current) return current;
      const next = { ...current, [key]: value, touched: true };
      const suggested = suggestedValueFor(key === 'amount' ? value : current.amount, key === 'unit' ? value : current.unit);
      if (suggested != null) next.suggestedValue = suggested;
      return next;
    });
  }
  function commitEmptyStage(useSuggestion = false) {
    if (!emptyStage) return;
    if (!emptyStage.touched && !useSuggestion) return;
    const candidate = emptyStage.value === '' ? pretty(emptyStage.suggestedValue) : emptyStage.value;
    if (candidate === '' || !Number.isFinite(Number(candidate))) return;
    const amount = Number(emptyStage.amount), unit = emptyStage.unit;
    if (!Number.isInteger(amount) || amount <= 0 || !Object.hasOwn(UNIT_YEARS, unit)) return;
    if (draft.steps.length >= MAX_VISION_STEPS) return;
    const next = { ...draftRef.current, steps: [...draftRef.current.steps, { id: uid(), value: Number(candidate), amount, unit }] };
    draftRef.current = next;
    focusEmpty.current = true;
    setDraft(next);
    setEmptyStage(blankFromSuggestion(suggestVisionStep(next)));
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
                if (p.outcome !== draft.title.trim()) setDraft(v => { const next = { ...v, title: p.outcome, amount: p.amount, unit: p.unit }; draftRef.current = next; return next; });
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
                    title={t('lifeplanner.delete')} onClick={() => removeStep(step.id)}><Trash2 size={13} /></button>
                </div>
              </div>;
            })}
            {emptyStage && <div className="lp-empty-stage lp-note-line" data-life-stage-empty onBlur={event => {
              if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) commitEmptyStage(false);
            }}>
              <span className="lp-note-gutter" aria-hidden="true" />
              {measureInput(emptyStage.value, value => setEmptyStage(current => current ? { ...current, value, touched: true } : current), t('lifeplanner.milestoneValue', { number: draft.steps.length + 1 }), {
                placeholder: pretty(emptyStage.suggestedValue), required: false,
                onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); commitEmptyStage(true); } },
              })}
              {timeFields(emptyStage, changeEmptyStageTime, t('lifeplanner.stepDuration', { number: draft.steps.length + 1 }))}
              <span className="lp-note-tools-space" />
            </div>}
          </div>
          <div className="lp-note-tail">
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
      </footer>
      {drag.presentation}
      <span className="sr-only" id={drag.descriptionId}>{t('lifeplanner.moveInstructions')}</span><span className="sr-only" role="status">{drag.message}</span>
    </form>
    {projectStep && <div className="lp-project-mask" ref={projectRoot} role="dialog" aria-modal="true" aria-label={t('lifeplanner.project')}>
      <FormOverlay onClose={() => setProjectStep(null)} mobile={ctx.isMobile} cardBg={ctx.cardBg}>
        <div className={`${ctx.cardBg} rounded-2xl max-w-md w-full`} onClick={e => e.stopPropagation()}>
          <ProjectForm prefill={{ title: measureText(draft.title, projectStep.value) }} goals={boundGoal ? [boundGoal] : []} defaultGoalId={projectStep.goalId} hideGoalPicker onSave={createProject} onCancel={() => setProjectStep(null)} mobile={ctx.isMobile} />
          {error && <p role="alert" className="lp-error px-5 pb-4">{error}</p>}
        </div>
      </FormOverlay>
    </div>}
  </div>;
}
