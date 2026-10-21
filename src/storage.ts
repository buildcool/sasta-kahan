import { Preferences } from '@capacitor/preferences';
import type { UserCard } from './core/types.ts';

// Everything is stored on the phone only — no account, no server.

async function get<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function set(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) });
}

export const loadCards = () => get<UserCard[]>('cards', []);
export const saveCards = (cards: UserCard[]) => set('cards', cards);

export const loadRecent = () => get<string[]>('recent', []);
export async function addRecent(q: string): Promise<string[]> {
  const list = [q, ...(await loadRecent()).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12);
  await set('recent', list);
  return list;
}

export interface PricePoint {
  t: number;
  /** Lowest price found across all sites at that time. */
  price: number;
  site: string;
}

export interface WatchItem {
  id: string;
  /** Text to search again. */
  query: string;
  /** Full product title used for matching (product mode), if any. */
  refTitle?: string;
  title: string;
  image?: string;
  /** Notify when lowest price goes at or below this. Defaults to "any drop". */
  target?: number;
  history: PricePoint[];
  lastChecked: number;
}

export const loadWatch = () => get<WatchItem[]>('watch', []);
export const saveWatch = (items: WatchItem[]) => set('watch', items);

export async function addPricePoint(id: string, p: PricePoint): Promise<WatchItem[]> {
  const items = await loadWatch();
  const it = items.find((x) => x.id === id);
  if (it) {
    const last = it.history.at(-1);
    // One point per day is enough for a chart; replace same-day points.
    if (last && new Date(last.t).toDateString() === new Date(p.t).toDateString()) it.history[it.history.length - 1] = p;
    else it.history.push(p);
    it.history = it.history.slice(-90);
    it.lastChecked = p.t;
    await saveWatch(items);
  }
  return items;
}
