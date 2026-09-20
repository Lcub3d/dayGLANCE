import { describe, it, expect } from 'vitest';
import { buildCalendarProxyUrl } from './calendarProxyUrl.js';

// Mirrors how both proxies read the parameter: the hosted function via
// req.query.url, the dev middleware via searchParams.get('url').
const targetSeenByProxy = (proxyUrl) =>
  new URL(proxyUrl, 'http://localhost').searchParams.get('url');

describe('buildCalendarProxyUrl (issue #1748)', () => {
  it('round-trips a feed URL with multiple query parameters', () => {
    const feed = 'https://usosapps.uw.edu.pl/services/tt/upcoming_ical?lang=pl&user_id=ID&key=KEY';
    expect(targetSeenByProxy(buildCalendarProxyUrl(feed))).toBe(feed);
  });

  it('percent-encodes the separators that leaked into the outer request', () => {
    const built = buildCalendarProxyUrl('https://example.com/cal.ics?a=1&b=2');
    expect(built).not.toContain('&b=2');
    expect(built).toContain('%26b%3D2');
  });

  it('round-trips URLs with characters that survive a naive encodeURI', () => {
    for (const feed of [
      'https://example.com/cal.ics?q=a+b&r=c%20d',
      'https://example.com/cal.ics?filter=a=b&next=x#frag',
      'https://user:pw@example.com/private/cal.ics?tok=a/b+c',
      'https://example.com/cal.ics?name=Zaj%C4%99cia&t=1',
    ]) {
      expect(targetSeenByProxy(buildCalendarProxyUrl(feed))).toBe(feed);
    }
  });

  it('keeps the trailing-slash path the proxies are mounted on', () => {
    expect(buildCalendarProxyUrl('https://example.com/c.ics')).toMatch(/^\/api\/calendar-proxy\/\?url=/);
  });
});
