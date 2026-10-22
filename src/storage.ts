import { Preferences } from '@capacitor/preferences';
import { EMPTY_WALLET } from './core/effectivePrice.ts';
import type { UserCard, Wallet } from './core/types.ts';
import type { PricePoint, WatchItem } from './core/watchLogic.ts';
import type { Lang } from './strings.ts';

export type { PricePoint, WatchItem };

// Everything is stored on the phone only — no account, no server.
// The background price checker reads the same keys ("watch", "settings", "wallet").

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

export async function loadWallet(): Promise<Wallet> {
  const w = await get<Partial<Wallet> | null>('wallet', null);
  if (w) return { ...EMPTY_WALLET, ...w };
  // Before 1.1 only cards were saved.
  return { ...EMPTY_WALLET, cards: await get<UserCard[]>('cards', []) };
}
export const saveWallet = (w: Wallet) => set('wallet', w);

/** A recent search, enough to run it again the same way (typed words, or one exact product). */
export interface Recent {
  query: string;
  label: string;
  /** Full product title for "same product" matching. */
  refTitle?: string;
}

export async function loadRecent(): Promise<Recent[]> {
  const list = await get<(Recent | string)[]>('recent', []);
  return list.map((r) => (typeof r === 'string' ? { query: r, label: r } : r));
}

export async function addRecent(r: Recent): Promise<Recent[]> {
  const same = (x: Recent) => (x.refTitle ?? x.query).toLowerCase() === (r.refTitle ?? r.query).toLowerCase();
  const list = [r, ...(await loadRecent()).filter((x) => !same(x))].slice(0, 12);
  await set('recent', list);
  return list;
}

export async function clearRecent(): Promise<Recent[]> {
  await set('recent', []);
  return [];
}

export interface Settings {
  lang?: Lang;
  /** Check the watchlist in the background (default on). */
  background: boolean;
  /** Offer to compare a shopping link found on the clipboard (default on). */
  clipboard: boolean;
  /** Amazon search suggestions while typing (default on). */
  suggestions: boolean;
  /** Last clipboard text we offered, so we don't ask twice. */
  lastClip?: string;
  /** Sites the user logged into inside the app (beta). */
  logins?: string[];
}

export const DEFAULT_SETTINGS: Settings = { background: true, clipboard: true, suggestions: true };

export const loadSettings = async (): Promise<Settings> => ({ ...DEFAULT_SETTINGS, ...(await get<Partial<Settings>>('settings', {})) });
export const saveSettings = (s: Settings) => set('settings', s);

export const loadWatch = () => get<WatchItem[]>('watch', []);
export const saveWatch = (items: WatchItem[]) => set('watch', items);

export async function updateWatchItem(id: string, patch: Partial<WatchItem>): Promise<WatchItem[]> {
  const items = (await loadWatch()).map((x) => (x.id === id ? { ...x, ...patch } : x));
  await saveWatch(items);
  return items;
}

/** Everything worth keeping, as text the user can save anywhere (WhatsApp to self, Drive, notes). */
export async function exportBackup(): Promise<string> {
  const [wallet, watch, recent, settings] = await Promise.all([loadWallet(), loadWatch(), loadRecent(), loadSettings()]);
  const { lastClip: _drop, ...keep } = settings;
  void _drop;
  return JSON.stringify({ app: 'sastakahan', v: 1, at: new Date().toISOString(), wallet, watch, recent, settings: keep });
}

/** Restore a backup; returns how many watch items it had, or throws on anything that isn't ours. */
export async function importBackup(text: string): Promise<number> {
  const start = text.indexOf('{');
  const data = JSON.parse(start >= 0 ? text.slice(start) : text) as {
    app?: string;
    wallet?: Wallet;
    watch?: WatchItem[];
    recent?: Recent[];
    settings?: Partial<Settings>;
  };
  if (data.app !== 'sastakahan' || !Array.isArray(data.watch)) throw new Error('bad-backup');
  const current = await loadWatch();
  const ids = new Set(current.map((x) => x.id));
  await saveWatch([...current, ...data.watch.filter((x) => x && typeof x.id === 'string' && !ids.has(x.id))]);
  if (data.wallet) await saveWallet({ ...EMPTY_WALLET, ...data.wallet });
  if (Array.isArray(data.recent)) await set('recent', data.recent);
  if (data.settings) await saveSettings({ ...(await loadSettings()), ...data.settings });
  return data.watch.length;
}
