import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMPTY_WALLET } from '../src/core/effectivePrice.ts';
import { makeReference } from '../src/core/matcher.ts';
import { parseOfferText } from '../src/core/offers.ts';
import { priceFor, readSearch, sortResults } from '../src/core/search.ts';
import type { SiteResult, Wallet } from '../src/core/types.ts';
import { applyCheck, type WatchItem } from '../src/core/watchLogic.ts';
import { LangContext, type Lang } from '../src/i18n.ts';
import { DEFAULT_SETTINGS } from '../src/storage.ts';
import { Cards } from '../src/ui/Cards.tsx';
import { More } from '../src/ui/More.tsx';
import { Results } from '../src/ui/Results.tsx';
import { Watch } from '../src/ui/Watch.tsx';
import { fixture, parseHtml, site } from './helpers.ts';

// Render each screen with real search results so runtime errors and missing strings show up in CI.
const wallet: Wallet = { ...EMPTY_WALLET, cards: [{ bank: 'axis', type: 'credit', card: 'flipkart-axis' }, { bank: 'axis', type: 'credit' }], apps: ['cred'] };
const ref = makeReference('lakme sunscreen spf 50', 'query');
const results: SiteResult[] = sortResults(
  ['amazon', 'flipkart', 'nykaa', 'myntra', 'meesho', 'ajio', 'tatacliq'].map((id): SiteResult => {
    const s = site(id);
    const check = readSearch(s, { status: 200, body: fixture(`search-${id}`) }, ref, parseHtml);
    const offers = [parseOfferText('10% off up to ₹100 on Axis Bank Credit Card', id)!, parseOfferText('Flat ₹50 off on your first CRED UPI transaction', id)!];
    return { site: s, status: check.status, listings: check.listings, best: check.best && priceFor(check.best, offers, wallet, s), offers, manualUrl: s.search, checkedAt: Date.now() };
  }),
);
results.push({ site: site('croma'), status: 'nomatch', listings: results[0].listings.slice(0, 3), manualUrl: 'https://www.croma.com' });
results.push({ site: site('reliance'), status: 'blocked', listings: [], error: 'empty-page', manualUrl: 'https://www.reliancedigital.in' });

const render = (lang: Lang, el: ReturnType<typeof h>) => renderToStaticMarkup(h(LangContext.Provider, { value: lang }, el));
const noop = () => {};

describe.each(['en', 'hinglish', 'hi'] as Lang[])('screens render (%s)', (lang) => {
  it('results', () => {
    const html = render(lang, h(Results, { results, query: 'lakme sunscreen spf 50', wallet, version: '1.1.0', membershipName: (x: string) => x, onCompareExact: noop }));
    expect(html).toContain('winner');
    expect(html).toContain('₹');
    expect(html).not.toMatch(/\b(res|card|status|match|badge)\.[a-z]+/); // no untranslated keys
  });
  it('cards', () => {
    const html = render(lang, h(Cards, { wallet, memberships: [{ id: 'prime', name: 'Amazon Prime', site: 'amazon' }], offersUpdated: '2026-10-22', onChange: noop }));
    expect(html).toContain('CRED');
    expect(html).not.toMatch(/\bcards\.[a-z]+/);
  });
  it('watchlist with history, target and stats', () => {
    let it1: WatchItem = { id: 'a', query: 'a', title: 'Lakme Sunscreen', history: [], lastChecked: 0, target: 300 };
    for (const p of [420, 400, 380, 390]) it1 = applyCheck(it1, { low: { price: p, site: 'Amazon' }, anyExact: true }, Date.now() - (500 - p) * 86400000).item;
    const html = render(lang, h(Watch, { items: [it1, { id: 'b', query: 'b', title: 'Out', history: [], lastChecked: 1, inStock: false }], backgroundOn: false, onCheck: async () => {}, onRemove: noop, onOpen: noop, onTarget: noop }));
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/\bwatch\.[a-z]+/);
  });
  it('more', () => {
    const html = render(lang, h(More, { settings: { ...DEFAULT_SETTINGS, lang, logins: ['amazon'] }, onSettings: noop, version: { version: '1.1.0', build: 5 }, onRestored: noop }));
    expect(html).toContain('Amazon');
    expect(html).not.toMatch(/\b(more|privacy)\.[a-z]+/);
  });
});
