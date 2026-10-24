// Checking one site, independent of where it runs: the app (engine.ts) and the
// background price checker (runner/background.ts) both use this with their own fetch.
import { dedupe, extractJsonBlobs, getPath, stockOf } from './extract.ts';
import { effectivePrice } from './effectivePrice.ts';
import { hasNeed, locationVars, type UserLocation } from './location.ts';
import { extractQuantity, label, median, pickBest, sameQuantity, scoreListings, unitPrice, type Reference } from './matcher.ts';
import { harvestOffers } from './offers.ts';
import { buildRequest, fill, parseResponse, templateRequest, type HtmlParser, type SiteRequest, type Vars } from './parse.ts';
import type { Listing, MatchWhy, Offer, ScoredListing, SiteConfig, SiteResult, SiteStatus, Wallet } from './types.ts';

export interface FetchResult {
  status: number;
  body: string;
}
export type Fetcher = (req: SiteRequest) => Promise<FetchResult>;

/** Open a page in the hidden in-app browser (Android) and return what it saw. */
export interface PageRequest {
  url: string;
  /** Cookie header lines to set first, per URL ("name=value; path=/"). */
  cookies: { url: string; value: string }[];
  /** Keep the page's own responses whose URL matches this regular expression. */
  capture?: string;
  /** Or: run this request inside the page once it has loaded. */
  run?: SiteRequest;
  /** Origins allowed to report back, e.g. "https://www.zepto.com". */
  origins: string[];
  timeoutMs: number;
}

export interface PageResult {
  captures: { url: string; status: number; body: string }[];
  /** Page title and the start of its text, to tell "pick your location" or a block page apart. */
  title?: string;
  text?: string;
  /** Why it stopped: "done", "timeout" or "crash". */
  reason?: string;
}

/** How a check reaches the sites. The app, the background checker and the scripts each bring their own. */
export interface Net {
  fetch: Fetcher;
  /** Cookies the HTTP layer holds for a URL (the app's WebView cookie store). */
  cookies?: (url: string) => Promise<Record<string, string>>;
  readPage?: (req: PageRequest) => Promise<PageResult>;
}

export interface SiteCheck {
  status: Exclude<SiteStatus, 'loading' | 'manual'>;
  listings: ScoredListing[];
  best?: ScoredListing;
  /**
   * 'empty-page': the site sent a page without products or a "no results" message.
   * 'no-delivery': the site doesn't deliver to the user's location.
   */
  reason?: string;
  error?: string;
}

const isBlockedStatus = (s: number) => s === 403 || s === 429 || s === 503 || s === 202;

/** True when a response says the site doesn't deliver here. */
const NO_DELIVERY = /not\s+(?:yet\s+)?(?:serviceable|deliver(?:ing)?|available\s+(?:in|at)\s+your)|coming soon to your|outside (?:our|the) delivery|don'?t deliver|unserviceable/i;

/** Read a site's search response and pick the listing that is this product. */
export function readSearch(site: SiteConfig, res: FetchResult, ref: Reference, parseHtml?: HtmlParser): SiteCheck {
  // 202 with no body is how AWS WAF asks for its browser challenge.
  if (isBlockedStatus(res.status) && (res.status !== 202 || !res.body.trim())) return { status: 'blocked', listings: [], error: `HTTP ${res.status}` };
  if (site.location && res.status >= 400 && res.status < 500 && NO_DELIVERY.test(res.body.slice(0, 3000))) return { status: 'empty', listings: [], reason: 'no-delivery' };
  if (res.status !== 200 && res.status !== 202) return { status: 'error', listings: [], error: `HTTP ${res.status}` };
  const parsed = parseResponse(site, res.body, parseHtml);
  if (parsed.status !== 'ok') return { status: parsed.status as SiteCheck['status'], listings: [], reason: parsed.reason };
  return scored(parsed.listings, ref);
}

function scored(raw: Listing[], ref: Reference): SiteCheck {
  const listings = scoreListings(ref, raw);
  const best = pickBest(listings);
  return { status: best ? 'ok' : 'nomatch', listings, best };
}

/** Can this site be checked here and now? */
export function canCheck(site: SiteConfig, net: Net, loc: UserLocation | undefined): 'yes' | 'needs-location' | 'app-only' | 'off' {
  if (site.fetch === false) return 'off';
  if (!hasNeed(loc, site.location)) return 'needs-location';
  if (site.browser && !site.browser.fallback && !net.readPage) return 'app-only';
  if (site.session && !net.cookies) return 'app-only';
  return 'yes';
}

/** "path" (truthy) or "path=value". */
function holds(json: unknown, rule: string): boolean {
  const eq = rule.indexOf('=');
  const v = getPath(json, eq > 0 ? rule.slice(0, eq) : rule);
  return eq > 0 ? String(v) === rule.slice(eq + 1) : !!v && v !== 'false' && v !== 'NA';
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * Fetch, following Flipkart's "DC Change" answer: its API tells us which data centre
 * ({dc} in the URL) to use for this user, and we retry there.
 */
export async function fetchWithDc(net: Net, req: SiteRequest, vars: Vars, rebuild: (v: Vars) => SiteRequest): Promise<FetchResult> {
  const res = await net.fetch(req);
  if (res.status === 406 && vars.dc !== undefined && res.body.includes('DC Change')) {
    const id = String(getPath(parseJson(res.body), 'RESPONSE.id') ?? '');
    if (/^\d+$/.test(id) && id !== vars.dc) {
      vars.dc = id;
      return net.fetch(rebuild(vars));
    }
  }
  return res;
}

export type SetupResult = { ok: true; vars: Vars } | { ok: false; check: SiteCheck };

/** Run a site's setup steps: tell it the delivery location, look up the store for a pincode… */
export async function runSetup(site: SiteConfig, base: Vars, net: Net): Promise<SetupResult> {
  const vars: Vars = { ...base };
  // Sites with a {dc} in their URLs start at data centre 1 and move when told to.
  if ([site.search, ...(site.setup ?? []).map((s) => s.url)].some((u) => u.includes('{dc}'))) vars.dc ??= '1';
  for (const step of site.setup ?? []) {
    const build = (v: Vars) => templateRequest(step.url, step, v);
    const res = await fetchWithDc(net, build(vars), vars, build);
    if (isBlockedStatus(res.status)) return { ok: false, check: { status: 'blocked', listings: [], error: `setup HTTP ${res.status}` } };
    if (res.status < 200 || res.status >= 300) return { ok: false, check: { status: 'error', listings: [], error: `setup HTTP ${res.status}` } };
    const json = parseJson(res.body);
    if (step.require && !holds(json, step.require)) return { ok: false, check: { status: 'empty', listings: [], reason: 'no-delivery' } };
    for (const [name, from] of Object.entries(step.save ?? {})) {
      const value = from.startsWith('cookie:') ? (await net.cookies?.(build(vars).url))?.[from.slice(7)] : getPath(json, from);
      if (value == null || value === '') return { ok: false, check: { status: 'error', listings: [], error: `setup: no ${name}` } };
      vars[name] = String(value);
    }
  }
  return { ok: true, vars };
}

/** What to open in the hidden in-app browser for a search. */
export function pageRequest(site: SiteConfig, query: string, vars: Vars): PageRequest {
  const b = site.browser ?? {};
  const page = fill((b.page ?? site.manual ?? site.base).replace(/\{q\}/g, encodeURIComponent(query.trim())), vars, 'url');
  return {
    url: page,
    cookies: (b.cookies ?? []).map((c) => {
      const value = fill(c.value, vars, 'raw');
      return { url: c.url, value: `${c.name}=${c.encode ? encodeURIComponent(value) : value}; path=/${c.domain ? `; domain=${c.domain}` : ''}` };
    }),
    capture: b.capture,
    run: b.run ? buildRequest(site, query, vars) : undefined,
    origins: [page.match(/^https?:\/\/[^/]+/)?.[0] ?? site.base],
    timeoutMs: b.timeoutMs ?? 25000,
  };
}

/** Read a site in the hidden in-app browser. */
export async function browserCheck(site: SiteConfig, query: string, ref: Reference, vars: Vars, net: Net, parseHtml?: HtmlParser): Promise<SiteCheck> {
  return readPageResult(site, await net.readPage!(pageRequest(site, query, vars)), ref, parseHtml);
}

/** Turn what the hidden browser saw into a check. */
export function readPageResult(site: SiteConfig, res: PageResult, ref: Reference, parseHtml?: HtmlParser): SiteCheck {
  const good = res.captures.filter((c) => c.status === 200 && c.body);
  const raw = dedupe(good.flatMap((c) => parseResponse(site, c.body, parseHtml).listings));
  if (raw.length) return scored(raw, ref);
  if (good.length) return { status: 'empty', listings: [] };
  const seen = `${res.title ?? ''} ${res.text ?? ''}`;
  if (NO_DELIVERY.test(seen)) return { status: 'empty', listings: [], reason: 'no-delivery' };
  if (res.captures.some((c) => isBlockedStatus(c.status)) || /access denied|verify you are human|captcha|unusual traffic/i.test(seen)) {
    return { status: 'blocked', listings: [], error: 'browser: blocked' };
  }
  return { status: 'error', listings: [], error: `browser: ${res.reason ?? 'no results'}` };
}

/**
 * Check one site: setup steps (when `setup` is given they already ran), the search request,
 * and the hidden browser when the site needs it or blocks the plain request.
 */
export async function checkSiteWith(
  site: SiteConfig,
  query: string,
  ref: Reference,
  opts: { net: Net; vars?: Vars; parseHtml?: HtmlParser; location?: UserLocation },
): Promise<SiteCheck> {
  const { net, parseHtml } = opts;
  let vars = opts.vars;
  if (!vars) {
    const setup = await runSetup(site, locationVars(opts.location), net);
    if (!setup.ok) return setup.check;
    vars = setup.vars;
  }
  if (site.browser && !site.browser.fallback) return browserCheck(site, query, ref, vars, net, parseHtml);
  const v = vars;
  const build = (x: Vars) => buildRequest(site, query, x);
  const check = readSearch(site, await fetchWithDc(net, build(v), v, build), ref, parseHtml);
  if (check.status === 'blocked' && site.browser?.fallback && net.readPage) return browserCheck(site, query, ref, v, net, parseHtml);
  return check;
}

export async function checkSite(site: SiteConfig, query: string, ref: Reference, fetch: Fetcher, parseHtml?: HtmlParser): Promise<SiteCheck> {
  return readSearch(site, await fetch(buildRequest(site, query)), ref, parseHtml);
}

/** What a product page says about itself: its full title and stock. */
export function productFacts(html: string, blobs: unknown[] = extractJsonBlobs(html)): { title?: string; inStock?: boolean } {
  const facts: { title?: string; inStock?: boolean } = {};
  for (const blob of blobs) {
    const items = Array.isArray(blob) ? blob : [blob, ...(((blob as Record<string, unknown>)?.['@graph'] as unknown[]) ?? [])];
    for (const it of items) {
      const o = it as Record<string, unknown>;
      if (o?.['@type'] !== 'Product') continue;
      if (typeof o.name === 'string') facts.title ??= o.name;
      facts.inStock ??= stockOf(o);
    }
  }
  facts.title ??= html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
  const packSize = html.match(/"(?:packSize|pack_size|netQuantity|net_quantity)"\s*:\s*"([^"]{2,20})"/)?.[1];
  if (packSize && facts.title && !extractQuantity(facts.title)) facts.title += ` ${packSize}`;
  return facts;
}

/**
 * Use the product page to firm up the match: a listing whose search title didn't
 * show the size becomes "same product" (or "different size") once the page shows it.
 */
export function refineWithPage(best: ScoredListing, ref: Reference, facts: { title?: string; inStock?: boolean }): ScoredListing {
  let b = best;
  if (facts.inStock === false && b.inStock !== false) b = { ...b, inStock: false };
  if (ref.qty && b.why?.size === 'unknown' && facts.title) {
    const qty = extractQuantity(facts.title);
    if (qty) {
      const why: MatchWhy = { ...b.why, size: sameQuantity(ref.qty, qty) ? 'same' : 'different' };
      b = { ...b, qty, why, unitPrice: unitPrice(b.price, qty), match: label(ref, b.score, why) };
    }
  }
  return b;
}

/** Bank offers + facts from a product page. */
export function readProductPage(html: string, siteId: string): { offers: Offer[]; facts: ReturnType<typeof productFacts> } {
  const blobs = extractJsonBlobs(html);
  return { offers: harvestOffers(html, siteId, blobs), facts: productFacts(html, blobs) };
}

export function priceFor(best: ScoredListing, offers: Offer[], wallet: Wallet, site: SiteConfig): ScoredListing {
  return { ...best, effective: effectivePrice(best.price, offers, wallet, best.coupon, site.fees) };
}

/**
 * A "same product" far cheaper than on the other sites is usually an accessory,
 * a sample or a wrong pack — flag it instead of calling it the cheapest.
 */
export function flagOutliers(results: SiteResult[]): SiteResult[] {
  const exact = results.filter((r) => r.best?.match === 'exact');
  const mid = exact.length >= 3 ? median(exact.map((r) => r.best!.price)) : 0;
  return results.map((r) => {
    const outlier = !!mid && r.best?.match === 'exact' && r.best.price < mid * 0.4;
    return outlier === !!r.outlier ? r : { ...r, outlier };
  });
}

/** Same product first, then cheapest effective price; sites still loading / failed go last. */
export function sortResults(r: SiteResult[]): SiteResult[] {
  const order: Record<SiteStatus, number> = { ok: 0, loading: 1, nomatch: 2, empty: 3, blocked: 4, error: 4, manual: 5 };
  const tier = { exact: 0, size: 1, similar: 2, different: 3 };
  const rank = (x: SiteResult) => (x.best?.inStock === false ? 2 : x.outlier ? 1 : 0);
  return r.sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status];
    if (a.best && b.best) {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.best.match !== b.best.match) return tier[a.best.match] - tier[b.best.match];
    }
    const pa = a.best?.effective?.mine ?? a.best?.price ?? Infinity;
    const pb = b.best?.effective?.mine ?? b.best?.price ?? Infinity;
    return pa - pb;
  });
}
