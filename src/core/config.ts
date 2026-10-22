import { Preferences } from '@capacitor/preferences';
import { CONFIG_KEY, chooseConfig, isOffersFile, isSitesFile, type AppConfig, type CachedConfig } from './configData.ts';
import { fetchText } from './fetcher.ts';

export type { AppConfig, Membership } from './configData.ts';

/**
 * Site selectors and card offers live in config/*.json in the GitHub repo.
 * The app downloads the latest copy through jsDelivr (free CDN), so a broken
 * site can be fixed by editing JSON on GitHub — no new APK needed.
 * Set VITE_CONFIG_REPO=<github-user>/sasta-kahan at build time to enable.
 */
const REPO = import.meta.env.VITE_CONFIG_REPO as string | undefined;
const CDN = REPO ? `https://cdn.jsdelivr.net/gh/${REPO}@main/config` : undefined;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function readCache(): CachedConfig | undefined {
  try {
    return (JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as CachedConfig | null) ?? undefined;
  } catch {
    return undefined;
  }
}

let cached: CachedConfig | undefined;
let current: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (!current) {
    cached = readCache();
    current = chooseConfig(cached);
  }
  return current;
}

/** Refresh from GitHub in the background; failures just keep the current copy. */
export async function refreshConfig(force = false): Promise<void> {
  getConfig();
  if (!CDN || (!force && Date.now() - (cached?.at ?? 0) < MAX_AGE_MS)) return;
  try {
    const [s, o] = await Promise.all([
      fetchText({ url: `${CDN}/sites.json`, method: 'GET', headers: {} }),
      fetchText({ url: `${CDN}/offers.json`, method: 'GET', headers: {} }),
    ]);
    if (s.status !== 200 || o.status !== 200) return;
    const sites: unknown = JSON.parse(s.body);
    const offers: unknown = JSON.parse(o.body);
    if (!isSitesFile(sites) || !isOffersFile(offers)) return;
    cached = { at: Date.now(), sites, offers };
    current = chooseConfig(cached);
    const json = JSON.stringify(cached);
    localStorage.setItem(CONFIG_KEY, json);
    // The background price checker can't read localStorage; it reads the same key from Preferences.
    await Preferences.set({ key: CONFIG_KEY, value: json });
  } catch {
    // offline / CDN down — keep using what we have
  }
}
