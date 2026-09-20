/**
 * Builds the same-origin /api/calendar-proxy/ request URL for an ICS/CalDAV
 * feed.
 *
 * The target URL MUST be percent-encoded. Interpolating it raw let its own
 * query separators be parsed as separators of the OUTER proxy request, so a
 * feed like `...?lang=pl&user_id=X&key=Y` reached the proxy as just
 * `...?lang=pl` and the upstream server rejected the credential-less request
 * (2026-09-20). Both proxy implementations read the parameter properly
 * (`req.query.url` on the hosted function, `searchParams.get('url')` in the
 * dev middleware), so encoding here is the whole fix.
 */
export const buildCalendarProxyUrl = (url) =>
  `/api/calendar-proxy/?url=${encodeURIComponent(url)}`;
