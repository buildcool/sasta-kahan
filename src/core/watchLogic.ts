// Watchlist rules, shared by the app and the background price checker.
import type { SiteResult } from './types.ts';

export interface PricePoint {
  t: number;
  /** Lowest price a site showed for this exact product (before card offers). */
  price: number;
  site: string;
  /** That price after the user's best offer, for display only. */
  eff?: number;
  /** 2 = `price` is the site price. Older points stored the after-card price. */
  v?: number;
}

export interface WatchItem {
  id: string;
  /** Text to search again. */
  query: string;
  /** Full product title used for matching (product mode), if any. */
  refTitle?: string;
  title: string;
  image?: string;
  /** Notify when the lowest price goes at or below this. */
  target?: number;
  history: PricePoint[];
  lastChecked: number;
  /** false when the last check found the product only out of stock. */
  inStock?: boolean;
  /** Where it was cheapest last time. */
  url?: string;
}

export interface Low {
  price: number;
  site: string;
  eff?: number;
  url?: string;
}

/**
 * Cheapest in-stock exact match, by the price the site shows. Card offers are
 * left out on purpose: adding a card or a page offer failing to load once must
 * never look like a price drop.
 */
export function lowestExact(results: SiteResult[]): { low?: Low; anyExact: boolean } {
  let low: Low | undefined;
  let anyExact = false;
  for (const r of results) {
    const b = r.best;
    if (!b || b.match !== 'exact' || r.outlier) continue;
    anyExact = true;
    if (b.inStock === false) continue;
    if (!low || b.price < low.price) low = { price: b.price, site: r.site.name, eff: b.effective?.mine, url: b.url };
  }
  return { low, anyExact };
}

export interface Alert {
  kind: 'drop' | 'target' | 'stock';
  price: number;
  site: string;
  before?: number;
}

/** Record one check on an item; says whether to notify. */
export function applyCheck(item: WatchItem, found: { low?: Low; anyExact: boolean }, now = Date.now()): { item: WatchItem; alert?: Alert } {
  const next: WatchItem = { ...item, lastChecked: now };
  const { low, anyExact } = found;
  if (!low) {
    // Only exact matches out of stock → remember it, so we can say "back in stock" later.
    if (anyExact) next.inStock = false;
    return { item: next };
  }
  const prices = item.history.filter((h) => h.v === 2).map((h) => h.price);
  const before = prices.length ? Math.min(...prices) : undefined;
  const lastPrice = prices.at(-1);
  const point: PricePoint = { t: now, price: low.price, site: low.site, eff: low.eff, v: 2 };
  const last = item.history.at(-1);
  // One point per day is enough for a chart; keep the day's lowest.
  const history =
    last && new Date(last.t).toDateString() === new Date(now).toDateString()
      ? [...item.history.slice(0, -1), last.v === 2 && last.price < low.price ? last : point]
      : [...item.history, point];
  next.history = history.slice(-120);
  next.url = low.url;
  const wasOut = item.inStock === false;
  next.inStock = true;

  let alert: Alert | undefined;
  if (wasOut) alert = { kind: 'stock', price: low.price, site: low.site };
  else if (item.target && low.price <= item.target && (lastPrice === undefined || lastPrice > item.target)) alert = { kind: 'target', price: low.price, site: low.site };
  else if (before !== undefined && low.price < before * 0.99) alert = { kind: 'drop', price: low.price, site: low.site, before };
  return { item: next, alert };
}

export interface PriceStats {
  low: number;
  avg: number;
  high: number;
  /** good = at or near the lowest seen; high = well above the average. */
  deal: 'good' | 'typical' | 'high';
}

/** Low / average / high of the stored history, and how today's price compares. Needs a few days of data. */
export function priceStats(history: PricePoint[]): PriceStats | undefined {
  const pts = history.filter((h) => h.v === 2);
  if (pts.length < 3) return undefined;
  const prices = pts.map((h) => h.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const now = prices.at(-1)!;
  const deal = now <= low * 1.02 ? 'good' : now > avg * 1.08 ? 'high' : 'typical';
  return { low, avg, high, deal };
}

/** Is this item due for a re-check? */
export const isStale = (it: WatchItem, maxAgeMs: number, now = Date.now()) => now - it.lastChecked > maxAgeMs;

/** Put updated items back into the latest stored list (the user may have added or removed items meanwhile). */
export function mergeItems(stored: WatchItem[], updated: WatchItem[]): WatchItem[] {
  const byId = new Map(updated.map((u) => [u.id, u]));
  return stored.map((s) => {
    const u = byId.get(s.id);
    // Keep the user's own edits (target) from the stored copy.
    return u ? { ...u, target: s.target } : s;
  });
}
