import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Dev-only proxy: lets the browser preview (npm run dev) fetch shopping sites
 * without CORS. Runs inside Vite on your own phone, so requests still come
 * from your IP. The APK doesn't use this — it fetches natively.
 */
function devProxy(): Plugin {
  return {
    name: 'sk-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__proxy', async (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://x').searchParams.get('url');
          if (!url || !/^https:\/\//.test(url)) {
            res.statusCode = 400;
            return res.end('bad url');
          }
          const headers = JSON.parse(String(req.headers['x-proxy-headers'] ?? '{}'));
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const upstream = await fetch(url, {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
            redirect: 'follow',
          });
          res.statusCode = upstream.status;
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'text/plain');
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devProxy()],
  // localhost only: the proxy must not be reachable from other devices on your Wi-Fi.
  server: { host: '127.0.0.1' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
