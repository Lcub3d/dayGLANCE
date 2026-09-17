import { rejectIfBlocked } from './_proxyGuard.js';
import { safeRequest, SsrfError } from './_ssrfGuard.mjs';

export default async function handler(req, res) {
  // Origin allowlist + per-IP rate limiting. Only the web/PWA build reaches
  // this hosted endpoint; native apps and Electron fetch directly.
  if (rejectIfBlocked(req, res)) return;

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const fetchHeaders = { Accept: 'text/calendar, text/plain, */*' };
    const calendarAuth = req.headers['x-calendar-auth'];
    if (calendarAuth) {
      fetchHeaders['Authorization'] = calendarAuth;
    }
    // Hosted deployment: NO allowPrivate. See api/_ssrfGuard.mjs for the policy,
    // the per-hop redirect re-validation and the connection pinning.
    const response = await safeRequest(url, { headers: fetchHeaders });

    res.setHeader('Content-Type', response.headers['content-type'] || 'text/plain');
    res.setHeader('Cache-Control', 'no-store');
    res.status(response.status).send(response.body);
  } catch (err) {
    if (err instanceof SsrfError) return res.status(err.status).json({ error: err.message });
    res.status(502).json({ error: 'Failed to fetch calendar' });
  }
}
