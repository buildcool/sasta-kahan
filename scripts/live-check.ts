// Live health check: search every site for real, from this phone, and print a table.
// Usage: npm run live -- "boat airdopes 141"           (add --save to refresh test fixtures)
//        npm run live -- "<shared text or product link>"  (checks the Share flow: page title → product-mode match)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { effectivePrice } from '../src/core/effectivePrice.ts';
import { condenseTitle, detectCategories, makeReference, pickBest, scoreListings } from '../src/core/matcher.ts';
import { dedupeOffers, harvestOffers } from '../src/core/offers.ts';
import { buildRequest, parseResponse } from '../src/core/parse.ts';
import { cleanSharedText, cleanStoreTitle, isProductTitle } from '../src/core/share.ts';
import type { Offer, SiteConfig, UserCard } from '../src/core/types.ts';

const args = process.argv.slice(2);
const save = args.includes('--save');
const input = args.filter((a) => !a.startsWith('--')).join(' ') || 'lakme sunscreen spf 50';
const cards: UserCard[] = [{ bank: 'hdfc', type: 'credit' }, { bank: 'axis', type: 'credit', card: 'flipkart-axis' }];

const sites = JSON.parse(readFileSync('config/sites.json', 'utf8')).sites as SiteConfig[];
const staticOffers = (JSON.parse(readFileSync('config/offers.json', 'utf8')).offers as Offer[]).map((o) => ({ ...o, source: 'config' as const }));
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const headers = { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' };

// Same steps as resolveInput() in the app, using node's fetch.
const link = input.match(/https?:\/\/\S+/)?.[0];
let title: string | undefined;
if (link) {
  const html = await fetch(link, { headers }).then((r) => r.text()).catch(() => '');
  const raw = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<title[^>]*>([^<]+)/i)?.[1];
  const page = raw && cleanStoreTitle(raw.replace(/&amp;/g, '&'));
  const shared = cleanSharedText(input);
  title = isProductTitle(page) ? page : shared.length > 10 ? shared : undefined;
  console.log(`Page title: ${page ?? '-'}\nShared text: ${shared || '-'}`);
  if (!title) throw new Error('No product name from this link');
}
const query = title ? condenseTitle(title) : input;
const cats = detectCategories(query);
const ref = title ? makeReference(title, 'product') : makeReference(query, 'query');
console.log(`Query: "${query}"  categories: ${cats.join(', ')}\n`);

const rows = await Promise.all(
  sites.map(async (site) => {
    const relevant = cats.includes('general') || site.categories.some((c) => cats.includes(c));
    if (!relevant) return { site: site.id, status: 'skipped (category)' };
    if (site.fetch === false) return { site: site.id, status: 'manual only' };
    const req = buildRequest(site, query);
    const t0 = Date.now();
    try {
      const res = await fetch(req.url, { method: req.method, headers: { ...headers, ...req.headers }, body: req.body, signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      if (save) writeFileSync(`tests/fixtures/search-${site.id}.${body.trimStart().startsWith('{') ? 'json' : 'html'}`, body);
      const parsed = parseResponse(site, body, (h) => parseHTML(h).document as unknown as Document);
      const best = pickBest(scoreListings(ref, parsed.listings));
      let offers: Offer[] = staticOffers.filter((o) => o.site === site.id);
      if (best) {
        const page = await fetch(best.url, { headers, signal: AbortSignal.timeout(15000) }).then((r) => r.text()).catch(() => '');
        offers = dedupeOffers([...harvestOffers(page, site.id), ...offers]);
      }
      const eff = best && effectivePrice(best.price, offers, cards);
      return {
        site: site.id,
        status: `${res.status} ${parsed.status} (${parsed.listings.length})`,
        ms: Date.now() - t0,
        price: best?.price,
        mine: eff && eff.mine < eff.price ? eff.mine : undefined,
        offers: offers.length,
        match: best ? `${best.match} ${best.score.toFixed(2)}` : '',
        title: best?.title.slice(0, 50),
      };
    } catch (e) {
      return { site: site.id, status: `ERROR ${(e as Error).message.slice(0, 40)}`, ms: Date.now() - t0 };
    }
  }),
);
console.table(rows);
