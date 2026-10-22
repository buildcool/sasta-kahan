import type { Category, Listing, MatchLabel, MatchWhy, Quantity, ScoredListing } from './types.ts';

const STOP = new Set(['for', 'with', 'and', 'the', 'of', 'in', 'on', 'a', 'an', 'to', 'by', 'from', 'new', 'buy', 'online', 'best', 'all', 'pack', 'combo', 'set', 'pc', 'pcs', 'piece', 'pieces', 'free', 'off']);

// Unit words after a number get one spelling, so "5 litre", "5 L" and "5Ltr" are the same token ("5l").
const UNIT_WORDS = 'millilit(?:er|re)s?|mls?|lit(?:er|re)s?|ltrs?|lt|l|kilo(?:gram)?s?|kgs?|grams?|gms?|gm|gr|g|gb|tb|mah|watts?|w|inch(?:es)?|mm|cm|tons?|hz|mp';
const UNIT_AFTER_NUMBER = new RegExp(`(\\d)\\s*(${UNIT_WORDS})(?![a-z])`, 'g');

function canonicalUnit(u: string): string {
  if (/^(millilit|mls?$)/.test(u)) return 'ml';
  if (/^(lit|ltrs?$|lt$|l$)/.test(u)) return 'l';
  if (/^(kilo|kgs?$)/.test(u)) return 'kg';
  if (/^(gram|gms?$|gm$|gr$|g$)/.test(u)) return 'g';
  if (/^watt/.test(u)) return 'w';
  if (/^inch/.test(u)) return 'inch';
  if (/^ton/.test(u)) return 'ton';
  return u;
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Lakmé → Lakme
    .toLowerCase()
    .replace(/['’‘`´]/g, '') // Levi's → levis, Men's → mens
    .replace(/&/g, ' and ')
    .replace(/(\d)\s*(?:"|''|”|″)/g, '$1inch')
    .replace(UNIT_AFTER_NUMBER, (_, d: string, u: string) => d + canonicalUnit(u)) // "50 ml" → "50ml", "5 Litre" → "5l"
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

const SIZE_TOKEN = /^(\d+(?:\.\d+)?)(ml|l|g|kg|gb|tb)$/;
const isSizeToken = (t: string) => SIZE_TOKEN.test(t);
/** Tokens that identify a model: contain digits (iphone "15", "181", "spf50") — must match. */
const isModelToken = (t: string) => /\d/.test(t) && !isSizeToken(t);

// "5G" on a phone is the network, not 5 grams.
const NETWORK_CONTEXT = /\b(phone|mobile|smartphone|router|dongle|hotspot|sim|lte|volte|tablet|wi-?fi|ram|storage|\d+\s*gb)\b/i;

export function extractQuantity(title: string): Quantity | undefined {
  const networkG = NETWORK_CONTEXT.test(title);
  const found: { value: number; unit: Quantity['unit'] }[] = [];
  for (const t of normalize(title).split(' ')) {
    const m = t.match(SIZE_TOKEN);
    if (!m) continue;
    let value = parseFloat(m[1]);
    let unit: Quantity['unit'];
    switch (m[2]) {
      case 'ml':
        unit = 'ml';
        break;
      case 'l':
        (unit = 'ml'), (value *= 1000);
        break;
      case 'g':
        if (networkG && /^[2-6]$/.test(m[1])) continue;
        unit = 'g';
        break;
      case 'kg':
        (unit = 'g'), (value *= 1000);
        break;
      case 'tb':
        (unit = 'gb'), (value *= 1024);
        break;
      default:
        unit = 'gb';
    }
    if (value > 0) found.push({ value, unit });
  }
  const t = title.toLowerCase();
  const packM = t.match(/pack of (\d+)|set of (\d+)|(\d+)\s*(?:x|\*)\s*\d+(?:\.\d+)?\s*(?:ml|g|gm|l|kg)|\(?(\d+)\s*(?:pcs|pieces|n)\)?|combo of (\d+)|buy (?:1|one) get (?:1|one)/);
  let pack = 1;
  if (packM) pack = /buy (1|one) get/.test(packM[0]) ? 2 : parseInt(packM.slice(1).find(Boolean) ?? '1', 10);
  if (!(pack >= 1 && pack <= 50)) pack = 1;
  if (!found.length) return pack > 1 ? { value: 1, unit: 'pcs', pack } : undefined;
  // Storage: biggest number (128GB beats 8GB RAM). Volume/weight: first mention.
  const pickQ = found.some((f) => f.unit === 'gb') ? found.filter((f) => f.unit === 'gb').sort((a, b) => b.value - a.value)[0] : found[0];
  return { ...pickQ, pack };
}

/** Creams are sold by ml on one site and by g on another — treat the two as comparable. */
const comparableUnits = (a: Quantity['unit'], b: Quantity['unit']) => a === b || (/^(ml|g)$/.test(a) && /^(ml|g)$/.test(b));

export function sameQuantity(a?: Quantity, b?: Quantity): boolean {
  if (!a || !b) return true; // unknown → don't penalise
  if (!comparableUnits(a.unit, b.unit)) return false;
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
  cats: Category[];
}

export function makeReference(text: string, mode: Reference['mode']): Reference {
  return { text, qty: extractQuantity(text), mode, cats: detectCategories(text) };
}

function tokenHit(t: string, ct: Set<string>, ctNorm: string): boolean {
  if (ct.has(t)) return true;
  if (isModelToken(t)) return false; // numbers must match exactly: 50 ≠ 50ml, 181 ≠ 1810
  return ctNorm.includes(' ' + t) || (t.length > 4 && ctNorm.includes(t));
}

/** Weighted share of the reference words (from index `from`) found in `text` (no penalties). */
function coverage(rt: string[], text: string, from = 0): number {
  const norm = ' ' + text + ' ';
  const set = new Set(text.split(' '));
  let hit = 0;
  let total = 0;
  rt.forEach((t, i) => {
    if (i < from) return;
    const w = weight(t, i);
    total += w;
    if (tokenHit(t, set, norm)) hit += w;
  });
  return total ? hit / total : 0;
}

// Accessories sold "for" a product: "Lens Protector for iPhone 15", "Cable compatible with iPhone 15".
const FOR_RE = /\b(?:for|compatible with|compatible for|suitable for|designed for|fits|fit for|works with|made for)\b/;
// Accessory words — only checked for electronics, where "cover" or "band" isn't part of a normal product name.
const ACCESSORY_RE = /\b(case|cases|cover|covers|protector|tempered|guard|charger|chargers|adapter|adaptor|cable|cables|cord|strap|straps|band|bands|holder|mount|stand|stylus|replacement|spare|bumper|skin|skins|film|sleeve|bag|dock|hub)\b/g;
// "Aluminium Case" (Apple Watch), "Charging Case" (earbuds), "without charger" are part of the product.
const NOT_ACCESSORY_BEFORE = /\b(aluminium|aluminum|steel|titanium|ceramic|charging|wireless|magsafe|metal|without|no|excluding|excl)\s$/;

function isAccessory(ref: Reference, rt: string[], titleNorm: string): boolean {
  const refNorm = normalize(ref.text);
  if (new RegExp(ACCESSORY_RE.source).test(refNorm)) return false; // they're looking for an accessory
  const f = titleNorm.match(FOR_RE);
  if (f && coverage(rt, titleNorm.slice(0, f.index).trim()) < 0.5 && coverage(rt, titleNorm) >= 0.5) return true;
  if (!ref.cats.includes('electronics')) return false;
  // "Spigen Ultra Hybrid iPhone 15 Case": an accessory word among the first words (before any "with …").
  const main = titleNorm.split(/\b(?:with|includes?|including)\b/)[0].split(' ').slice(0, 10).join(' ');
  for (const m of main.matchAll(ACCESSORY_RE)) {
    if (!NOT_ACCESSORY_BEFORE.test(main.slice(0, m.index))) return true;
  }
  return false;
}

// Words that make a different model / variant next to the product's own words:
// "iPhone 15 Plus", "Galaxy S24 FE", "Tata Salt Lite", "Himalayan Pink Salt". Not used for beauty/fashion, where titles
// are full of words like "Ultra Matte" that don't change the product.
const VARIANTS: Partial<Record<Category, string[]>> = {
  electronics: ['pro', 'max', 'plus', 'ultra', 'mini', 'lite', 'fe', 'neo', 'prime', 'air', 'slim', 'se', 'edge', 'fold', 'flip', 'nano', 'turbo'],
  grocery: ['lite', 'light', 'rock', 'pink', 'black', 'sendha', 'low', 'diet', 'zero', 'sugarfree', 'refill'],
  home: ['plus', 'pro', 'deluxe', 'mini', 'max', 'neo', 'duo'],
};

function variantWord(ref: Reference, rt: string[], ct: string[]): string | undefined {
  const words = new Set(ref.cats.flatMap((c) => VARIANTS[c] ?? []));
  if (!words.size) return undefined;
  const rs = new Set(rt);
  // Model suffixes come after the name ("15 Plus"); grocery variants usually come before it too ("Pink Salt").
  const before = ref.cats.includes('grocery') ? 2 : 0;
  for (let i = 0; i < ct.length; i++) {
    if (!rs.has(ct[i])) continue;
    const near = [...ct.slice(Math.max(0, i - before), i), ...ct.slice(i + 1, i + 3)].find((w) => words.has(w) && !rs.has(w));
    if (near) return near;
  }
  return undefined;
}

function sizeStatus(ref?: Quantity, l?: Quantity): MatchWhy['size'] {
  if (!ref) return 'none';
  if (!l) return 'unknown';
  return sameQuantity(ref, l) ? 'same' : 'different';
}

/** Score 0..1 plus the reasons, for one listing title. */
export function analyze(ref: Reference, title: string, qty = extractQuantity(title)): { score: number; why: MatchWhy } {
  const rt = tokens(ref.text).filter((t) => !isSizeToken(t));
  const titleNorm = normalize(title);
  const ctList = tokens(title).filter((t) => !isSizeToken(t));
  const ct = new Set(ctList);
  const ctNorm = ' ' + titleNorm + ' ';
  const found: string[] = [];
  const missing: string[] = [];

  // Recall: how much of the reference does the listing contain?
  let hit = 0;
  let total = 0;
  rt.forEach((t, i) => {
    const w = weight(t, i);
    total += w;
    if (tokenHit(t, ct, ctNorm)) {
      hit += w;
      found.push(t);
    } else {
      missing.push(t);
      if (isModelToken(t)) hit -= w; // "airdopes 141" must not match "airdopes 181"
    }
  });
  let s = rt.length ? Math.max(0, hit / total) : 0;

  if (ref.mode === 'product' && s) {
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
    s = precision ? (2 * s * precision) / (s + precision) : 0;
  }

  // Brand plus one common word ("Prestige … Cooker") isn't the product when the words that
  // say which one ("Popular Svachh Pressure") are all missing.
  if (ref.mode === 'query' && rt.length >= 3 && coverage(rt, titleNorm, 1) < 0.5) s = Math.min(s, 0.5);
  // The first word is usually the brand: another brand's serum isn't "similar" to this one.
  if (rt.length >= 2 && missing[0] === rt[0]) s = Math.min(s, 0.5);

  const why: MatchWhy = { found, missing, size: sizeStatus(ref.qty, qty) };
  const variant = variantWord(ref, rt, ctList);
  if (variant) why.variant = variant;
  if (s >= 0.5 && isAccessory(ref, rt, titleNorm)) why.accessory = true;
  return { score: s, why };
}

/** 0..1 — how well a listing title matches the reference. */
export const score = (ref: Reference, title: string) => analyze(ref, title).score;

export function label(ref: Reference, s: number, why: MatchWhy): MatchLabel {
  if (why.accessory) return 'different';
  const exactThreshold = ref.mode === 'query' ? 0.99 : 0.85;
  if (s >= exactThreshold) {
    if (why.size === 'different') return 'size';
    // Can't confirm it's the same thing: a variant word, or the listing doesn't say its size.
    return why.variant || why.size === 'unknown' ? 'similar' : 'exact';
  }
  if (s >= 0.55) return why.size === 'different' ? 'size' : 'similar';
  return 'different';
}

export function scoreListings(ref: Reference, list: Listing[]): ScoredListing[] {
  return list.map((l) => {
    const qty = extractQuantity(l.title);
    const { score: s, why } = analyze(ref, l.title, qty);
    return { ...l, score: s, qty, why, match: label(ref, s, why), unitPrice: unitPrice(l.price, qty) };
  });
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Pick the listing to show for one site: the cheapest among the best matches.
 * Same-size items beat other sizes; different products are never picked;
 * in-stock items beat out-of-stock ones.
 */
export function pickBest(scored: ScoredListing[]): ScoredListing | undefined {
  const rank: Record<MatchLabel, number> = { exact: 3, similar: 2, size: 1, different: 0 };
  const matching = scored.filter((s) => s.match !== 'different');
  const inStock = matching.filter((s) => s.inStock !== false);
  const pool = inStock.length ? inStock : matching;
  if (!pool.length) return undefined;
  const topRank = Math.max(...pool.map((s) => rank[s.match]));
  const tier = pool.filter((s) => rank[s.match] === topRank);
  const topScore = Math.max(...tier.map((s) => s.score));
  let close = tier.filter((s) => s.score >= topScore - 0.08);
  // One "same product" far cheaper than the rest is usually an accessory or a sample pack.
  if (close.length >= 3) {
    const mid = median(close.map((s) => s.price));
    const sane = close.filter((s) => s.price >= mid * 0.4);
    if (sane.length) close = sane;
  }
  return close.sort((a, b) => a.price - b.price || (a.sponsored ? 1 : 0) - (b.sponsored ? 1 : 0))[0];
}

// Strong words decide the category on their own. Weak words ("gel", "cream", "watch") only
// count when nothing strong matched: "asics gel kayano shoes" is shoes, not skincare.
const CATEGORY_WORDS: { re: RegExp; cats: Category[]; weak?: true }[] = [
  {
    cats: ['electronics'],
    re: /\b(phones?|mobile|smartphone|iphone|galaxy|redmi|oneplus|realme|vivo|oppo|pixel|poco|iqoo|motorola|moto|nothing phone|laptop|notebook|tablet|ipad|macbook|earbuds?|airdopes|airpods|buds|headphones?|headset|earphones?|neckband|speaker|soundbar|smart ?watch|smartwatch|tv|television|monitor|camera|dslr|gopro|ssd|hdd|hard disk|pen ?drive|memory card|router|charger|power ?bank|trimmer|shaver|refrigerator|fridge|washing machine|ac|air conditioner|microwave|printer|keyboard|mouse|console|playstation|ps5|xbox|kindle|alexa|echo dot|fire tv|chromecast|boat|jbl|sony|samsung|apple|xiaomi|lenovo|asus|acer|dell|hp|lg|noise|fire-?boltt|amazfit|\d+\s?gb)\b/i,
  },
  {
    cats: ['electronics', 'home'],
    re: /\b(mixer|grinder|juicer|kettle|induction|iron|fan|cooler|geyser|water heater|purifier|vacuum|air fryer|chimney|bajaj|havells|crompton|usha|philips|kent|aquaguard|eureka forbes|led bulb)\b/i,
  },
  {
    cats: ['home'],
    re: /\b(cooker|pressure cooker|kadai|kadhai|tawa|frying pan|cookware|casserole|lunch ?box|tiffin|flask|water bottle|dinner set|bedsheet|bed sheet|pillow|mattress|curtains?|towels?|blanket|quilt|comforter|sofa|lamp|storage box|container|bucket|mop|dustbin|gas stove|prestige|pigeon|hawkins|butterfly|milton|cello|borosil|wonderchef|wakefit|sleepyhead|duroflex|bombay dyeing)\b/i,
  },
  { cats: ['home'], re: /\b(pan|bottle|glass|mug|chair|table|bulb|decor)\b/i, weak: true },
  {
    cats: ['beauty'],
    re: /\b(sunscreen|sunblock|spf|serum|moisturi[sz]er|face ?wash|cleanser|toner|lipstick|lip ?balm|kajal|mascara|eyeliner|foundation|concealer|primer|blush|highlighter|hair oil|hair mask|body lotion|lotion|perfume|deo|deodorant|nail polish|makeup|kohl|face mask|sheet mask|scrub|lakme|maybelline|minimalist|mamaearth|nivea|loreal|plum|cetaphil|neutrogena|dot (and|&) key|derma ?co|biotique|wow|foxtale|cerave|ponds|garnier|olay|vaseline|swiss beauty|kay beauty|mcaffeine|bella vita|beardo)\b/i,
  },
  { cats: ['beauty', 'grocery'], re: /\b(shampoo|conditioner|soap|body ?wash|toothpaste|handwash|hand wash|dove|himalaya|dabur|patanjali)\b/i },
  { cats: ['beauty'], re: /\b(cream|gel|lip|mask|wash)\b/i, weak: true },
  {
    cats: ['fashion'],
    re: /\b(shirts?|t-?shirts?|tshirts?|tee|jeans|trousers?|kurtas?|kurtis?|sarees?|saris?|lehenga|dress|jacket|hoodie|sweatshirt|sweater|shoes?|sneakers?|sandals?|slippers?|flip ?flops|heels|boots|handbag|backpack|wallet|belt|sunglasses|socks|bra|briefs|boxers|shorts|track ?pants|joggers|leggings|analog|jewellery|earrings|necklace|nike|adidas|puma|reebok|asics|skechers|bata|campus|red tape|woodland|crocs|levis|wrangler|pepe|us polo|allen solly|van heusen|peter england|louis philippe|raymond|roadster|hrx|h&m|zara|titan|fastrack|casio|fossil|timex|sonata|biba|libas|fabindia)\b/i,
  },
  { cats: ['fashion', 'electronics'], re: /\b(watch|watches)\b/i, weak: true },
  { cats: ['fashion'], re: /\b(top|cap|bag|ring)\b/i, weak: true },
  {
    cats: ['grocery'],
    re: /\b(atta|rice|basmati|dal|ghee|sugar|salt|tea|coffee|biscuits?|cookies|chocolates?|maggi|noodles|pasta|snacks?|chips|namkeen|masala|spices?|milk|butter|cheese|paneer|bread|juice|cold drink|honey|jam|ketchup|sauce|cornflakes|oats|muesli|dry fruits|almonds|cashews?|detergent|washing powder|dishwash|toilet cleaner|floor cleaner|cooking oil|sunflower oil|mustard oil|surf|tide|ariel|harpic|dettol|lizol|vim|colgate|pepsodent|aashirvaad|fortune|saffola|amul|britannia|parle|haldiram|kelloggs|nescafe|bru|tata tea|red label|horlicks|bournvita|complan|kissan|sunfeast|cadbury|lays|kurkure|india gate|daawat|mdh|everest)\b/i,
  },
  { cats: ['grocery', 'beauty'], re: /\b(oil)\b/i, weak: true },
];

export function detectCategories(query: string): Category[] {
  const q = query.toLowerCase().replace(/['’]/g, '');
  const hits = CATEGORY_WORDS.filter((c) => c.re.test(q));
  const strong = hits.filter((c) => !c.weak);
  const cats = new Set((strong.length ? strong : hits).flatMap((c) => c.cats));
  return cats.size ? [...cats] : ['general'];
}

/** Short search string from a long product title: brand + key words + size. */
export function condenseTitle(title: string): string {
  const cleaned = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/\s[|–-]\s|,/)[0]
    .trim();
  const words = tokens(cleaned).slice(0, 7);
  const size = tokens(title).find(isSizeToken);
  if (size && !words.includes(size)) words.push(size);
  return words.join(' ');
}
