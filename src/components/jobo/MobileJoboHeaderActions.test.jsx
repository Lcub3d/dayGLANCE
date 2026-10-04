import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
const { default: MobileJoboHeaderActions, JOBO_MOBILE_ACTION_EVENT } = await import('./MobileJoboHeaderActions.jsx');
const { JOBO_PREFERENCE_EVENT } = await import('../../hooks/useJoboPreference.js');

// JOBO's buttons in the phone's date header (slice 8, step 3) tell the JOBO
// view what was asked: the header is the layout's, the sheets the view's.

afterEach(() => vi.unstubAllGlobals());
const tree = (features) => {
  let out;
  const Probe = () => { out = MobileJoboHeaderActions({}); return null; };
  renderToStaticMarkup(<FeaturesContext.Provider value={features}><Probe /></FeaturesContext.Provider>);
  return out;
};
const buttons = (node) => node.props.children;
const storage = (entries = {}) => {
  const store = new Map(Object.entries(entries));
  return { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), store };
};

describe('MobileJoboHeaderActions', () => {
  it('Check, Statistics and Add Do, each sending its action and nothing else', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const stopPropagation = vi.fn();
    const [, ...actions] = buttons(tree({ joboWritable: true }));
    for (const button of actions) button.props.onClick({ stopPropagation });
    expect(dispatchEvent.mock.calls.map(([event]) => [event.type, event.detail.action])).toEqual([
      [JOBO_MOBILE_ACTION_EVENT, 'check'], [JOBO_MOBILE_ACTION_EVENT, 'statistics'], [JOBO_MOBILE_ACTION_EVENT, 'add'],
    ]);
    // The header's own tap (a new all-day task on a tablet) does not fire too.
    expect(stopPropagation).toHaveBeenCalledTimes(3);
  });

  it('Add Do is off while the ledger is read only', () => {
    const [, , , add] = buttons(tree({ joboWritable: false }));
    expect(add.props.disabled).toBe(true);
  });

  // The side-by-side toggle is a remembered choice, not an action: it shows
  // what is stored, and a tap stores the change and tells the view.
  it('the side-by-side toggle shows the stored choice, off by default', () => {
    vi.stubGlobal('localStorage', storage());
    expect(buttons(tree({ joboWritable: true }))[0].props['aria-pressed']).toBe(false);
    vi.stubGlobal('localStorage', storage({ 'dg-jobo-mobile-balanced': '1' }));
    expect(buttons(tree({ joboWritable: true }))[0].props['aria-pressed']).toBe(true);
  });

  it('a tap on it stores the choice and tells the view, and sends no action', () => {
    const local = storage();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('window', { dispatchEvent, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const stopPropagation = vi.fn();
    buttons(tree({ joboWritable: true }))[0].props.onClick({ stopPropagation });
    expect(local.store.get('dg-jobo-mobile-balanced')).toBe('1');
    expect(dispatchEvent.mock.calls.map(([event]) => [event.type, event.detail])).toEqual([
      [JOBO_PREFERENCE_EVENT, { name: 'mobile-balanced', on: true }],
    ]);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});
