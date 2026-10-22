// Background price checker, run by Capacitor Background Runner every few hours,
// even when the app is closed. It runs in a bare JS engine (QuickJS): no DOM, no
// window, no URL/Intl, no Capacitor plugins — only fetch, timers and the runner's
// CapacitorKV / CapacitorNotifications. CapacitorKV is configured to read the same
// storage as the app (capacitor.config.ts: label "CapacitorStorage").
import { parseHTML } from 'linkedom';
import { alertText } from '../core/alerts.ts';
import { CONFIG_KEY, chooseConfig, type AppConfig, type CachedConfig } from '../core/configData.ts';
import { EMPTY_WALLET, expandWallet } from '../core/effectivePrice.ts';
import { makeReference } from '../core/matcher.ts';
import type { SiteRequest } from '../core/parse.ts';
import { checkSite, flagOutliers, priceFor, type FetchResult } from '../core/search.ts';
import type { SiteResult, Wallet } from '../core/types.ts';
import { applyCheck, isStale, lowestExact, mergeItems, type WatchItem } from '../core/watchLogic.ts';
import type { Lang } from '../strings.ts';

declare const CapacitorKV: { get(key: string): { value?: string | null } | string | null | undefined; set(key: string, value: string): void };
declare const CapacitorNotifications: { schedule(options: object[]): void };
declare function addEventListener(event: string, handler: (resolve: (v?: unknown) => void, reject: (e?: unknown) => void, args: unknown) => void): void;

/** A bit under the 4-hour schedule, so a run that comes a little early still checks. */
const RECHECK_MS = 3.5 * 60 * 60 * 1000;
const MAX_ITEMS = 6;
const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

function kvGet<T>(key: string, fallback: T): T {
  try {
    const v = CapacitorKV.get(key);
    const s = typeof v === 'string' ? v : v?.value;
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a timeout (the runner's fetch has no AbortSignal). Never rejects. */
function fetchText(req: SiteRequest): Promise<FetchResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: 0, body: '' }), TIMEOUT_MS);
    fetch(req.url, {
      method: req.method,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...req.headers },
      body: req.body,
    })
      .then(async (r) => ({ status: r.status, body: await r.text() }))
      .catch(() => ({ status: 0, body: '' }))
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      });
  });
}

const parseHtml = (html: string) => parseHTML(html).document as unknown as Document;

/** Search the item on every relevant site at once (one request per site), like the app does. */
async function searchItem(item: WatchItem, config: AppConfig, wallet: Wallet): Promise<SiteResult[]> {
  const ref = item.refTitle ? makeReference(item.refTitle, 'product') : makeReference(item.query, 'query');
  const general = ref.cats.includes('general');
  const sites = config.sites.filter((s) => s.fetch !== false && (general || s.categories.some((c) => ref.cats.includes(c))));
  const results = await Promise.all(
    sites.map(async (site): Promise<SiteResult> => {
      try {
        const check = await checkSite(site, item.query, ref, fetchText, parseHtml);
        const offers = config.offers.filter((o) => o.site === site.id);
        return { site, status: check.status, listings: [], best: check.best && priceFor(check.best, offers, wallet, site), manualUrl: '' };
      } catch {
        return { site, status: 'error', listings: [], manualUrl: '' };
      }
    }),
  );
  return flagOutliers(results);
}

export async function checkWatchlist(now = Date.now()): Promise<number> {
  const settings = kvGet<{ background?: boolean; lang?: Lang }>('settings', {});
  if (settings.background === false) return 0;
  const lang = settings.lang ?? 'en';
  const wallet = expandWallet({ ...EMPTY_WALLET, ...kvGet<Partial<Wallet>>('wallet', {}) });
  const config = chooseConfig(kvGet<CachedConfig | null>(CONFIG_KEY, null));
  const due = kvGet<WatchItem[]>('watch', [])
    .filter((x) => isStale(x, RECHECK_MS, now))
    .sort((a, b) => a.lastChecked - b.lastChecked)
    .slice(0, MAX_ITEMS);

  for (const [i, item] of due.entries()) {
    if (i) await sleep(2000); // be gentle: a short pause between products
    const { item: next, alert } = applyCheck(item, lowestExact(await searchItem(item, config, wallet)), Date.now());
    // Save after every item: the OS can stop background work at any moment.
    CapacitorKV.set('watch', JSON.stringify(mergeItems(kvGet<WatchItem[]>('watch', []), [next])));
    if (alert) {
      const { title, body } = alertText(alert, next, lang);
      CapacitorNotifications.schedule([{ id: Math.floor(Math.random() * 2_000_000_000), title, body, smallIcon: 'ic_stat_icon', autoCancel: true }]);
    }
  }
  return due.length;
}

addEventListener('checkWatchlist', async (resolve) => {
  try {
    const n = await checkWatchlist();
    console.log(`SastaKahan: checked ${n} watched items`);
  } catch (e) {
    console.error(`SastaKahan background check failed: ${String(e)}`);
  }
  resolve();
});
