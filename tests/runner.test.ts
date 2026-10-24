import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchItem } from '../src/core/watchLogic.ts';

// The background checker uses globals from Capacitor Background Runner; fake them here.
const kv: Record<string, string> = {};
const notes: { title: string; body: string }[] = [];
const fetched: string[] = [];
const fixtures: [RegExp, string][] = [
  [/amazon\.in/, 'search-amazon.html'],
  [/flipkart\.com/, 'search-flipkart.html'],
  [/nykaa\.com/, 'search-nykaa.html'],
  [/myntra\.com/, 'search-myntra.html'],
  [/meesho\.com/, 'search-meesho.json'],
  [/ajio\.com/, 'search-ajio.html'],
  [/tatacliq\.com/, 'search-tatacliq.html'],
];

let checkWatchlist: (now?: number) => Promise<number>;

beforeAll(async () => {
  vi.stubGlobal('CapacitorKV', { get: (k: string) => ({ value: kv[k] ?? null }), set: (k: string, v: string) => (kv[k] = v) });
  vi.stubGlobal('CapacitorNotifications', { schedule: (n: { title: string; body: string }[]) => notes.push(...n) });
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    const f = fixtures.find(([re]) => re.test(url));
    return { status: f ? 200 : 404, text: async () => (f ? readFileSync(`tests/fixtures/${f[1]}`, 'utf8') : '') };
  });
  ({ checkWatchlist } = await import('../src/runner/background.ts'));
});

const item = (over: Partial<WatchItem> = {}): WatchItem => ({
  id: 'lakme sunscreen spf 50',
  query: 'lakme sunscreen spf 50',
  title: 'Lakme Sunscreen SPF 50',
  history: [{ t: Date.now() - 3 * 86400000, price: 9999, site: 'Amazon', v: 2 }],
  lastChecked: 0,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(kv)) delete kv[k];
  notes.length = 0;
  fetched.length = 0;
});

describe('background price check', () => {
  it('re-checks stale items, records the price and notifies on a drop', async () => {
    kv.watch = JSON.stringify([item(), item({ id: 'recent', query: 'x', lastChecked: Date.now() - 60_000 })]);
    expect(await checkWatchlist()).toBe(1);
    const [checked, recent] = JSON.parse(kv.watch) as WatchItem[];
    expect(checked.history).toHaveLength(2);
    expect(checked.history[1].price).toBeLessThan(9999);
    expect(recent.lastChecked).toBeLessThan(Date.now() - 30_000);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/^Price drop: Lakme/);
  });
  it('writes notifications in the chosen language', async () => {
    kv.settings = JSON.stringify({ lang: 'hi' });
    kv.watch = JSON.stringify([item()]);
    await checkWatchlist();
    expect(notes[0].title).toMatch(/^कीमत घटी/);
  });
  it('does nothing when background checks are turned off', async () => {
    kv.settings = JSON.stringify({ background: false });
    kv.watch = JSON.stringify([item()]);
    expect(await checkWatchlist()).toBe(0);
    expect(fetched).toHaveLength(0);
  });
  it('checks the quick-commerce sites it can reach without the app (with a saved location)', async () => {
    kv.location = JSON.stringify({ lat: 12.9352, lng: 77.6245, pincode: '560034', label: 'Koramangala', source: 'pincode' });
    kv.watch = JSON.stringify([item({ id: 'milk', query: 'amul taaza toned milk 500 ml', title: 'Amul Taaza' })]);
    await checkWatchlist();
    const hosts = fetched.map((u) => new URL(u).host);
    expect(hosts).toEqual(expect.arrayContaining(['blinkit.com', 'www.jiomart.com', 'digital.dmart.in']));
    // Zepto/Instamart need the app's browser; BigBasket/Flipkart Minutes its cookie store.
    expect(hosts.filter((h) => /zepto|swiggy|bigbasket|rome\.api\.flipkart/.test(h))).toEqual([]);
  });
  it('skips quick-commerce sites without a location', async () => {
    kv.watch = JSON.stringify([item({ id: 'milk', query: 'amul taaza toned milk 500 ml', title: 'Amul Taaza' })]);
    await checkWatchlist();
    expect(fetched.some((u) => /blinkit|jiomart|dmart/.test(u))).toBe(false);
  });
  it('keeps items the user added while it was running', async () => {
    kv.watch = JSON.stringify([item()]);
    const run = checkWatchlist();
    kv.watch = JSON.stringify([item(), item({ id: 'new', query: 'y', lastChecked: Date.now() })]);
    await run;
    expect((JSON.parse(kv.watch) as WatchItem[]).map((x) => x.id)).toEqual(['lakme sunscreen spf 50', 'new']);
  });
});
