import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass, Eye, HelpCircle, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { dismissPlanningChoicesForToday, registerPlanningChoicesVisit } from '../../lifeplanner/planningChoicesPrompt.js';
import useDialogFocus from './useDialogFocus.js';
import './planningChoices.css';

export function PlanningChoicesButton() {
  const { t } = useTranslation();
  const { showPlanningChoices, setShowPlanningChoices } = useFeaturesCtx();
  return <button type="button" data-planning-choices-trigger
    className="planning-choices-trigger bg-brand text-stone-950"
    aria-label={t('planningChoices.open')} title={t('planningChoices.open')}
    aria-haspopup="dialog" aria-expanded={!!showPlanningChoices}
    onClick={() => setShowPlanningChoices(true)}><HelpCircle size={20} aria-hidden="true" /></button>;
}

export function PlanningChoiceRow({ name, title, checked, locked, onChange, onOpen, openLabel, ctx }) {
  const { t } = useTranslation();
  const id = useId();
  // Compass is the Life Planner entry icon in GlanceFabs, not the telescope
  // used elsewhere for smart scheduling. Match the native single-color icons.
  const Icon = name === 'daily' ? Eye : name === 'review' ? NotebookPen : Compass;
  return <div className="planning-choice-row" data-planning-choice={name}>
    <Icon size={22} className={`planning-choice-symbol ${ctx.textSecondary}`} aria-hidden="true" />
    <h3 id={`${id}-label`}>{onOpen ? <button type="button" className="planning-choice-name" aria-label={openLabel} onClick={onOpen}>{title}</button> : title}</h3>
    {locked && <span id={`${id}-included`} className="sr-only">{t('planningChoices.alwaysOn')}</span>}
    <button type="button" role="switch" aria-checked={checked} disabled={locked}
      aria-labelledby={`${id}-label`} aria-describedby={locked ? `${id}-included` : undefined}
      className="planning-choice-switch" onClick={() => onChange?.(!checked)}>
      <span aria-hidden="true" className={`planning-choice-track ${checked ? 'bg-blue-600' : ctx.darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
        <span className="planning-choice-thumb" />
      </span>
    </button>
  </div>;
}

// One controller per application, not one effect per responsive header button.
// Only auto-open after native welcome/load and any active editing surfaces close.
export function PlanningChoicesController() {
  const ctx = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const attempted = useRef(false);
  const ready = ctx.dataLoaded && !ctx.showWelcome && !ctx.showSettings && !ctx.showAddTask &&
    !ctx.mobileEditingTask && !features.showLifePlanner && !features.showGoalsDashboard &&
    !features.showWeeklyReview && !features.showVoiceInput && !ctx.showSpotlight;
  const { showPlanningChoices, setShowPlanningChoices } = features;
  useEffect(() => {
    if (!ready || attempted.current) return;
    attempted.current = true;
    // Passing a wrapper keeps access to localStorage itself inside the guard.
    const storage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) };
    if (registerPlanningChoicesVisit(storage)) setShowPlanningChoices(true);
  }, [ready, setShowPlanningChoices]);
  return showPlanningChoices ? <PlanningChoices /> : null;
}

export default function PlanningChoices() {
  const ctx = useDayPlannerCtx();
  const { t } = useTranslation();
  const { setShowPlanningChoices, joboEnabled, setJoboEnabled, lifeplannerEnabled,
    setLifeplannerEnabled, planningPreferenceError, setShowLifePlanner } = useFeaturesCtx();
  const [snoozeError, setSnoozeError] = useState(false);
  const root = useRef(null), backdrop = useRef(null);
  const id = useId();
  const close = () => setShowPlanningChoices(false);
  useEffect(() => {
    const old = [...document.body.children].filter(el => el !== backdrop.current).map(el => [el, el.inert]);
    old.forEach(([el]) => { el.inert = true; });
    return () => old.forEach(([el, inert]) => { el.inert = inert; });
  }, []);
  useDialogFocus(root, close);
  const dismissToday = () => {
    if (dismissPlanningChoicesForToday({ setItem: (key, value) => window.localStorage.setItem(key, value) })) close();
    else setSnoozeError(true);
  };
  return createPortal(<div ref={backdrop} className="planning-choices-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={root} data-planning-choices role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
      className={`planning-choices-dialog ${ctx.textPrimary} ${ctx.darkMode ? 'planning-choices-dark' : ''}`}>
      <h2 id={`${id}-title`} data-initial-focus tabIndex={-1}>{t('planningChoices.title')}</h2>
      <div role="group" aria-label={t('planningChoices.group')}>
        <PlanningChoiceRow name="daily" title={t('planningChoices.daily')} checked locked ctx={ctx} />
        <PlanningChoiceRow name="review" title={t('planningChoices.review')} checked={joboEnabled} onChange={setJoboEnabled} ctx={ctx}
          onOpen={joboEnabled && ctx.canShowViewCycler && !ctx.hiddenViews.desktop.includes('jobo') ? () => { ctx.setShowDayDial(false); ctx.setViewMode('jobo'); close(); } : undefined}
          openLabel={t('planningChoices.openJobo')} />
        <PlanningChoiceRow name="life" title={t('planningChoices.life')} checked={lifeplannerEnabled} onChange={setLifeplannerEnabled} ctx={ctx}
          onOpen={lifeplannerEnabled ? () => { close(); setShowLifePlanner(true); } : undefined} openLabel={t('planningChoices.openLife')} />
      </div>
      {planningPreferenceError && <p role="alert" className="planning-choices-error text-red-500">{t(`planningChoices.${planningPreferenceError}Error`)}</p>}
      {snoozeError && <p role="alert" className="planning-choices-error text-red-500">{t('planningChoices.snoozeError')}</p>}
      <footer className="planning-choices-footer"><button type="button" className="planning-choices-snooze" onClick={dismissToday}>{t('planningChoices.notToday')}</button></footer>
    </section>
  </div>, document.body);
}
