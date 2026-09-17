import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { assertSafeUrl, SsrfError } from './api/_ssrfGuard.mjs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// ---------------------------------------------------------------------------
// Dev-only middleware that replicates the Vercel serverless functions for
// /api/webdav-proxy/ and /api/calendar-proxy/ so `npm run dev` works
// identically to the deployed environment.
// ---------------------------------------------------------------------------
function devApiProxy() {
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  return {
    name: 'dev-api-proxy',
    configureServer(server) {

      // ── /api/webdav-proxy/ ──────────────────────────────────────────────
      server.middlewares.use('/api/webdav-proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Max-Age': '86400' });
          return res.end();
        }

        const targetUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!targetUrl) return sendJson(res, 400, { error: 'Missing url parameter' });

        // The dev server runs on the developer's own machine, so it takes the
        // SELF-HOST posture: private/LAN targets are reachable (you may well be
        // developing against a NAS or a container), metadata and reserved
        // ranges never are. Same shared policy as the other three proxies.
        try { await assertSafeUrl(targetUrl, { allowPrivate: true }); }
        catch (err) { return sendJson(res, err instanceof SsrfError ? err.status : 400, { error: err.message }); }

        const headers = {};
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          headers['Content-Type'] = req.headers['content-type'] || 'application/octet-stream';
        }
        if (req.headers['x-webdav-auth']) headers['Authorization'] = req.headers['x-webdav-auth'];
        if (req.headers['depth'] !== undefined) headers['Depth'] = req.headers['depth'];

        const body = (req.method !== 'GET' && req.method !== 'HEAD')
          ? await readBody(req) : undefined;

        try {
          const response = await fetch(targetUrl, {
            method: req.method,
            headers,
            ...(body ? { body } : {}),
          });
          const responseBody = await response.text();
          res.writeHead(response.status, {
            'Content-Type': response.headers.get('content-type') || 'text/plain',
          });
          res.end(responseBody);
        } catch {
          sendJson(res, 502, { error: 'Failed to proxy WebDAV request' });
        }
      });

      // ── /api/calendar-proxy/ ────────────────────────────────────────────
      server.middlewares.use('/api/calendar-proxy', async (req, res) => {
        const targetUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!targetUrl) return sendJson(res, 400, { error: 'Missing url parameter' });

        // The dev server runs on the developer's own machine, so it takes the
        // SELF-HOST posture: private/LAN targets are reachable (you may well be
        // developing against a NAS or a container), metadata and reserved
        // ranges never are. Same shared policy as the other three proxies.
        try { await assertSafeUrl(targetUrl, { allowPrivate: true }); }
        catch (err) { return sendJson(res, err instanceof SsrfError ? err.status : 400, { error: err.message }); }

        const fetchHeaders = { Accept: 'text/calendar, text/plain, */*' };
        if (req.headers['x-calendar-auth']) fetchHeaders['Authorization'] = req.headers['x-calendar-auth'];

        try {
          const response = await fetch(targetUrl, { headers: fetchHeaders });
          const responseBody = await response.text();
          res.writeHead(response.status, {
            'Content-Type': response.headers.get('content-type') || 'text/plain',
            'Cache-Control': 'public, max-age=900, stale-while-revalidate=60',
          });
          res.end(responseBody);
        } catch {
          sendJson(res, 502, { error: 'Failed to fetch calendar' });
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    // Not an Electron MAS build; keeps the shared components' __MAS_BUILD__ reference defined.
    __MAS_BUILD__: 'false',
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5174,
  },
  build: {
    sourcemap: false,
  },
  plugins: [
    devApiProxy(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,ico,svg}'],
        globIgnores: ['**/service-worker.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB — the main chunk crossed 3 MiB in 2026-08
      },
      manifest: {
        name: 'dayGLANCE',
        short_name: 'dayGLANCE',
        description: 'A beautiful time-blocking day planner with task management',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        url_handlers: [
          { origin: 'https://dayglance.app' },
        ],
      },
    }),
  ],
})
