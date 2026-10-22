import { describe, expect, it } from 'vitest';
import { rupees } from '../src/core/money.ts';
import { applyCheck, lowestExact, mergeItems, priceStats, type WatchItem } from '../src/core/watchLogic.ts';
import type { MatchLabel, SiteResult } from '../src/core/types.ts';
import { site } from './helpers.ts';

const DAY = 86400000;
const item = (prices: number[], over: Partial<WatchItem> = {}): WatchItem => ({
  id: 'x',
  query: 'x',
  title: 'Thing',
  history: prices.map((price, i) => ({ t: Date.now() - (prices.length - i) * DAY, price, site: 'Amazon', v: 2 })),
  lastChecked: 0,
  ...over,
});
const low = (price: number) => ({ low: { price, site: 'Flipkart' }, anyExact: true });

describe('applyCheck', () => {
  it('alerts on a new low, once', () => {
    const first = applyCheck(item([1000, 990]), low(900));
    expect(first.alert).toMatchObject({ kind: 'drop', price: 900, before: 990 });
    expect(applyCheck(first.item, low(900)).alert).toBeUndefined();
  });
  it('a tiny change is not a drop', () => expect(applyCheck(item([1000]), low(995)).alert).toBeUndefined());
  it('target alert only when the price crosses it', () => {
    expect(applyCheck(item([1000], { target: 950 }), low(940)).alert?.kind).toBe('target');
    expect(applyCheck(item([940], { target: 950 }), low(945)).alert).toBeUndefined();
  });
  it('back in stock', () => {
    const out = applyCheck(item([1000]), { anyExact: true });
    expect(out.item.inStock).toBe(false);
    expect(applyCheck(out.item, low(1100)).alert?.kind).toBe('stock');
  });
  it('not found anywhere still counts as checked (no re-search on every app open)', () => {
    const r = applyCheck(item([1000]), { anyExact: false }, 12345);
    expect(r.item.lastChecked).toBe(12345);
    expect(r.item.inStock).toBeUndefined();
  });
  it('old after-card prices (before v2) never cause a drop alert', () => {
    const old = item([], { history: [{ t: Date.now() - DAY, price: 800, site: 'Amazon' }] });
    expect(applyCheck(old, low(900)).alert).toBeUndefined();
  });
});

describe('lowestExact', () => {
  const r = (id: string, price: number, match: MatchLabel, extra: Partial<SiteResult> = {}, inStock?: boolean): SiteResult => ({
    site: site(id),
    status: 'ok',
    listings: [],
    manualUrl: '',
    best: { site: id, title: id, price, url: id, score: 1, match, inStock, effective: { price, base: price, fees: 0, mine: price - 50, mineLater: 0, any: price } },
    ...extra,
  });
  it('uses the site price of in-stock exact matches, not outliers', () => {
    const { low: l } = lowestExact([r('amazon', 500, 'exact', { outlier: true }), r('flipkart', 900, 'similar'), r('nykaa', 1000, 'exact'), r('myntra', 800, 'exact', {}, false)]);
    expect(l).toMatchObject({ price: 1000, site: 'Nykaa', eff: 950 });
  });
});

describe('priceStats', () => {
  it('good / typical / high', () => {
    expect(priceStats(item([1000, 1100, 900]).history)?.deal).toBe('good');
    expect(priceStats(item([900, 1000, 1000, 1000]).history)?.deal).toBe('typical');
    expect(priceStats(item([900, 900, 900, 1200]).history)?.deal).toBe('high');
  });
  it('needs a few days of history', () => expect(priceStats(item([1000, 900]).history)).toBeUndefined());
});

describe('mergeItems', () => {
  it("keeps the user's target from the stored copy", () => {
    const stored = [item([1000], { target: 800 })];
    expect(mergeItems(stored, [item([1000, 950])])[0]).toMatchObject({ target: 800, history: expect.any(Array) });
  });
});

describe('rupees', () => {
  it.each([
    [499, '₹499'],
    [59900, '₹59,900'],
    [1234567, '₹12,34,567'],
    [99.6, '₹100'],
  ])('%d → %s', (n, s) => expect(rupees(n)).toBe(s));
});
