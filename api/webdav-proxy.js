import { rejectIfBlocked } from './_proxyGuard.js';
import { safeRequest, SsrfError } from './_ssrfGuard.mjs';

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

    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBody = await readRawBody(req);
      if (rawBody) body = rawBody;
    }

    // Hosted deployment: NO allowPrivate. These functions run on Vercel, where a
    // private target is never the user's own machine and always someone else's
    // internal network. The self-hosted image takes the other posture; the
    // policy, the redirect re-validation and the connection pinning are shared
    // (api/_ssrfGuard.mjs).
    const response = await safeRequest(url, { method: req.method, headers, body });

    res.setHeader('Content-Type', response.headers['content-type'] || 'text/plain');
    res.setHeader('Cache-Control', 'no-store');
    if (response.headers.etag) res.setHeader('ETag', response.headers.etag);
    res.status(response.status).send(response.body);
  } catch (err) {
    // A policy refusal (including on a redirect hop) carries its own status.
    if (err instanceof SsrfError) return res.status(err.status).json({ error: err.message });
    res.status(502).json({ error: 'Failed to proxy WebDAV request' });
  }
}
