import { rejectIfBlocked } from './_proxyGuard.js';
import { assertSafeUrl, SsrfError } from './_ssrfGuard.mjs';

// Disable Vercel's default body parser so we can forward raw request bodies
// (e.g. text/calendar) without them being mangled or rejected as unsupported.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, MKCOL, PROPFIND, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-WebDAV-Auth, Content-Type, Depth, If-Match, If-None-Match');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // Origin allowlist + per-IP rate limiting, applied after the (unauthenticated)
  // CORS preflight. Only the web/PWA build reaches this hosted endpoint; native
  // apps and Electron fetch directly.
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
    const headers = {};

    // Only set Content-Type for requests that have a body — sending it on
    // bodyless methods (GET, HEAD, PROPFIND, DELETE, MKCOL) causes Apache
    // mod_dav to return 4xx errors.
    const bodylessMethods = new Set(['GET', 'HEAD', 'PROPFIND', 'DELETE', 'MKCOL']);
    if (!bodylessMethods.has(req.method)) {
      headers['Content-Type'] = req.headers['content-type'] || 'application/octet-stream';
    }

    // Forward X-WebDAV-Auth as Authorization
    if (req.headers['x-webdav-auth']) {
      headers['Authorization'] = req.headers['x-webdav-auth'];
    }

    if (req.headers['depth'] !== undefined) {
      headers['Depth'] = req.headers['depth'];
    }

    // Forward optimistic-concurrency headers.
    if (req.headers['if-match']) {
      headers['If-Match'] = req.headers['if-match'];
    }
    if (req.headers['if-none-match']) {
      headers['If-None-Match'] = req.headers['if-none-match'];
    }

    const fetchOptions = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBody = await readRawBody(req);
      if (rawBody) {
        fetchOptions.body = rawBody;
      }
    }

    const response = await fetch(url, fetchOptions);
    const body = await response.text();

    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.setHeader('Cache-Control', 'no-store');
    const etag = response.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Failed to proxy WebDAV request' });
  }
}
