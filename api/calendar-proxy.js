import { rejectIfBlocked } from './_proxyGuard.js';
import { assertSafeUrl, SsrfError } from './_ssrfGuard.mjs';

export default async function handler(req, res) {
  // Origin allowlist + per-IP rate limiting. Only the web/PWA build reaches
  // this hosted endpoint; native apps and Electron fetch directly.
  if (rejectIfBlocked(req, res)) return;

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Hosted deployment: NO allowPrivate. These functions run on Vercel, where a
  // private target is never the user's own machine and always someone else's
  // internal network. The self-hosted image takes the other posture; the policy
  // itself is shared (api/_ssrfGuard.mjs).
  try {
    await assertSafeUrl(url);
  } catch (err) {
    const status = err instanceof SsrfError ? err.status : 400;
    return res.status(status).json({ error: err.message });
  }

  try {
    const fetchHeaders = { Accept: 'text/calendar, text/plain, */*' };
    const calendarAuth = req.headers['x-calendar-auth'];
    if (calendarAuth) {
      fetchHeaders['Authorization'] = calendarAuth;
    }
    const response = await fetch(url, { headers: fetchHeaders });

    const body = await response.text();

    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.setHeader('Cache-Control', 'no-store');
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch calendar' });
  }
}
