import type { Category, Listing, MatchLabel, Quantity, ScoredListing } from './types.ts';

const STOP = new Set(['for', 'with', 'and', 'the', 'of', 'in', 'on', 'a', 'an', 'to', 'by', 'from', 'new', 'buy', 'online', 'best', 'all', 'pack', 'combo', 'set', 'pc', 'pcs', 'piece', 'pieces', 'free', 'off']);

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Lakmé → Lakme
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(\d)\s+(ml|l|ltr|g|gm|gms|kg|gb|tb|mah|w|inch)\b/g, '$1$2') // "50 ml" → "50ml"
    .replace(/\b(spf|pa|ipx|ip)\s+(\d+)/g, '$1$2') // "SPF 50" → "spf50"
    .replace(/[^a-z0-9+.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !STOP.has(t));
}

const UNIT_RE = /(\d+(?:\.\d+)?)\s*(ml|millilitre|l|ltr|litre|liter|g|gm|gms|gram|grams|kg|gb|tb)\b/gi;

export function extractQuantity(title: string): Quantity | undefined {
  const t = title.toLowerCase();
  const found: { value: number; unit: Quantity['unit'] }[] = [];
  for (const m of t.matchAll(UNIT_RE)) {
    let value = parseFloat(m[1]);
    const u = m[2];
    let unit: Quantity['unit'];
    if (/^(ml|millilitre)$/.test(u)) unit = 'ml';
    else if (/^(l|ltr|litre|liter)$/.test(u)) (unit = 'ml'), (value *= 1000);
    else if (/^(g|gm|gms|gram|grams)$/.test(u)) unit = 'g';
    else if (u === 'kg') (unit = 'g'), (value *= 1000);
    else if (u === 'tb') (unit = 'gb'), (value *= 1024);
    else unit = 'gb';
    if (value > 0) found.push({ value, unit });
  }
  const packM = t.match(/pack of (\d+)|set of (\d+)|(\d+)\s*(?:x|\*)\s*\d+(?:\.\d+)?\s*(?:ml|g|gm|l|kg)|\(?(\d+)\s*(?:pcs|pieces|n)\)?|combo of (\d+)|buy (?:1|one) get (?:1|one)/);
  let pack = 1;
  if (packM) pack = /buy (1|one) get/.test(packM[0]) ? 2 : parseInt(packM.slice(1).find(Boolean) ?? '1', 10);
  if (!(pack >= 1 && pack <= 50)) pack = 1;
  if (!found.length) return pack > 1 ? { value: 1, unit: 'pcs', pack } : undefined;
  // Storage: biggest number (128GB beats 8GB RAM). Volume/weight: first mention.
  const pickQ = found.some((f) => f.unit === 'gb') ? found.filter((f) => f.unit === 'gb').sort((a, b) => b.value - a.value)[0] : found[0];
  return { ...pickQ, pack };
}

export function sameQuantity(a?: Quantity, b?: Quantity): boolean {
  if (!a || !b) return true; // unknown → don't penalise
  if (a.unit !== b.unit) return false;
  const ta = a.value * a.pack;
  const tb = b.value * b.pack;
  return Math.abs(ta - tb) / Math.max(ta, tb) < 0.03;
}

/** ₹ per 100ml / 100g / piece — only meaningful for consumables. */
export function unitPrice(price: number, q?: Quantity): ScoredListing['unitPrice'] {
  if (!q) return undefined;
  const total = q.value * q.pack;
  if (q.unit === 'ml' || q.unit === 'g') return { value: (price / total) * 100, per: `100${q.unit}` };
  if (q.unit === 'pcs' && q.pack > 1) return { value: price / q.pack, per: 'piece' };
  return undefined;
}

/** Tokens that identify a model: contain digits (iphone "15", "181", "spf50") — must match. */
const isModelToken = (t: string) => /\d/.test(t) && !/^\d+(ml|g|gm|kg|l|gb|tb)$/.test(t);

function weight(t: string, i: number): number {
  if (i === 0) return 3; // first word is usually the brand
  if (isModelToken(t)) return 2;
  return 1;
}

export interface Reference {
  text: string;
  qty?: Quantity;
  /** 'query' = user typed words; 'product' = full title of a chosen product. */
  mode: 'query' | 'product';
}

export function makeReference(text: string, mode: Reference['mode']): Reference {
  return { text, qty: extractQuantity(text), mode };
}

/** 0..1 — how well a listing title matches the reference. */
const isSizeToken = (t: string) => /^\d+(?:\.\d+)?(ml|g|gm|gms|kg|l|ltr|gb|tb)$/.test(t);

function tokenHit(t: string, ct: Set<string>, ctNorm: string): boolean {
  if (ct.has(t)) return true;
  if (isModelToken(t)) return false; // numbers must match exactly: 50 ≠ 50ml, 181 ≠ 1810
  return ctNorm.includes(' ' + t) || (t.length > 4 && ctNorm.includes(t));
}

/** 0..1 — how well a listing title matches the reference. */
export function score(ref: Reference, title: string): number {
  const rt = tokens(ref.text).filter((t) => !isSizeToken(t));
  const ctList = tokens(title).filter((t) => !isSizeToken(t));
  const ct = new Set(ctList);
  const ctNorm = ' ' + normalize(title) + ' ';
  if (!rt.length) return 0;

  // Recall: how much of the reference does the listing contain?
  let hit = 0;
  let total = 0;
  rt.forEach((t, i) => {
    const w = weight(t, i);
    total += w;
    if (tokenHit(t, ct, ctNorm)) hit += w;
    else if (isModelToken(t)) hit -= w; // "airdopes 141" must not match "airdopes 181"
  });
  const recall = Math.max(0, hit / total);
  if (ref.mode === 'query') return recall;

  // Product mode: precision over the start of the listing title, where the
  // identifying words are ("Dry Matte Fluid" vs "Tinted Matte Fluid").
  const rs = new Set(rt);
  const rNorm = ' ' + normalize(ref.text) + ' ';
  const head = ctList.slice(0, Math.max(8, rt.length));
  let pHit = 0;
  let pTotal = 0;
  head.forEach((t, i) => {
    const w = weight(t, i);
    pTotal += w;
    if (tokenHit(t, rs, rNorm)) pHit += w;
  });
  const precision = pTotal ? pHit / pTotal : 0;
  return recall && precision ? (2 * recall * precision) / (recall + precision) : 0;
}

export function label(ref: Reference, l: Listing, s: number, qty?: Quantity): MatchLabel {
  const exactThreshold = ref.mode === 'query' ? 0.99 : 0.85;
  if (s >= exactThreshold) return ref.qty && qty && !sameQuantity(ref.qty, qty) ? 'size' : 'exact';
  if (s >= 0.55) return ref.qty && qty && !sameQuantity(ref.qty, qty) ? 'size' : 'similar';
  void l;
  return 'different';
}

export function scoreListings(ref: Reference, list: Listing[]): ScoredListing[] {
  return list.map((l) => {
    const qty = extractQuantity(l.title);
    const s = score(ref, l.title);
    return { ...l, score: s, qty, match: label(ref, l, s, qty), unitPrice: unitPrice(l.price, qty) };
  });
}

/**
 * Pick the listing to show for one site: the cheapest among the best matches.
 * Same-size items beat other sizes; different products are never picked.
 */
export function pickBest(scored: ScoredListing[]): ScoredListing | undefined {
  const rank: Record<MatchLabel, number> = { exact: 3, similar: 2, size: 1, different: 0 };
  const good = scored.filter((s) => s.match !== 'different');
  if (!good.length) return undefined;
  const topRank = Math.max(...good.map((s) => rank[s.match]));
  const tier = good.filter((s) => rank[s.match] === topRank);
  const topScore = Math.max(...tier.map((s) => s.score));
  const close = tier.filter((s) => s.score >= topScore - 0.08);
  return close.sort((a, b) => a.price - b.price || (a.sponsored ? 1 : 0) - (b.sponsored ? 1 : 0))[0];
}

const CATEGORY_WORDS: [Category, RegExp][] = [
  ['electronics', /\b(phone|mobile|iphone|galaxy|redmi|oneplus|realme|vivo|oppo|pixel|laptop|tablet|ipad|macbook|earbuds?|airdopes|airpods|headphones?|earphones?|neckband|speaker|smart ?watch|watch|tv|television|monitor|camera|ssd|hdd|pen ?drive|router|charger|power ?bank|trimmer|refrigerator|fridge|washing machine|\bac\b|air conditioner|microwave|mixer|grinder|iron|fan|cooler|geyser|purifier|printer|keyboard|mouse|console|playstation|xbox|boat|jbl|sony|samsung|apple|\d+\s?gb)\b/i],
  ['beauty', /\b(sunscreen|spf|serum|moisturi[sz]er|face ?wash|cleanser|toner|lipstick|lip|kajal|mascara|foundation|concealer|primer|shampoo|conditioner|hair ?oil|body ?lotion|lotion|perfume|deo|deodorant|cream|gel|nail|makeup|kohl|lakme|maybelline|minimalist|mamaearth|nivea|loreal|l'oreal|plum|cetaphil|neutrogena|dot (and|&) key|derma ?co|biotique|himalaya|wow)\b/i],
  ['fashion', /\b(shirt|t-?shirt|tee|jeans|trousers?|kurta|kurti|saree|sari|dress|top|jacket|hoodie|sweatshirt|shoes?|sneakers?|sandals?|slippers?|heels|bag|backpack|wallet|belt|sunglasses|cap|socks|bra|briefs|shorts|track ?pants|joggers|nike|adidas|puma|levis|h&m|zara|allen solly|roadster)\b/i],
  ['grocery', /\b(atta|rice|dal|oil|ghee|sugar|salt|tea|coffee|biscuits?|cookies|chocolate|maggi|noodles|snacks?|chips|namkeen|masala|spices?|milk|butter|cheese|paneer|bread|juice|cold drink|detergent|soap|toothpaste|dishwash|surf|tide|ariel|harpic|dettol|lizol)\b/i],
];

export function detectCategories(query: string): Category[] {
  const cats = CATEGORY_WORDS.filter(([, re]) => re.test(query)).map(([c]) => c);
  return cats.length ? cats : ['general'];
}

/** Short search string from a long product title: brand + key words + size. */
export function condenseTitle(title: string): string {
  const cleaned = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/\s[|–-]\s|,/)[0]
    .trim();
  const qty = title.match(/\d+(?:\.\d+)?\s?(?:ml|g|gm|kg|l|ltr|gb|tb)\b/i)?.[0];
  const words = tokens(cleaned).slice(0, 7);
  if (qty && !words.join(' ').includes(qty.replace(/\s/g, '').toLowerCase())) words.push(qty);
  return words.join(' ');
}
