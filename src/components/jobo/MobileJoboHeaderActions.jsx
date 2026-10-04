import React from 'react';
import { BarChart3, ClipboardCheck, Columns2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import useJoboPreference from '../../hooks/useJoboPreference.js';

/** The event the header's buttons send to the phone's JOBO view (MobileJoboView). */
export const JOBO_MOBILE_ACTION_EVENT = 'dayglance:jobo-mobile-action';

/** The balanced view's preference (hooks/useJoboPreference.js), this device's. */
export const JOBO_BALANCED_PREFERENCE = 'mobile-balanced';

/**
 * JOBO's three buttons in the phone's date header (slice 8, step 3, as the
 * design note places them): the Check and the statistics, each as a sheet,
 * and Add Do. The header belongs to the layout and the sheets to the JOBO
 * view, so the buttons say what was asked with a window event rather than
 * reaching across. Shown only with the JOBO view on screen.
 *
 * First, the balanced view's toggle: Plan and Do at half the width each, both
 * as cards, for comparing them. It is a remembered preference rather than an
 * action, shared with the view through useJoboPreference, so the button shows
 * it pressed. Off, the view is the wide side and the narrow lane, unchanged.
 */
export default function MobileJoboHeaderActions({ className = '' }) {
  const { t } = useTranslation();
  const { joboWritable } = useFeaturesCtx();
  const [balanced, toggleBalanced] = useJoboPreference(JOBO_BALANCED_PREFERENCE);
  const send = (action) => (event) => {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent(JOBO_MOBILE_ACTION_EVENT, { detail: { action } }));
  };
  // A little tighter on the narrowest phones, so the date beside them keeps
  // to one line.
  const button = 'p-1 min-[360px]:p-1.5 rounded-lg text-blue-600 dark:text-blue-400 active:bg-blue-50 dark:active:bg-blue-950/30 disabled:opacity-40';
  return (
    <div data-jobo-header-actions className={`flex items-center gap-0.5 ${className}`}>
      <button type="button" data-jobo-header-action="balanced" aria-pressed={balanced}
        onClick={(event) => { event.stopPropagation(); toggleBalanced(); }}
        className={`${button} ${balanced ? 'bg-blue-100 dark:bg-blue-900/40' : ''}`}
        aria-label={t('jobo.mobile.balanced')} title={t('jobo.mobile.balanced')}>
        <Columns2 size={18} />
      </button>
      <button type="button" data-jobo-header-action="check" onClick={send('check')} className={button}
        aria-label={t('jobo.check.button')} title={t('jobo.check.button')}>
        <ClipboardCheck size={18} />
      </button>
      <button type="button" data-jobo-header-action="statistics" onClick={send('statistics')} className={button}
        aria-label={t('jobo.statistics.button')} title={t('jobo.statistics.button')}>
        <BarChart3 size={18} />
      </button>
      <button type="button" data-jobo-header-action="add" onClick={send('add')} className={button} disabled={!joboWritable}
        aria-label={t('jobo.view.addDo')} title={t('jobo.view.addDo')}>
        <Plus size={18} strokeWidth={2.5} />
      </button>
    </div>
  );
}
