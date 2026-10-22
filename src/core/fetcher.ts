import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { SiteRequest } from './parse.ts';
import type { FetchResult } from './search.ts';

export const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const TIMEOUT_MS = 12000;

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Accept-Language': 'en-IN,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};

/**
 * Fetch a page from the user's own phone.
 * - In the APK: native HTTP (no CORS, phone's own IP) — this is what keeps the app server-free.
 * - In `npm run dev` (browser): through the tiny proxy in vite.config.ts, also running on the phone.
 */
export async function fetchText(req: SiteRequest): Promise<FetchResult> {
  const headers = { ...BASE_HEADERS, ...req.headers };
  if (Capacitor.isNativePlatform()) {
    const isJsonBody = req.body && /json/i.test(headers['Content-Type'] ?? '');
    const res = await CapacitorHttp.request({
      url: req.url,
      method: req.method,
      headers,
      data: req.body ? (isJsonBody ? JSON.parse(req.body) : req.body) : undefined,
      responseType: 'text',
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    return { status: res.status, body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`/__proxy?url=${encodeURIComponent(req.url)}`, {
      method: req.method,
      headers: { 'x-proxy-headers': JSON.stringify(headers) },
      body: req.body,
      signal: ctrl.signal,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}
