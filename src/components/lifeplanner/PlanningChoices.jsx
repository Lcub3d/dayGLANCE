import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass, Eye, HelpCircle, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { isPlanningGuideBlocked, isPlanningGuideDOMBusy } from '../../lifeplanner/planningGuideGuard.js';
import { dismissPlanningChoicesForToday, localPromptDate, PLANNING_PROMPT_DISMISSED_KEY, registerPlanningChoicesVisit } from '../../lifeplanner/planningChoicesPrompt.js';
import useDialogFocus from './useDialogFocus.js';
import usePlanningPromptDismissed, { PLANNING_PROMPT_CHANGED } from '../../hooks/usePlanningPromptDismissed.js';
import { applyPlanningChoice } from '../../lifeplanner/applyPlanningChoice.js';
import './planningChoices.css';

export function PlanningChoicesButton() {
  const { t } = useTranslation();
  const features = useFeaturesCtx();
  const ctx = useDayPlannerCtx();
  const sync = useSyncCtx();
  const { showPlanningChoices, setShowPlanningChoices } = features;
  const blocked = isPlanningGuideBlocked(ctx, features, sync || {});
  const dismissed = usePlanningPromptDismissed();
  if (dismissed) return null;
  return <button type="button" data-planning-choices-trigger
    className="planning-choices-trigger bg-brand text-stone-950"
    aria-label={t('planningChoices.open')} title={t('planningChoices.open')}
    aria-haspopup="dialog" aria-expanded={!!showPlanningChoices} disabled={blocked}
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
      <span aria-hidden="true" className={`planning-choice-track ${locked ? 'bg-stone-300' : checked ? 'bg-blue-600' : ctx.darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
        <span className="planning-choice-thumb" />
      </span>
    </button>
  </div>;
}

// One visit per app mount, never one per responsive header. The native welcome
// decision is a reactive barrier: child effects otherwise run before useAppInit.
export function PlanningChoicesController() {
  const ctx = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const sync = useSyncCtx();
  const visit = useRef(null);
  const blocked = isPlanningGuideBlocked(ctx, features, sync || {});
  const { showPlanningChoices, setShowPlanningChoices } = features;
  useEffect(() => {
    if (!ctx.dataLoaded || !ctx.initialWelcomeChecked) return;
    const storage = {
      getItem: key => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    };
    if (!visit.current) {
      visit.current = {
        date: localPromptDate(),
        due: registerPlanningChoicesVisit(storage),
        handled: false,
      };
    }
    // Do not queue a second onboarding modal behind the native welcome tour.
    // This launch still counts as an opened date; manual access remains available
    // after welcome closes, and later launches retain the requested cadence.
    if (ctx.showWelcome || ctx.showOnboarding) visit.current.handled = true;
    if (showPlanningChoices) {
      visit.current.handled = true; // manual use must not be followed by an auto-open
      if (blocked) setShowPlanningChoices(false);
      return;
    }
    if (blocked || visit.current.handled || !visit.current.due) return;
    let timer;
    const schedule = () => {
      window.clearTimeout(timer);
      if (isPlanningGuideDOMBusy(document)) return;
      timer = window.setTimeout(() => {
        if (visit.current.handled || isPlanningGuideDOMBusy(document)) return;
        // Never replay a pending prompt on a later local date. Re-read the snooze
        // at display time so another tab can cancel a pending prompt as well.
        if (localPromptDate() !== visit.current.date) { visit.current.handled = true; return; }
        try {
          if (storage.getItem(PLANNING_PROMPT_DISMISSED_KEY) === visit.current.date) return;
        } catch { return; }
        visit.current.handled = true;
        setShowPlanningChoices(true);
      }, 1200);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('pointerup', schedule);
    window.addEventListener('focus', schedule);
    window.addEventListener('storage', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('pointerup', schedule);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('storage', schedule);
    };
  }, [ctx.dataLoaded, ctx.initialWelcomeChecked, ctx.showWelcome, ctx.showOnboarding, blocked, showPlanningChoices, setShowPlanningChoices]);
  return showPlanningChoices && !blocked ? <PlanningChoices /> : null;
}

export default function PlanningChoices() {
  const ctx = useDayPlannerCtx();
  const { t } = useTranslation();
  const features = useFeaturesCtx();
  const { setShowPlanningChoices, joboEnabled, lifeplannerEnabled,
    planningPreferenceError, setShowLifePlanner } = features;
  const [snoozeError, setSnoozeError] = useState(false);
  const root = useRef(null), backdrop = useRef(null);
  const id = useId();
  const close = () => setShowPlanningChoices(false);
  const chooseReview = enabled => applyPlanningChoice('review', enabled, features, ctx);
  const chooseLife = enabled => applyPlanningChoice('life', enabled, features, ctx);
  useEffect(() => {
    const old = [...document.body.children].filter(el => el !== backdrop.current).map(el => [el, el.inert]);
    old.forEach(([el]) => { el.inert = true; });
    return () => old.forEach(([el, inert]) => { el.inert = inert; });
  }, []);
  useDialogFocus(root, close);
  const dismissToday = () => {
    if (dismissPlanningChoicesForToday({ setItem: (key, value) => window.localStorage.setItem(key, value) })) {
      window.dispatchEvent(new Event(PLANNING_PROMPT_CHANGED));
      close();
    }
    else setSnoozeError(true);
  };
  return createPortal(<div ref={backdrop} className="planning-choices-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={root} data-planning-choices role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
      className="planning-choices-dialog text-stone-900">
      <h2 id={`${id}-title`} data-initial-focus tabIndex={-1}>{t('planningChoices.title')}</h2>
      <div role="group" aria-label={t('planningChoices.group')}>
        <PlanningChoiceRow name="daily" title={t('planningChoices.daily')} checked locked ctx={ctx} />
        <PlanningChoiceRow name="review" title={t('planningChoices.review')} checked={joboEnabled} onChange={chooseReview} ctx={ctx}
          onOpen={joboEnabled && ctx.canShowViewCycler && !ctx.hiddenViews.desktop.includes('jobo') ? () => { ctx.setShowDayDial(false); ctx.setViewMode('jobo'); close(); } : undefined}
          openLabel={t('planningChoices.openJobo')} />
        <PlanningChoiceRow name="life" title={t('planningChoices.life')} checked={lifeplannerEnabled} onChange={chooseLife} ctx={ctx}
          onOpen={lifeplannerEnabled ? () => { close(); setShowLifePlanner(true); } : undefined} openLabel={t('planningChoices.openLife')} />
      </div>
      {planningPreferenceError && <p role="alert" className="planning-choices-error text-red-500">{t(`planningChoices.${planningPreferenceError}Error`)}</p>}
      {snoozeError && <p role="alert" className="planning-choices-error text-red-500">{t('planningChoices.snoozeError')}</p>}
      <footer className="planning-choices-footer"><button type="button" className="planning-choices-snooze" onClick={dismissToday}>{t('planningChoices.notToday')}</button></footer>
    </section>
  </div>, document.body);
}
