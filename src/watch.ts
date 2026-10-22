import { runSearch } from './core/engine.ts';
import { makeReference } from './core/matcher.ts';
import type { SiteResult, Wallet } from './core/types.ts';
import { alertText } from './core/alerts.ts';
import { applyCheck, isStale, lowestExact, mergeItems, type WatchItem } from './core/watchLogic.ts';
import { notify } from './native.ts';
import { loadWatch, saveWatch } from './storage.ts';
import type { Lang } from './strings.ts';

/** Same as the background checker's interval: no point re-checking more often on app open. */
export const RECHECK_MS = 4 * 60 * 60 * 1000;

export async function addToWatch(item: Omit<WatchItem, 'id' | 'history' | 'lastChecked'>, results: SiteResult[]): Promise<WatchItem[]> {
  const items = await loadWatch();
  const id = (item.refTitle ?? item.query).toLowerCase();
  if (items.some((x) => x.id === id)) return items;
  items.unshift(applyCheck({ ...item, id, history: [], lastChecked: 0 }, lowestExact(results)).item);
  await saveWatch(items);
  return items;
}

export async function removeFromWatch(id: string): Promise<WatchItem[]> {
  const items = (await loadWatch()).filter((x) => x.id !== id);
  await saveWatch(items);
  return items;
}

/** Re-check one item; returns the updated list. Notifies on a drop, target or restock. */
export async function checkItem(item: WatchItem, wallet: Wallet, lang: Lang): Promise<WatchItem[]> {
  const results = await runSearch({
    query: item.query,
    ref: item.refTitle ? makeReference(item.refTitle, 'product') : undefined,
    wallet,
    onUpdate: () => {},
  });
  const { item: next, alert } = applyCheck(item, lowestExact(results));
  const items = mergeItems(await loadWatch(), [next]);
  await saveWatch(items);
  if (alert) {
    const { title, body } = alertText(alert, next, lang);
    await notify(title, body);
  }
  return items;
}

let running: Promise<WatchItem[]> | undefined;

/** Called when the app opens / resumes: refresh stale items one by one, one run at a time. */
export function checkStale(wallet: Wallet, lang: Lang): Promise<WatchItem[]> {
  running ??= (async () => {
    try {
      let items = await loadWatch();
      for (const it of items.filter((x) => isStale(x, RECHECK_MS)).slice(0, 5)) {
        items = await checkItem(it, wallet, lang);
      }
      return items;
    } finally {
      running = undefined;
    }
  })();
  return running;
}
