import { getConfig } from './config.ts';
import { fetchText } from './fetcher.ts';
import { locationKey, locationVars, type UserLocation } from './location.ts';
import { condenseTitle, makeReference, type Reference } from './matcher.ts';
import { dedupeOffers } from './offers.ts';
import { buildRequest, manualUrl, type Vars } from './parse.ts';
import {
  canCheck,
  fetchWithDc,
  flagOutliers,
  pageRequest,
  priceFor,
  readPageResult,
  readProductPage,
  readSearch,
  refineWithPage,
  runSetup,
  sortResults,
  type FetchResult,
  type Net,
  type PageResult,
  type SetupResult,
  type SiteCheck,
} from './search.ts';
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
  /** Delivery location, for quick-commerce sites. */
  location?: UserLocation;
  /** Native helpers (cookie store, hidden browser); absent in the web build. */
  net?: Omit<Net, 'fetch'>;
  /** The user turned the hidden browser off (More → Check Zepto & Instamart). */
  browserOff?: boolean;
}

const CACHE_MS = 10 * 60 * 1000;
/** Product pages opened per search (for bank offers and pack size); keeps us gentle on the sites. */
const MAX_PRODUCT_PAGES = 6;
const searchCache = new Map<string, { at: number; res: FetchResult }>();
const pageCache = new Map<string, { at: number } & ReturnType<typeof readProductPage>>();
const browserCache = new Map<string, { at: number; res: PageResult }>();
const setupCache = new Map<string, { at: number; result: SetupResult }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let browserChain: Promise<unknown> = Promise.resolve();
/** Hidden-browser pages are heavy: open one at a time. */
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = browserChain.then(fn, fn);
  browserChain = run.catch(() => undefined);
  return run;
}

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

/** A site's setup (delivery location, store lookup) for this location, run once per few hours. */
async function setupFor(site: SiteConfig, loc: UserLocation | undefined, net: Net, fresh?: boolean): Promise<SetupResult> {
  const base = locationVars(loc);
  if (!site.setup?.length && !site.search.includes('{dc}')) return { ok: true, vars: base };
  const key = `${site.id}|${locationKey(loc)}`;
  const hit = setupCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < (site.setupHours ?? 6) * 3_600_000) return hit.result;
  const result = await runSetup(site, base, net);
  // Keep a working setup and a "doesn't deliver here"; anything else is retried next search.
  if (result.ok || result.check.reason === 'no-delivery') setupCache.set(key, { at: Date.now(), result });
  return result;
}

interface SiteOpts {
  fresh?: boolean;
  loc?: UserLocation;
  net: Net;
  signal?: AbortSignal;
}

async function searchSite(site: SiteConfig, query: string, ref: Reference, opts: SiteOpts): Promise<{ check: SiteCheck; at: number }> {
  const { fresh, loc, net } = opts;
  const setup = await setupFor(site, loc, net, fresh);
  if (!setup.ok) return { check: setup.check, at: Date.now() };
  const vars = setup.vars;
  if (site.browser && !site.browser.fallback) return viaBrowser(site, query, ref, vars, opts);

  const build = (v: Vars) => buildRequest(site, query, v);
  const req = build(vars);
  // Quick-commerce sites send the location in headers/cookies, so it's part of the key.
  const key = `${req.method} ${req.url} ${req.body ?? ''} ${locationKey(loc)}`;
  const hit = searchCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return { check: readSearch(site, hit.res, ref), at: hit.at };
  let res = await fetchWithDc(net, req, vars, build);
  let check = readSearch(site, res, ref);
  if (check.reason === 'empty-page') {
    // A busy-moment empty page: one calm retry usually gets the real results.
    await sleep(1500);
    res = await fetchWithDc(net, build(vars), vars, build);
    check = readSearch(site, res, ref);
  }
  if (check.status === 'blocked' && site.browser?.fallback && net.readPage) return viaBrowser(site, query, ref, vars, opts);
  const at = Date.now();
  // Only cache real answers — never a captcha or an empty busy page.
  if (check.status !== 'blocked' && check.status !== 'error') searchCache.set(key, { at, res });
  return { check, at };
}

/** Read the site in the hidden in-app browser, like opening its search page yourself. */
async function viaBrowser(site: SiteConfig, query: string, ref: Reference, vars: Vars, opts: SiteOpts): Promise<{ check: SiteCheck; at: number }> {
  const req = pageRequest(site, query, vars);
  const key = `page ${req.url} ${req.run?.url ?? ''} ${locationKey(opts.loc)}`;
  const hit = browserCache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return { check: readPageResult(site, hit.res, ref), at: hit.at };
  const res = await oneAtATime(() => (opts.signal?.aborted ? Promise.resolve<PageResult>({ captures: [], reason: 'aborted' }) : opts.net.readPage!(req)));
  const check = readPageResult(site, res, ref);
  const at = Date.now();
  if (check.status !== 'blocked' && check.status !== 'error') browserCache.set(key, { at, res });
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
  const { query, wallet, onUpdate, signal, fresh, location: loc } = input;
  const ref = input.ref ?? makeReference(query, 'query');
  const { fetch: toFetch, manualOnly } = sitesFor(ref.cats);
  const config = getConfig();
  const net: Net = { fetch: fetchText, ...input.net };

  const results: SiteResult[] = [
    ...toFetch.map((site): SiteResult => {
      // Quick-commerce sites need a delivery location; some only open in the app's hidden browser.
      const can = canCheck(site, net, loc);
      if (can !== 'yes') {
        const error = can === 'app-only' && input.browserOff && site.browser ? 'browser-off' : can;
        return { site, status: 'manual', listings: [], error, manualUrl: manualUrl(site, query) };
      }
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
        const { check, at } = await searchSite(site, query, ref, { fresh, loc, net, signal });
        if (signal?.aborted) return;
        if (check.status === 'blocked') noteBlocked(site.id);
        else noteOk(site.id);
        const staticOffers = config.offers.filter((o) => o.site === site.id);
        const best = check.best && priceFor(check.best, staticOffers, wallet, site);
        update(site, { status: check.status, listings: check.listings, best, error: check.error ?? check.reason, checkedAt: at });

        // Second step (background): product page → bank offers, and the pack size when the title didn't show it.
        // Quick-commerce results already show the pack size, and their pages are app-only.
        if (!check.best || site.productOffers === false || site.quick || check.best.match === 'size' || pages >= MAX_PRODUCT_PAGES) return;
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
