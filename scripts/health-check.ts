// Daily site check (GitHub Actions, .github/workflows/health.yml): searches a few products on
// every site and reports which sites' pages loaded but gave no products — that usually means
// the site changed its page and config/sites.json needs a fix.
// GitHub's servers are abroad, so captchas / 403s here are expected and only reported, not flagged.
// Quick-commerce sites (they need a delivery location in India) are checked on a phone instead:
// npm run live -- "amul milk" --pin=560034 --lat=12.9352 --lng=77.6245
// Usage: node scripts/health-check.ts [--out report.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { chooseConfig } from '../src/core/configData.ts';
import { makeReference } from '../src/core/matcher.ts';
import { buildRequest } from '../src/core/parse.ts';
import { readSearch } from '../src/core/search.ts';

const QUERIES = ['boat airdopes 141', 'lakme sunscreen spf 50', 'levis 511 jeans'];
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined;
const config = chooseConfig({ at: Date.now(), sites: JSON.parse(readFileSync('config/sites.json', 'utf8')), offers: JSON.parse(readFileSync('config/offers.json', 'utf8')) });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const parseHtml = (h: string) => parseHTML(h).document as unknown as Document;

type Row = { site: string; query: string; http: number; status: string; listings: number };
const rows: Row[] = [];
for (const query of QUERIES) {
  const ref = makeReference(query, 'query');
  const sites = config.sites.filter((s) => s.fetch !== false && !s.location && s.categories.some((c) => ref.cats.includes(c)));
  await Promise.all(
    sites.map(async (site) => {
      const req = buildRequest(site, query);
      try {
        const r = await fetch(req.url, {
          method: req.method,
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...req.headers },
          body: req.body,
          signal: AbortSignal.timeout(20000),
        });
        const check = readSearch(site, { status: r.status, body: await r.text() }, ref, parseHtml);
        rows.push({ site: site.id, query, http: r.status, status: check.reason ?? check.status, listings: check.listings.length });
      } catch (e) {
        rows.push({ site: site.id, query, http: 0, status: `network: ${(e as Error).message.slice(0, 40)}`, listings: 0 });
      }
    }),
  );
}

// Broken = the page loaded (HTTP 200, no captcha) every time, but never had a product in it.
const bySite = new Map<string, Row[]>();
for (const r of rows) bySite.set(r.site, [...(bySite.get(r.site) ?? []), r]);
const broken = [...bySite].filter(([, rs]) => rs.every((r) => r.http === 200 && r.listings === 0 && r.status !== 'blocked')).map(([s]) => s);

const table = ['| Site | Query | HTTP | Result | Products |', '|---|---|---|---|---|', ...rows.sort((a, b) => a.site.localeCompare(b.site)).map((r) => `| ${r.site} | ${r.query} | ${r.http} | ${r.status} | ${r.listings} |`)];
const report = [
  broken.length ? `**Looks broken:** ${broken.join(', ')} — the page loaded but no products were read. Check \`config/sites.json\` (run \`npm run live -- "<product>" --save\` on a phone).` : '**No broken sites found.**',
  '',
  '_Run from GitHub servers outside India: "blocked" / 403 / 503 here are normal and not counted._',
  '',
  ...table,
].join('\n');
console.log(report);
if (out) writeFileSync(out, report);
if (broken.length) writeFileSync('broken-sites.txt', broken.join(', '));
