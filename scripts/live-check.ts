// Live health check: search every site for real, from this phone, and print a table.
// Uses the same code as the app (src/core/search.ts), with Node's fetch.
// Usage: npm run live -- "boat airdopes 141"           (add --save to refresh test fixtures)
//        npm run live -- "<shared text or product link>"  (checks the Share flow: page title → product-mode match)
//        add --json to print machine-readable rows (used by the daily GitHub health check)
//        quick commerce: --pin=560034 --lat=12.9352 --lng=77.6245 [--area= --city= --state=] (delivery location),
//        --only=blinkit,dmart (just these sites), --verbose (every request)
//        (Zepto and Instamart need the app's hidden browser, so they show as "app-only" here.)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { chooseConfig } from '../src/core/configData.ts';
import { condenseTitle, makeReference } from '../src/core/matcher.ts';
import { dedupeOffers } from '../src/core/offers.ts';
import type { UserLocation } from '../src/core/location.ts';
import { buildRequest } from '../src/core/parse.ts';
import { canCheck, checkSiteWith, flagOutliers, priceFor, readProductPage, readSearch, refineWithPage, sortResults, type Net } from '../src/core/search.ts';
import { cleanSharedText, cleanStoreTitle, isProductTitle } from '../src/core/share.ts';
import type { SiteResult, Wallet } from '../src/core/types.ts';

const args = process.argv.slice(2);
const save = args.includes('--save');
const asJson = args.includes('--json');
const verbose = args.includes('--verbose');
const input = args.filter((a) => !a.startsWith('--')).join(' ') || 'lakme sunscreen spf 50';
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = flag('only')?.split(',');
const lat = Number(flag('lat'));
const lng = Number(flag('lng'));
const pin = flag('pin');
const location: UserLocation | undefined =
  pin || flag('lat')
    ? { pincode: pin, ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}), area: flag('area'), city: flag('city'), state: flag('state'), label: 'live-check', source: 'pincode' }
    : undefined;
const wallet: Wallet = {
  cards: [{ bank: 'hdfc', type: 'credit' }, { bank: 'axis', type: 'credit', card: 'flipkart-axis' }, { bank: 'axis', type: 'credit' }],
  apps: ['gpay'],
  memberships: [],
  newUser: false,
};

// Read the config files fresh from disk (not the copy bundled at import time).
const config = chooseConfig({
  at: Date.now(),
  sites: JSON.parse(readFileSync('config/sites.json', 'utf8')),
  offers: JSON.parse(readFileSync('config/offers.json', 'utf8')),
});
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const headers = { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' };
const parseHtml = (h: string) => parseHTML(h).document as unknown as Document;
// A small cookie jar, like the phone's: quick-commerce setups (BigBasket, Flipkart Minutes) rely on it.
const jar = new Map<string, Map<string, string>>();
const cookiesFor = (url: string): Record<string, string> => {
  const host = new URL(url).hostname;
  const out: Record<string, string> = {};
  for (const [domain, values] of jar) if (host === domain || host.endsWith(`.${domain}`)) Object.assign(out, Object.fromEntries(values));
  return out;
};
const get = async (url: string, init: RequestInit = {}) => {
  const cookie = Object.entries(cookiesFor(url)).map(([k, v]) => `${k}=${v}`).join('; ');
  const r = await fetch(url, {
    ...init,
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as Record<string, string>) },
    signal: AbortSignal.timeout(15000),
  });
  for (const line of r.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';');
    const eq = pair.indexOf('=');
    const domain = (attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a))?.slice(7) ?? new URL(url).hostname).replace(/^\./, '');
    if (!jar.has(domain)) jar.set(domain, new Map());
    jar.get(domain)!.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const body = await r.text();
  if (verbose) console.log(`  ${init.method ?? 'GET'} ${url.slice(0, 90)} → ${r.status} ${body.length}b ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
  return { status: r.status, body };
};
const net: Net = { fetch: (req) => get(req.url, { method: req.method, headers: req.headers, body: req.body }), cookies: async (url) => cookiesFor(url) };

// Same steps as resolveInput() in the app.
const link = input.match(/https?:\/\/\S+/)?.[0];
let title: string | undefined;
if (link) {
  const html = await get(link).then((r) => r.body).catch(() => '');
  const raw = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<title[^>]*>([^<]+)/i)?.[1];
  const page = raw && cleanStoreTitle(raw.replace(/&amp;/g, '&'));
  const shared = cleanSharedText(input);
  title = isProductTitle(page) ? page : shared.length > 10 ? shared : undefined;
  if (!asJson) console.log(`Page title: ${page ?? '-'}\nShared text: ${shared || '-'}`);
  if (!title) throw new Error('No product name from this link');
}
const query = title ? condenseTitle(title) : input;
const ref = title ? makeReference(title, 'product') : makeReference(query, 'query');
const cats = ref.cats;
if (!asJson) console.log(`Query: "${query}"  categories: ${cats.join(', ')}\n`);

const general = cats.includes('general');
const relevant = config.sites.filter((s) => (general ? s.fetch !== false : s.categories.some((c) => cats.includes(c))) && (!only || only.includes(s.id)));
let pages = 0;

const results: (SiteResult & { ms?: number })[] = await Promise.all(
  relevant.map(async (site): Promise<SiteResult & { ms?: number }> => {
    const base = { site, listings: [], manualUrl: '' };
    if (site.fetch === false) return { ...base, status: 'manual' };
    const can = canCheck(site, net, location);
    if (can !== 'yes') return { ...base, status: 'manual', error: can };
    const t0 = Date.now();
    if (site.location) {
      // Quick commerce: setup steps (location, store) then the search, as in the app.
      const check = await checkSiteWith(site, query, ref, { net, location, parseHtml }).catch((e: Error) => ({ status: 'error' as const, listings: [], error: e.message.slice(0, 40) }));
      const best = 'best' in check && check.best ? priceFor(check.best, [], wallet, site) : undefined;
      return { ...base, status: check.status, listings: check.listings, best, error: check.error ?? ('reason' in check ? check.reason : undefined), ms: Date.now() - t0 };
    }
    const req = buildRequest(site, query);
    try {
      let res = await get(req.url, { method: req.method, headers: req.headers, body: req.body });
      let check = readSearch(site, res, ref, parseHtml);
      if (check.reason === 'empty-page') {
        await new Promise((r) => setTimeout(r, 1500));
        res = await get(req.url, { method: req.method, headers: req.headers, body: req.body });
        check = readSearch(site, res, ref, parseHtml);
      }
      if (save) writeFileSync(`tests/fixtures/search-${site.id}.${res.body.trimStart().startsWith('{') ? 'json' : 'html'}`, res.body);
      const staticOffers = config.offers.filter((o) => o.site === site.id);
      let best = check.best && priceFor(check.best, staticOffers, wallet, site);
      let offers = staticOffers;
      if (check.best && site.productOffers !== false && check.best.match !== 'size' && pages++ < 6) {
        const page = await get(check.best.url).catch(() => undefined);
        if (page?.status === 200) {
          const p = readProductPage(page.body, site.id);
          offers = dedupeOffers([...p.offers, ...staticOffers]);
          best = priceFor(refineWithPage(check.best, ref, p.facts), offers, wallet, site);
        }
      }
      return { ...base, status: check.status, listings: check.listings, best, offers, error: check.error ?? check.reason, ms: Date.now() - t0 };
    } catch (e) {
      return { ...base, status: 'error', error: (e as Error).message.slice(0, 40), ms: Date.now() - t0 };
    }
  }),
);

const sorted = sortResults(flagOutliers(results));
if (asJson) {
  console.log(JSON.stringify(sorted.map((r) => ({ site: r.site.id, status: r.status, count: r.listings.length, error: r.error, price: r.best?.price, match: r.best?.match }))));
} else {
  console.table(
    sorted.map((r) => {
      const b = r.best;
      const e = b?.effective;
      return {
        site: r.site.id,
        status: `${r.status}${r.error ? ` (${r.error})` : ''} [${r.listings.length}]`,
        ms: (r as { ms?: number }).ms,
        price: b?.price,
        coupon: b?.coupon?.price,
        mine: e && e.mine < b!.price ? e.mine : undefined,
        stock: b?.inStock === false ? 'OOS' : '',
        match: b ? `${b.match} ${b.score.toFixed(2)}${b.why?.size === 'unknown' ? ' size?' : ''}${b.why?.variant ? ` var:${b.why.variant}` : ''}${r.outlier ? ' OUTLIER' : ''}` : '',
        eta: b?.eta,
        title: b?.title.slice(0, 60),
      };
    }),
  );
}
