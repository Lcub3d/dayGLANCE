import { checkRateLimit, clientIp } from './_proxyGuard.js';

const DEFAULT_TOKEN_URL = 'https://hnoauth-login.cloud.hihonor.com/oauth2/v3/token';
const DEFAULT_REDIRECT_URI = 'honorid://redirect_url';

export function buildHonorTokenParams(body, config) {
  const grantType = body?.grantType;
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    throw new Error('Unsupported grant type');
  }

  const params = new URLSearchParams({
    grant_type: grantType,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  if (grantType === 'authorization_code') {
    if (!body?.code) throw new Error('Missing authorization code');
    params.set('code', body.code);
    params.set('redirect_uri', config.redirectUri);
  } else {
    if (!body?.refreshToken) throw new Error('Missing refresh token');
    params.set('refresh_token', body.refreshToken);
  }

  return params;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rate = checkRateLimit(clientIp(req));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  }

  const clientId = process.env.HONOR_APP_ID || '';
  const clientSecret = process.env.HONOR_CLIENT_SECRET || '';
  const redirectUri = process.env.HONOR_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const tokenUrl = process.env.HONOR_TOKEN_URL || DEFAULT_TOKEN_URL;

  if (!clientId || !clientSecret) {
    return res.status(503).json({ error: 'HONOR account integration is not configured' });
  }

  let params;
  try {
    params = buildHonorTokenParams(req.body, { clientId, clientSecret, redirectUri });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const payload = await response.json().catch(() => ({}));

    res.setHeader('Cache-Control', 'no-store');
    if (!response.ok) {
      return res.status(502).json({
        error: payload.error_description || payload.error || 'HONOR token exchange failed',
      });
    }

    return res.status(200).json({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresIn: Number(payload.expires_in) || 0,
      tokenType: payload.token_type || null,
      scope: payload.scope || null,
    });
  } catch (_) {
    return res.status(502).json({ error: 'HONOR token exchange failed' });
  }
}
