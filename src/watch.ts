import { runSearch } from './core/engine.ts';
import { makeReference } from './core/matcher.ts';
import type { SiteResult, UserCard } from './core/types.ts';
import { notify } from './native.ts';
import { addPricePoint, loadWatch, saveWatch, type WatchItem } from './storage.ts';
import { rupees } from './ui/format.ts';

const RECHECK_MS = 6 * 60 * 60 * 1000;

export function lowest(results: SiteResult[]): { price: number; site: string } | undefined {
  let best: { price: number; site: string } | undefined;
  for (const r of results) {
    // Only count real matches — "similar" items could be a different variant.
    if (!r.best || r.best.match !== 'exact') continue;
    const p = r.best.effective?.mine ?? r.best.price;
    if (!best || p < best.price) best = { price: p, site: r.site.name };
  }
  return best;
}

export async function addToWatch(item: Omit<WatchItem, 'id' | 'history' | 'lastChecked'>, results: SiteResult[]): Promise<WatchItem[]> {
  const items = await loadWatch();
  const id = (item.refTitle ?? item.query).toLowerCase();
  if (!items.some((x) => x.id === id)) {
    const low = lowest(results);
    items.unshift({ ...item, id, history: low ? [{ t: Date.now(), ...low }] : [], lastChecked: Date.now() });
    await saveWatch(items);
  }
  return items;
}

export async function removeFromWatch(id: string): Promise<WatchItem[]> {
  const items = (await loadWatch()).filter((x) => x.id !== id);
  await saveWatch(items);
  return items;
}

/** Re-check one item; returns the updated list. Notifies on a price drop. */
export async function checkItem(item: WatchItem, cards: UserCard[]): Promise<WatchItem[]> {
  const results = await runSearch({
    query: item.query,
    ref: item.refTitle ? makeReference(item.refTitle, 'product') : undefined,
    cards,
    onUpdate: () => {},
  });
  const low = lowest(results);
  if (!low) return loadWatch();
  const before = Math.min(...item.history.map((h) => h.price));
  const items = await addPricePoint(item.id, { t: Date.now(), ...low });
  const hitTarget = item.target && low.price <= item.target;
  if ((Number.isFinite(before) && low.price < before * 0.99) || hitTarget) {
    await notify(`Price drop: ${item.title.slice(0, 40)}`, `Now ${rupees(low.price)} on ${low.site}${Number.isFinite(before) ? ` (was ${rupees(before)})` : ''}`);
  }
  return items;
}

/** Called when the app opens / resumes: refresh stale watch items one by one. */
export async function checkStale(cards: UserCard[]): Promise<WatchItem[]> {
  let items = await loadWatch();
  for (const it of items.filter((x) => Date.now() - x.lastChecked > RECHECK_MS).slice(0, 5)) {
    items = await checkItem(it, cards);
  }
  return items;
}
