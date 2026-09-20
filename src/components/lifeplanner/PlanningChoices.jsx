import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Eye, HelpCircle, LockKeyhole, NotebookPen, Telescope, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
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

export function PlanningChoiceRow({ name, title, description, checked, locked, onChange, children, ctx }) {
  const { t } = useTranslation();
  const id = useId();
  const Icon = name === 'daily' ? Eye : name === 'review' ? NotebookPen : Telescope;
  return <div className={`planning-choice-row border-b ${ctx.borderClass}`} data-planning-choice={name}>
    <div className={`planning-choice-symbol ${ctx.darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-600'}`}><Icon size={19} aria-hidden="true" /></div>
    <div className="planning-choice-copy">
      <div className="planning-choice-title"><h3 id={`${id}-label`}>{title}</h3></div>
      <p id={`${id}-description`} className={ctx.textSecondary}>{description}</p>
      {locked && <span className={`planning-choice-included ${ctx.textSecondary}`}><LockKeyhole size={11} aria-hidden="true" />{t('planningChoices.alwaysOn')}</span>}
      {children}
    </div>
    <button type="button" role="switch" aria-checked={checked} disabled={locked}
      aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`}
      className="planning-choice-switch" onClick={() => onChange?.(!checked)}>
      <span aria-hidden="true" className={`planning-choice-track ${checked ? 'bg-blue-600' : ctx.darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
        <span className="planning-choice-thumb" />
      </span>
    </button>
  </div>;
}

export default function PlanningChoices() {
  const ctx = useDayPlannerCtx();
  const { t } = useTranslation();
  const {
    setShowPlanningChoices, joboEnabled, setJoboEnabled, lifeplannerEnabled, setLifeplannerEnabled,
    planningPreferenceError, setShowLifePlanner,
  } = useFeaturesCtx();
  const root = useRef(null), backdrop = useRef(null);
  const id = useId();
  const close = () => setShowPlanningChoices(false);
  // The sheet is portalled outside the app. Trap keyboard focus and also make
  // the underlying app inert to pointer/screen-reader navigation, restoring
  // its exact previous state before the focus hook returns to the trigger.
  useEffect(() => {
    const siblings = [...document.body.children].filter(el => el !== backdrop.current);
    const old = siblings.map(el => [el, el.inert]);
    old.forEach(([el]) => { el.inert = true; });
    return () => old.forEach(([el, inert]) => { el.inert = inert; });
  }, []);
  useDialogFocus(root, close);
  const openJobo = () => {
    // Do not unhide a view the user explicitly hid in native Settings.
    ctx.setShowDayDial(false);
    ctx.setViewMode('jobo');
    close();
  };
  return createPortal(<div ref={backdrop} className="planning-choices-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <section ref={root} data-planning-choices role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} tabIndex={-1}
      className={`planning-choices-dialog ${ctx.cardBg} ${ctx.textPrimary}`}>
      <header className="planning-choices-heading">
        <div><span className={`planning-choices-eyebrow ${ctx.textSecondary}`}>{t('planningChoices.eyebrow')}</span><h2 id={`${id}-title`}>{t('planningChoices.title')}</h2></div>
        <button type="button" data-initial-focus className={`planning-choices-close ${ctx.hoverBg}`} aria-label={t('common.close')} onClick={close}><X size={19} /></button>
      </header>
      <p id={`${id}-intro`} className={`planning-choices-intro ${ctx.textSecondary}`}>{t('planningChoices.intro')}</p>
      <div role="group" aria-label={t('planningChoices.group')}>
        <PlanningChoiceRow name="daily" title={t('planningChoices.daily')} description={t('planningChoices.dailyDescription')} checked locked ctx={ctx} />
        <PlanningChoiceRow name="review" title={t('planningChoices.review')} description={t('planningChoices.reviewDescription')} checked={joboEnabled} onChange={setJoboEnabled} ctx={ctx}>
          {joboEnabled && <div className="planning-choice-detail">
            <small className={ctx.textSecondary}>{t('planningChoices.joboPreview')}</small>
            {ctx.canShowViewCycler && !ctx.hiddenViews.desktop.includes('jobo')
              ? <button type="button" className="planning-choice-link text-blue-500" onClick={openJobo}>{t('planningChoices.openJobo')}<ArrowUpRight size={13} /></button>
              : <small className={ctx.textSecondary}>{t(ctx.canShowViewCycler ? 'planningChoices.joboHidden' : 'planningChoices.joboDesktop')}</small>}
          </div>}
        </PlanningChoiceRow>
        <PlanningChoiceRow name="life" title={t('planningChoices.life')} description={t('planningChoices.lifeDescription')} checked={lifeplannerEnabled} onChange={setLifeplannerEnabled} ctx={ctx}>
          {lifeplannerEnabled && <button type="button" className="planning-choice-link text-blue-500" onClick={() => { close(); setShowLifePlanner(true); }}>{t('planningChoices.openLife')}<ArrowUpRight size={13} /></button>}
        </PlanningChoiceRow>
      </div>
      {planningPreferenceError && <p role="alert" className="planning-choices-error text-red-500">{t(`planningChoices.${planningPreferenceError}Error`)}</p>}
      <footer className="planning-choices-footer"><p className={ctx.textSecondary}>{t('planningChoices.keepsData')}</p><button type="button" className="planning-choices-done bg-blue-600 text-white hover:bg-blue-700" onClick={close}>{t('planningChoices.done')}</button></footer>
    </section>
  </div>, document.body);
}
