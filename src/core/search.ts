// Checking one site, independent of where it runs: the app (engine.ts) and the
// background price checker (runner/background.ts) both use this with their own fetch.
import { effectivePrice } from './effectivePrice.ts';
import { extractJsonBlobs, stockOf } from './extract.ts';
import { extractQuantity, label, median, pickBest, sameQuantity, scoreListings, unitPrice, type Reference } from './matcher.ts';
import { harvestOffers } from './offers.ts';
import { buildRequest, parseResponse, type HtmlParser, type SiteRequest } from './parse.ts';
import type { MatchWhy, Offer, ScoredListing, SiteConfig, SiteResult, SiteStatus, Wallet } from './types.ts';

export interface FetchResult {
  status: number;
  body: string;
}
export type Fetcher = (req: SiteRequest) => Promise<FetchResult>;

export interface SiteCheck {
  status: Exclude<SiteStatus, 'loading' | 'manual'>;
  listings: ScoredListing[];
  best?: ScoredListing;
  /** 'empty-page' when the site sent a page without products or a "no results" message. */
  reason?: string;
  error?: string;
}

/** Read a site's search response and pick the listing that is this product. */
export function readSearch(site: SiteConfig, res: FetchResult, ref: Reference, parseHtml?: HtmlParser): SiteCheck {
  if (res.status === 403 || res.status === 429 || res.status === 503) return { status: 'blocked', listings: [], error: `HTTP ${res.status}` };
  if (res.status !== 200) return { status: 'error', listings: [], error: `HTTP ${res.status}` };
  const parsed = parseResponse(site, res.body, parseHtml);
  if (parsed.status !== 'ok') return { status: parsed.status as SiteCheck['status'], listings: [], reason: parsed.reason };
  const listings = scoreListings(ref, parsed.listings);
  const best = pickBest(listings);
  return { status: best ? 'ok' : 'nomatch', listings, best };
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
