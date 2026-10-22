// Generic product extraction from a shopping site's HTML.
// Most Indian e-commerce sites embed their search results as JSON
// (window.__INITIAL_STATE__, __NEXT_DATA__, JSON-LD ...). Instead of
// hand-writing a parser per site, we pull every JSON blob out of the page,
// walk it, and keep objects that look like a product (name + price + link).

import type { Listing, SiteConfig } from './types.ts';

const NAME_KEYS = ['name', 'title', 'productName', 'product_name', 'display_name', 'displayName', 'productTitle', 'modelName', 'brandName'];
// Not "offerPrice": on Ajio that's the price after a coupon (see SiteConfig.json.coupon).
const PRICE_KEYS = ['sellingPrice', 'selling_price', 'finalPrice', 'final_price', 'discountedPrice', 'discounted_price', 'specialPrice', 'salePrice', 'effectivePrice', 'price', 'lowPrice', 'value'];
const MRP_KEYS = ['mrp', 'MRP', 'maxRetailPrice', 'listPrice', 'list_price', 'originalPrice', 'strikePrice', 'marked', 'regular_price', 'regularPrice'];
const URL_KEYS = ['url', 'productUrl', 'product_url', 'landingPageUrl', 'slug', 'webUrl', 'link', 'href', 'actionUrl', 'seoUrl', 'pdpUrl'];
const IMG_KEYS = ['image', 'imageUrl', 'image_url', 'imgUrl', 'searchImage', 'thumbnail', 'img', 'imageURL', 'primaryImage', 'images', 'media'];
const RATING_KEYS = ['rating', 'averageRating', 'avgRating', 'ratingValue', 'average_rating'];
const RATING_COUNT_KEYS = ['ratingCount', 'rating_count', 'ratingsCount', 'numberOfRatings', 'totalRatings', 'reviewCount'];

/** Pull every JSON value we can find out of the page's <script> tags. */
export function extractJsonBlobs(html: string): unknown[] {
  const out: unknown[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1];
    const body = m[2].trim();
    if (!body) continue;
    if (/type\s*=\s*["']application\/(ld\+)?json["']/i.test(attrs)) {
      const v = lenientParse(body);
      if (v !== undefined) out.push(v);
      continue;
    }
    // window.X = {...}  /  X = {...}  inside inline JS
    const assignRe = /(?:window\.|self\.)?[A-Za-z_$][\w$]*\s*=\s*(?=[{[])/g;
    let a: RegExpExecArray | null;
    while ((a = assignRe.exec(body))) {
      const start = a.index + a[0].length;
      const end = matchBracket(body, start);
      if (end < 0) continue;
      if (end - start > 200) {
        const v = lenientParse(body.slice(start, end + 1));
        if (v !== undefined) out.push(v);
      }
      assignRe.lastIndex = end + 1;
    }
  }
  return out;
}

/** Index of the bracket closing the one at `start`, string-aware. */
function matchBracket(s: string, start: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lenientParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      // Some sites serialise JS objects with `undefined` / NaN in them.
      return JSON.parse(text.replace(/:\s*(undefined|NaN)\b/g, ':null'));
    } catch {
      return undefined;
    }
  }
}

export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[₹,\s]|Rs\.?|INR/gi, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // {value: 499} / {amount: 499} / {decimalValue: "499"} / {effective: {min: 499}}
    for (const k of ['value', 'amount', 'decimalValue', 'min', 'effective', 'marked', 'selling']) {
      if (k in o) {
        const n = toNumber(o[k]);
        if (n) return n;
      }
    }
  }
  return undefined;
}

/** "17,974" / "12.3k" / "3.9K+" / 703 → a number of ratings. */
export function toCount(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
  if (typeof v !== 'string') return undefined;
  const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kKlL]|lakh)?/);
  if (!m) return undefined;
  const mult = !m[2] ? 1 : /k/i.test(m[2]) ? 1000 : 100000;
  return Math.round(parseFloat(m[1]) * mult) || undefined;
}

/** In stock? From the usual flags; undefined when the site doesn't say. */
export function stockOf(o: Record<string, unknown>): boolean | undefined {
  for (const k of ['inStock', 'in_stock', 'isInStock', 'is_in_stock', 'isAvailable', 'is_available', 'sellable']) {
    if (typeof o[k] === 'boolean') return o[k] as boolean;
  }
  for (const k of ['outOfStock', 'out_of_stock', 'isOutOfStock', 'is_out_of_stock', 'soldOut', 'isSoldOut', 'sold_out']) {
    if (typeof o[k] === 'boolean') return !o[k];
  }
  const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers;
  const av = o.availability ?? o.stockStatus ?? o.inventoryStatus ?? (offers as Record<string, unknown> | undefined)?.availability;
  const text = typeof av === 'string' ? av : av && typeof av === 'object' ? String((av as Record<string, unknown>).displayState ?? '') : '';
  if (/out[\s_-]?of[\s_-]?stock|sold[\s_-]?out|unavailable|discontinued/i.test(text)) return false;
  if (/in[\s_-]?stock|available/i.test(text)) return true;
  return undefined;
}

/** Rupee amount in a coupon value: 298, {value: 298}, or "Best Price ₹348 with coupon". */
function couponPrice(v: unknown): number | undefined {
  if (typeof v === 'string') {
    const m = v.replace(/<[^>]*>/g, ' ').replace(/,/g, '').match(/(?:₹|rs\.?)\s*(\d+(?:\.\d+)?)/i);
    return m ? parseFloat(m[1]) : undefined;
  }
  return toNumber(v);
}

/** Accept a coupon price only when it's a real, believable saving. */
export function sanePrice(coupon: number | undefined, price: number): number | undefined {
  return coupon && coupon < price && coupon >= price * 0.3 ? coupon : undefined;
}

/** Read `a.b.0.c` style paths; plain keys work too. */
export function getPath(o: unknown, path: string): unknown {
  if (!path.includes('.')) return (o as Record<string, unknown>)?.[path];
  let v: unknown = o;
  for (const k of path.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = getPath(o, k);
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    let v = getPath(o, k);
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === 'object') v = pick(v as Record<string, unknown>, ['url', 'src', 'secure_src', 'imageUrl', 'path', 'value']);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickPrice(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = getPath(o, k);
    if (v == null) continue;
    const n = toNumber(v);
    if (n) return n;
  }
  // Schema.org style: offers: {price} or [{price}]
  const offers = o.offers as unknown;
  if (offers) {
    const first = Array.isArray(offers) ? offers[0] : offers;
    if (first && typeof first === 'object') return pickPrice(first as Record<string, unknown>, ['price', 'lowPrice']);
  }
  // Nested price objects: price: {mrp, sp} / pricing: {...}
  for (const k of ['prices', 'pricing', 'priceInfo', 'price_info', 'priceDetails']) {
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const n = pickPrice(v as Record<string, unknown>, keys);
      if (n) return n;
    }
  }
  return undefined;
}

export function absolutize(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  url = url.trim().replace(/&amp;/g, '&').replace(/&#x2F;/g, '/').replace(/&#x3D;/g, '=');
  if (url.startsWith('//')) return 'https:' + url;
  if (/^https?:\/\//.test(url)) return url;
  if (/^www\./.test(url)) return 'https://' + url;
  if (/^[a-z]+:/i.test(url) || /\s/.test(url)) return undefined; // javascript:, data:, junk
  // No URL class here: the background checker's JS engine doesn't have one.
  return base.replace(/\/+$/, '') + (url.startsWith('/') ? url : '/' + url);
}

/** Walk any JSON value and collect product-shaped objects. */
export function findProducts(root: unknown, site: SiteConfig): Listing[] {
  const found: Listing[] = [];
  const seen = new Set<unknown>();
  const nameKeys = site.json?.name ?? NAME_KEYS;
  const priceKeys = site.json?.price ?? PRICE_KEYS;
  const mrpKeys = site.json?.mrp ?? MRP_KEYS;
  const urlKeys = site.json?.url ?? URL_KEYS;
  const urlTemplate = site.json?.urlTemplate;

  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 40 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const title = pickString(o, nameKeys);
    const price = pickPrice(o, priceKeys);
    let url = pickString(o, urlKeys);
    if (!url && urlTemplate) {
      let missing = false;
      url = urlTemplate.replace(/\{([\w.]+)\}/g, (_, k) => {
        const v = getPath(o, k);
        if (v == null || v === '') missing = true;
        return encodeURIComponent(String(v ?? ''));
      });
      if (missing) url = undefined;
    }
    if (title && price && url && title.length >= 8 && !/^https?:/.test(title)) {
      const mrp = pickPrice(o, mrpKeys);
      const brandRaw = site.json?.brand ? pick(o, site.json.brand) : o.brand;
      const brand = typeof brandRaw === 'string' ? brandRaw : pickString((brandRaw as Record<string, unknown>) ?? {}, ['name']);
      let fullTitle = brand && !title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${title}` : title;
      // Some sites keep the pack size in a separate subtitle field ("30 g").
      for (const k of site.json?.extra ?? []) {
        const extra = getPath(o, k);
        if (typeof extra === 'string' && extra && !fullTitle.includes(extra)) fullTitle += `, ${extra}`;
      }
      const couponRaw = site.json?.coupon ? pick(o, site.json.coupon) : undefined;
      const coupon = sanePrice(couponPrice(couponRaw), price);
      const listing: Listing = {
        site: site.id,
        title: fullTitle,
        price,
        mrp: mrp && mrp >= price ? mrp : undefined,
        url: absolutize(url, site.base)!,
        image: absolutize(pickString(o, site.json?.image ?? IMG_KEYS), site.base),
        rating: toNumber(pick(o, site.json?.rating ?? RATING_KEYS)),
        ratingCount: toCount(pick(o, site.json?.ratingCount ?? RATING_COUNT_KEYS)),
        inStock: stockOf(o),
      };
      if (coupon) listing.coupon = { price: coupon, text: typeof couponRaw === 'string' ? couponRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : 'with coupon' };
      found.push(listing);
    }
    for (const k in o) visit(o[k], depth + 1);
  };
  visit(root, 0);
  return found.filter((l) => l.url);
}

/** Cheap CSS-selector fallback for sites that render results in HTML only. */
export function extractWithSelectors(doc: Document, site: SiteConfig): Listing[] {
  const s = site.selectors;
  if (!s) return [];
  const out: Listing[] = [];
  for (const el of Array.from(doc.querySelectorAll(s.item))) {
    const rawTitle = (s.titleAttr ? el.querySelector(s.title)?.getAttribute(s.titleAttr) : el.querySelector(s.title)?.textContent)?.trim();
    let title = rawTitle?.replace(/^Sponsored\s*(Ad)?\s*[-–:]\s*/i, '');
    const brand = s.brand ? el.querySelector(s.brand)?.textContent?.trim() : undefined;
    if (title && brand && !title.toLowerCase().includes(brand.toLowerCase())) title = `${brand} ${title}`;
    const price = toNumber(el.querySelector(s.price)?.textContent);
    if (!title || !price) continue;
    let url = s.link ? el.querySelector(s.link)?.getAttribute('href') ?? undefined : undefined;
    if (!url && s.idAttr && s.urlTemplate) {
      const id = el.getAttribute(s.idAttr);
      if (id) url = s.urlTemplate.replace('{id}', id);
    }
    const mrp = s.mrp ? toNumber(el.querySelector(s.mrp)?.textContent) : undefined;
    const img = s.image ? el.querySelector(s.image) : null;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ');
    const rc = s.ratingCount ? el.querySelector(s.ratingCount) : null;
    const listing: Listing = {
      site: site.id,
      title,
      price,
      mrp: mrp && mrp >= price ? mrp : undefined,
      url: absolutize(url, site.base)!,
      image: absolutize(img?.getAttribute('src') ?? img?.getAttribute('data-src') ?? undefined, site.base),
      rating: s.rating ? toNumber(el.querySelector(s.rating)?.textContent?.split(' ')[0]) : undefined,
      ratingCount: toCount(rc?.getAttribute('aria-label') ?? rc?.textContent ?? undefined),
      sponsored: title !== rawTitle || /\bSponsored\b/.test(text),
    };
    if (/currently unavailable|temporarily out of stock|\bout of stock\b/i.test(text)) listing.inStock = false;
    const coupon = sanePrice(couponFromText(text, price), price);
    if (coupon) listing.coupon = { price: coupon, text: text.match(/(?:buy|get it) for[^.]*?with coupon|save [^.]*?with coupon/i)?.[0] ?? 'with coupon' };
    out.push(listing);
  }
  return out.filter((l) => l.url);
}

/** "Buy for ₹273 with coupon" / "Save ₹50 with coupon" / "Save 5% with coupon" (Amazon). */
export function couponFromText(text: string, price: number): number | undefined {
  const t = text.replace(/,/g, '');
  const buy = t.match(/(?:buy|get it) for\s*₹\s*(\d+(?:\.\d+)?)\s*with coupon/i);
  if (buy) return parseFloat(buy[1]);
  const flat = t.match(/save\s*₹\s*(\d+(?:\.\d+)?)\s*with coupon/i);
  if (flat) return price - parseFloat(flat[1]);
  const pct = t.match(/save\s*(\d+(?:\.\d+)?)\s*%\s*with coupon/i);
  if (pct) return Math.round(price * (1 - parseFloat(pct[1]) / 100) * 100) / 100;
  return undefined;
}

/** Remove duplicates (same URL, or same title at same price) and junk. */
export function dedupe(list: Listing[]): Listing[] {
  const byKey = new Map<string, Listing>();
  for (const l of list) {
    const key = canonicalUrl(l.url);
    const prev = byKey.get(key);
    // Prefer the organic (non-sponsored) entry and the one with more info.
    if (!prev || (prev.sponsored && !l.sponsored) || (!prev.mrp && l.mrp)) byKey.set(key, { ...prev, ...l });
  }
  return [...byKey.values()];
}

export function canonicalUrl(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!m) return url;
  const [, host, path, query = ''] = m;
  const dp = path.match(/\/dp\/([A-Z0-9]{10})/);
  if (dp) return `${host}/dp/${dp[1]}`;
  const pid = query.match(/[?&]pid=([^&]+)/)?.[1];
  return host + path.replace(/\/+$/, '') + (pid ? `?pid=${pid}` : '');
}
