import { getConfig } from './config.ts';
import { effectivePrice } from './effectivePrice.ts';
import { fetchText } from './fetcher.ts';
import { condenseTitle, detectCategories, makeReference, pickBest, scoreListings, type Reference } from './matcher.ts';
import { dedupeOffers, harvestOffers } from './offers.ts';
import { buildRequest, manualUrl, parseResponse } from './parse.ts';
import { cleanSharedText, cleanStoreTitle, isProductTitle } from './share.ts';
import type { Offer, SiteConfig, SiteResult, UserCard } from './types.ts';

export interface SearchInput {
  /** What to search on each site. */
  query: string;
  /** What "same product" means — the query itself, or a chosen product's full title. */
  ref?: Reference;
  cards: UserCard[];
  onUpdate: (results: SiteResult[]) => void;
  signal?: AbortSignal;
}

const CACHE_MS = 10 * 60 * 1000;
const searchCache = new Map<string, { at: number; body: string; status: number }>();
const offerCache = new Map<string, Offer[]>();

async function cachedFetch(site: SiteConfig, query: string) {
  const req = buildRequest(site, query);
  const key = `${req.method} ${req.url} ${req.body ?? ''}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const res = await fetchText(req);
  const entry = { at: Date.now(), ...res };
  if (res.status === 200) searchCache.set(key, entry);
  return entry;
}

export function sitesFor(query: string): { fetch: SiteConfig[]; manualOnly: SiteConfig[] } {
  const cats = detectCategories(query);
  const all = getConfig().sites;
  const relevant = cats.includes('general') ? all : all.filter((s) => s.categories.some((c) => cats.includes(c)));
  return {
    fetch: relevant.filter((s) => s.fetch !== false),
    manualOnly: relevant.filter((s) => s.fetch === false),
  };
}

/** Run one comparison. Results stream in through onUpdate as each site answers. */
export async function runSearch(input: SearchInput): Promise<SiteResult[]> {
  const { query, cards, onUpdate, signal } = input;
  const ref = input.ref ?? makeReference(query, 'query');
  const { fetch: toFetch, manualOnly } = sitesFor(query);
  const config = getConfig();

  const results: SiteResult[] = [
    ...toFetch.map((site) => ({ site, status: 'loading' as const, listings: [], manualUrl: manualUrl(site, query) })),
    ...manualOnly.map((site) => ({ site, status: 'manual' as const, listings: [], manualUrl: manualUrl(site, query) })),
  ];
  const emit = () => !signal?.aborted && onUpdate(sortResults([...results]));
  emit();

  const update = (i: number, patch: Partial<SiteResult>) => {
    results[i] = { ...results[i], ...patch };
    emit();
  };

  await Promise.all(
    toFetch.map(async (site, i) => {
      try {
        const res = await cachedFetch(site, query);
        if (signal?.aborted) return;
        if (res.status === 403 || res.status === 429 || res.status === 503) return update(i, { status: 'blocked' });
        if (res.status !== 200) return update(i, { status: 'error', error: `HTTP ${res.status}` });
        const parsed = parseResponse(site, res.body);
        const scored = scoreListings(ref, parsed.listings);
        const best = pickBest(scored);
        const staticOffers = config.offers.filter((o) => o.site === site.id);
        const withPrice = best && { ...best, effective: effectivePrice(best.price, staticOffers, cards) };
        update(i, { status: best ? 'ok' : parsed.status === 'ok' ? 'empty' : parsed.status, listings: scored, best: withPrice });

        // Second step (background): product page → bank offers for the chosen listing.
        if (best) {
          const pageOffers = await productOffers(site, best.url);
          if (signal?.aborted || !pageOffers.length) return;
          const offers = dedupeOffers([...pageOffers, ...staticOffers]);
          update(i, { best: { ...best, effective: effectivePrice(best.price, offers, cards) }, offers });
        }
      } catch (e) {
        if (!signal?.aborted) update(i, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  return sortResults(results);
}

async function productOffers(site: SiteConfig, url: string): Promise<Offer[]> {
  const hit = offerCache.get(url);
  if (hit) return hit;
  try {
    const res = await fetchText({ url, method: 'GET', headers: {} });
    const offers = res.status === 200 ? harvestOffers(res.body, site.id) : [];
    offerCache.set(url, offers);
    return offers;
  } catch {
    return [];
  }
}

/** Same product first, then cheapest effective price; sites still loading / failed go last. */
export function sortResults(r: SiteResult[]): SiteResult[] {
  const order = { ok: 0, loading: 1, empty: 2, blocked: 3, error: 3, manual: 4 };
  const tier = { exact: 0, size: 1, similar: 2, different: 3 };
  return r.sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status];
    if (a.best && b.best && a.best.match !== b.best.match) return tier[a.best.match] - tier[b.best.match];
    const pa = a.best?.effective?.mine ?? a.best?.price ?? Infinity;
    const pb = b.best?.effective?.mine ?? b.best?.price ?? Infinity;
    return pa - pb;
  });
}

/** Recompute effective prices after the user changes their cards (no network). */
export function repriceForCards(results: SiteResult[], cards: UserCard[]): SiteResult[] {
  const config = getConfig();
  return sortResults(
    results.map((r) => {
      if (!r.best) return r;
      const offers = r.offers ?? config.offers.filter((o) => o.site === r.site.id);
      return { ...r, best: { ...r.best, effective: effectivePrice(r.best.price, offers, cards) } };
    }),
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
  if (!title) throw new Error('Is link se product ka naam nahi mila. Product ka naam type karke search karo.');
  return { query: condenseTitle(title), ref: makeReference(title, 'product'), from: 'link' };
}
