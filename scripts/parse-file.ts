// Debug one saved page: node scripts/parse-file.ts <siteId> <file> "<query>"
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseResponse } from '../src/core/parse.ts';
import { makeReference, scoreListings } from '../src/core/matcher.ts';
const [id, file, q] = process.argv.slice(2);
const site = JSON.parse(readFileSync('config/sites.json','utf8')).sites.find((s:any)=>s.id===id);
const r = parseResponse(site, readFileSync(file,'utf8'), (h)=>parseHTML(h).document as any);
console.log(r.status, r.listings.length);
for (const l of scoreListings(makeReference(q,'query'), r.listings).slice(0,8)) console.log(` ${l.match} ${l.score.toFixed(2)} ₹${l.price} ${l.title.slice(0,80)}`);
