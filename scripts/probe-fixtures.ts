import { readFileSync, existsSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseResponse } from '../src/core/parse.ts';
const cfg = JSON.parse(readFileSync('config/sites.json','utf8'));
for (const site of cfg.sites) {
  const f = ['html','json'].map(e=>`tests/fixtures/search-${site.id}.${e}`).find(existsSync);
  if (!f) continue;
  const r = parseResponse(site, readFileSync(f,'utf8'), (h)=>parseHTML(h).document as any);
  console.log(`=== ${site.id}: ${r.status} ${r.listings.length}`);
  for (const l of r.listings.slice(0,3)) console.log(`  ₹${l.price} mrp=${l.mrp} r=${l.rating} ${l.title.slice(0,60)} | ${l.url.slice(0,70)} | img=${!!l.image}`);
}
