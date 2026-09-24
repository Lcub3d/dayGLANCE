// What a `dayglance://day?date=YYYY-MM-DD[&view=…]` link does. The widgets'
// tap target (App.jsx openDayFromLink applies the result):
//
//   view=dial    the Day Dial widget: select the day, open the dial over it
//   view=month   the month grid widget: MONTH with the day selected — its
//                sheet on a phone-width layout, the docked panel on a wide
//                one (MonthView decides which; see consumeMonthSheetRequest)
//   (none)       the day view, as before this module existed
//
// MONTH can be turned off per switcher (Settings → views). A month link on a
// device where it is off lands on that switcher's DEFAULT view scoped to the
// date instead of forcing MONTH back on.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {URLSearchParams} params   The link's query.
 * @param {object} env
 * @param {boolean} env.phoneLayout  The phone toggle drives the view (a phone,
 *                                   or a tablet in portrait); else the desktop
 *                                   cycler does. monthViewActive's split.
 * @param {{desktop: string[], mobile: string[]}} env.hiddenViews  What is off.
 * @param {string} env.defaultView        The desktop cycler's default.
 * @param {string} env.mobileDefaultView  The phone toggle's default.
 * @returns {{ date: string|null, dial: boolean, desktopView: string|null,
 *             mobileView: string|null, monthSheet: string|null }}
 *   `date` to select (null: leave the selection), `dial` to open, the view to
 *   set on each switcher (null: leave it), and the day whose MONTH sheet or
 *   panel should come up (null: none).
 */
export function resolveDayLink(params, { phoneLayout, hiddenViews, defaultView, mobileDefaultView }) {
  const raw = params.get('date');
  const date = raw && DATE_RE.test(raw) ? raw : null;
  const view = params.get('view');
  const result = { date, dial: false, desktopView: null, mobileView: null, monthSheet: null };

  if (view === 'dial') return { ...result, dial: true };

  if (view === 'month') {
    const scope = phoneLayout ? 'mobile' : 'desktop';
    const monthOn = !(hiddenViews?.[scope] || []).includes('month');
    const target = monthOn ? 'month' : (phoneLayout ? mobileDefaultView : defaultView);
    return {
      ...result,
      [phoneLayout ? 'mobileView' : 'desktopView']: target,
      monthSheet: monthOn ? date : null,
    };
  }

  // No (or an unknown) view: the day view, unchanged.
  return { ...result, desktopView: 'day' };
}

/**
 * MonthView's side of a month link. The request is the date the link asked
 * for; it is consumed (cleared) on the first render MonthView sees it, and
 * opens that day's sheet only when it is the selected day and the layout
 * uses a sheet — docked, the panel already follows the selection.
 *
 * @param {string|null} request   The pending date, or null.
 * @param {{selectedStr: string, docked: boolean}} state
 * @returns {{ open: string|null, clear: boolean }}
 */
export function consumeMonthSheetRequest(request, { selectedStr, docked }) {
  if (!request) return { open: null, clear: false };
  return { open: !docked && request === selectedStr ? request : null, clear: true };
}
