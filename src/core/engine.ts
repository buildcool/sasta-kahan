import { getConfig } from './config.ts';
import { fetchText } from './fetcher.ts';
import { condenseTitle, makeReference, type Reference } from './matcher.ts';
import { dedupeOffers } from './offers.ts';
import { buildRequest, manualUrl } from './parse.ts';
import { flagOutliers, priceFor, readProductPage, readSearch, refineWithPage, sortResults, type FetchResult, type SiteCheck } from './search.ts';
import { cleanSharedText, cleanStoreTitle, isProductTitle } from './share.ts';
import type { Category, Offer, SiteConfig, SiteResult, Wallet } from './types.ts';

export { sortResults } from './search.ts';

export interface SearchInput {
  /** What to search on each site. */
  query: string;
  /** What "same product" means — the query itself, or a chosen product's full title. */
  ref?: Reference;
  wallet: Wallet;
  onUpdate: (results: SiteResult[]) => void;
  signal?: AbortSignal;
  /** Ignore the 10-minute cache and any cool-down (the Refresh button). */
  fresh?: boolean;
}

const CACHE_MS = 10 * 60 * 1000;
/** Product pages opened per search (for bank offers and pack size); keeps us gentle on the sites. */
const MAX_PRODUCT_PAGES = 6;
const searchCache = new Map<string, { at: number; res: FetchResult }>();
const pageCache = new Map<string, { at: number } & ReturnType<typeof readProductPage>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A site that blocked us gets a rest (5 min, then 20, then 60) instead of more requests,
// which would only get the phone's IP blocked for longer.
const BACKOFF_KEY = 'sk.backoff';
const BACKOFF_MIN = [5, 20, 60];
type Backoff = Record<string, { until: number; strikes: number }>;

function loadBackoff(): Backoff {
  try {
    return JSON.parse(localStorage.getItem(BACKOFF_KEY) ?? '{}') as Backoff;
  } catch {
    return {};
  }
}

function saveBackoff(b: Backoff) {
  try {
    localStorage.setItem(BACKOFF_KEY, JSON.stringify(b));
  } catch {
    // private mode / storage full — the cool-down just won't survive a restart
  }
}

export function pausedUntil(siteId: string): number | undefined {
  const b = loadBackoff()[siteId];
  return b && b.until > Date.now() ? b.until : undefined;
}

function noteBlocked(siteId: string) {
  const b = loadBackoff();
  const strikes = Math.min((b[siteId]?.strikes ?? 0) + 1, BACKOFF_MIN.length);
  b[siteId] = { strikes, until: Date.now() + BACKOFF_MIN[strikes - 1] * 60_000 };
  saveBackoff(b);
}

function noteOk(siteId: string) {
  const b = loadBackoff();
  if (!b[siteId]) return;
  delete b[siteId];
  saveBackoff(b);
}

export function sitesFor(cats: Category[]): { fetch: SiteConfig[]; manualOnly: SiteConfig[] } {
  const general = cats.includes('general');
  const relevant = getConfig().sites.filter((s) =>
    general ? s.fetch !== false || s.categories.includes('general') : s.categories.some((c) => cats.includes(c)),
  );
  return {
    fetch: relevant.filter((s) => s.fetch !== false),
    manualOnly: relevant.filter((s) => s.fetch === false),
  };
}

async function searchSite(site: SiteConfig, query: string, ref: Reference, fresh?: boolean): Promise<{ check: SiteCheck; at: number }> {
  const req = buildRequest(site, query);
  const key = `${req.method} ${req.url} ${req.body ?? ''}`;
  const hit = searchCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return { check: readSearch(site, hit.res, ref), at: hit.at };
  let res = await fetchText(req);
  let check = readSearch(site, res, ref);
  if (check.reason === 'empty-page') {
    // A busy-moment empty page: one calm retry usually gets the real results.
    await sleep(1500);
    res = await fetchText(req);
    check = readSearch(site, res, ref);
  }
  const at = Date.now();
  // Only cache real answers — never a captcha or an empty busy page.
  if (check.status !== 'blocked' && check.status !== 'error') searchCache.set(key, { at, res });
  return { check, at };
}

async function productPage(site: SiteConfig, url: string, fresh?: boolean) {
  const hit = pageCache.get(url);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit;
  try {
    const res = await fetchText({ url, method: 'GET', headers: {} });
    if (res.status === 403 || res.status === 429) noteBlocked(site.id);
    if (res.status !== 200) return undefined;
    const page = { at: Date.now(), ...readProductPage(res.body, site.id) };
    pageCache.set(url, page);
    return page;
  } catch {
    return undefined;
  }
}

/** Run one comparison. Results stream in through onUpdate as each site answers. */
export async function runSearch(input: SearchInput): Promise<SiteResult[]> {
  const { query, wallet, onUpdate, signal, fresh } = input;
  const ref = input.ref ?? makeReference(query, 'query');
  const { fetch: toFetch, manualOnly } = sitesFor(ref.cats);
  const config = getConfig();

  const results: SiteResult[] = [
    ...toFetch.map((site): SiteResult => {
      const paused = !fresh && pausedUntil(site.id);
      return paused
        ? { site, status: 'blocked', listings: [], error: `paused:${paused}`, manualUrl: manualUrl(site, query) }
        : { site, status: 'loading', listings: [], manualUrl: manualUrl(site, query) };
    }),
    ...manualOnly.map((site): SiteResult => ({ site, status: 'manual', listings: [], manualUrl: manualUrl(site, query) })),
  ];
  const emit = () => !signal?.aborted && onUpdate(sortResults(flagOutliers([...results])));
  emit();

  const update = (site: SiteConfig, patch: Partial<SiteResult>) => {
    const i = results.findIndex((r) => r.site.id === site.id);
    results[i] = { ...results[i], ...patch };
    emit();
  };

  let pages = 0;
  const live = results.filter((r) => r.status === 'loading').map((r) => r.site);
  await Promise.all(
    live.map(async (site) => {
      try {
        const { check, at } = await searchSite(site, query, ref, fresh);
        if (signal?.aborted) return;
        if (check.status === 'blocked') noteBlocked(site.id);
        else noteOk(site.id);
        const staticOffers = config.offers.filter((o) => o.site === site.id);
        const best = check.best && priceFor(check.best, staticOffers, wallet, site);
        update(site, { status: check.status, listings: check.listings, best, error: check.error ?? check.reason, checkedAt: at });

        // Second step (background): product page → bank offers, and the pack size when the title didn't show it.
        if (!check.best || site.productOffers === false || check.best.match === 'size' || pages >= MAX_PRODUCT_PAGES) return;
        pages++;
        const page = await productPage(site, check.best.url, fresh);
        if (signal?.aborted || !page) return;
        const offers = dedupeOffers([...page.offers, ...staticOffers]);
        update(site, { best: priceFor(refineWithPage(check.best, ref, page.facts), offers, wallet, site), offers });
      } catch (e) {
        if (!signal?.aborted) update(site, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  return sortResults(flagOutliers(results));
}

/** Recompute effective prices after the user changes their cards / apps (no network). */
export function repriceForWallet(results: SiteResult[], wallet: Wallet): SiteResult[] {
  const config = getConfig();
  return sortResults(
    flagOutliers(
      results.map((r) => {
        if (!r.best) return r;
        const offers: Offer[] = r.offers ?? config.offers.filter((o) => o.site === r.site.id);
        return { ...r, best: priceFor(r.best, offers, wallet, r.site) };
      }),
    ),
  );
}

const URL_RE = /https?:\/\/[^\s<>"']+/i;

export function extractUrl(text: string): string | undefined {
  return text.match(URL_RE)?.[0];
}

/** Product title from a shared link: page's og:title / JSON-LD / <title>, cleaned of store suffixes. */
export async function titleFromUrl(url: string): Promise<string | undefined> {
  const res = await fetchText({ url, method: 'GET', headers: {} });
  if (res.status !== 200) return undefined;
  const html = res.body;
  const pick = (re: RegExp) => html.match(re)?.[1];
  const raw =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ??
    pick(/"@type"\s*:\s*"Product"[\s\S]{0,400}?"name"\s*:\s*"([^"]+)"/) ??
    pick(/<span[^>]+id=["']productTitle["'][^>]*>\s*([^<]+)/i) ??
    pick(/<title[^>]*>([^<]+)/i);
  const title = raw && cleanStoreTitle(decodeEntities(raw));
  return isProductTitle(title) ? title : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Turn whatever the user gave us (words, link, shared text) into a search. */
export async function resolveInput(text: string): Promise<{ query: string; ref: Reference; from: 'text' | 'link' }> {
  const url = extractUrl(text);
  if (!url) return { query: text.trim(), ref: makeReference(text.trim(), 'query'), from: 'text' };
  // The product page's own title is the most reliable (it has the brand; share messages often don't).
  // The share message is the fallback when the page can't be read.
  const shared = cleanSharedText(text);
  const title = (await titleFromUrl(url).catch(() => undefined)) ?? (shared.length > 10 ? shared : undefined);
  if (!title) throw new Error('no-title');
  return { query: condenseTitle(title), ref: makeReference(title, 'product'), from: 'link' };
}
