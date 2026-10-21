import { readFileSync, existsSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseResponse } from '../src/core/parse.ts';
import { makeReference, scoreListings, pickBest } from '../src/core/matcher.ts';
import { condenseTitle } from '../src/core/matcher.ts';
const cfg = JSON.parse(readFileSync('config/sites.json','utf8'));
const [q, mode='query'] = process.argv.slice(2);
const ref = makeReference(q, mode as any);
console.log('ref', ref, 'condensed:', condenseTitle(q));
for (const site of cfg.sites) {
  const f = ['html','json'].map(e=>`tests/fixtures/search-${site.id}.${e}`).find(existsSync); if(!f) continue;
  const r = parseResponse(site, readFileSync(f,'utf8'), (h)=>parseHTML(h).document as any);
  const sc = scoreListings(ref, r.listings); const b = pickBest(sc);
  const counts = sc.reduce((a:any,x)=>(a[x.match]=(a[x.match]??0)+1,a),{});
  console.log(site.id.padEnd(9), JSON.stringify(counts), b ? `→ ₹${b.price} [${b.match} ${b.score.toFixed(2)}] ${b.unitPrice?`₹${b.unitPrice.value.toFixed(0)}/${b.unitPrice.per}`:''} ${b.title.slice(0,70)}` : '→ none');
}
