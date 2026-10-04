import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
const { default: MobileJoboHeaderActions, JOBO_MOBILE_ACTION_EVENT } = await import('./MobileJoboHeaderActions.jsx');

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

describe('MobileJoboHeaderActions', () => {
  it('Check, Statistics and Add Do, each sending its action and nothing else', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const stopPropagation = vi.fn();
    for (const button of buttons(tree({ joboWritable: true }))) button.props.onClick({ stopPropagation });
    expect(dispatchEvent.mock.calls.map(([event]) => [event.type, event.detail.action])).toEqual([
      [JOBO_MOBILE_ACTION_EVENT, 'check'], [JOBO_MOBILE_ACTION_EVENT, 'statistics'], [JOBO_MOBILE_ACTION_EVENT, 'add'],
    ]);
    // The header's own tap (a new all-day task on a tablet) does not fire too.
    expect(stopPropagation).toHaveBeenCalledTimes(3);
  });

  it('Add Do is off while the ledger is read only', () => {
    const [, , add] = buttons(tree({ joboWritable: false }));
    expect(add.props.disabled).toBe(true);
  });
});
