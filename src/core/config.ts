import bundledSites from '../../config/sites.json';
import bundledOffers from '../../config/offers.json';
import { fetchText } from './fetcher.ts';
import type { Offer, SiteConfig } from './types.ts';

/**
 * Site selectors and card offers live in config/*.json in the GitHub repo.
 * The app downloads the latest copy through jsDelivr (free CDN), so a broken
 * site can be fixed by editing JSON on GitHub — no new APK needed.
 * Set VITE_CONFIG_REPO=<github-user>/sasta-kahan at build time to enable.
 */
const REPO = import.meta.env.VITE_CONFIG_REPO as string | undefined;
const CDN = REPO ? `https://cdn.jsdelivr.net/gh/${REPO}@main/config` : undefined;
const CACHE_KEY = 'sk.remoteConfig';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface AppConfig {
  sites: SiteConfig[];
  offers: Offer[];
}

interface Cached extends AppConfig {
  at: number;
  sitesVersion: number;
  offersVersion: number;
}

const toOffers = (raw: typeof bundledOffers): Offer[] =>
  raw.offers.map((o) => ({ ...o, source: 'config' }) as Offer);

const bundled = (): Cached => ({
  at: 0,
  sites: bundledSites.sites as SiteConfig[],
  offers: toOffers(bundledOffers),
  sitesVersion: bundledSites.version,
  offersVersion: bundledOffers.version,
});

function readCache(): Cached | undefined {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cached | null;
    return c ?? undefined;
  } catch {
    return undefined;
  }
}

let current: Cached | undefined;

export function getConfig(): AppConfig {
  if (!current) {
    const cached = readCache();
    const b = bundled();
    // Never let an old cached copy override a newer bundled one.
    current = cached && cached.sitesVersion >= b.sitesVersion && cached.offersVersion >= b.offersVersion ? cached : b;
  }
  return current;
}

/** Refresh from GitHub in the background; failures just keep the current copy. */
export async function refreshConfig(force = false): Promise<void> {
  const now = getConfig() as Cached;
  if (!CDN || (!force && Date.now() - now.at < MAX_AGE_MS)) return;
  try {
    const [s, o] = await Promise.all([
      fetchText({ url: `${CDN}/sites.json`, method: 'GET', headers: {} }),
      fetchText({ url: `${CDN}/offers.json`, method: 'GET', headers: {} }),
    ]);
    if (s.status !== 200 || o.status !== 200) return;
    const sites = JSON.parse(s.body) as typeof bundledSites;
    const offers = JSON.parse(o.body) as typeof bundledOffers;
    if (!Array.isArray(sites.sites) || !Array.isArray(offers.offers)) return;
    current = {
      at: Date.now(),
      sites: sites.sites as SiteConfig[],
      offers: toOffers(offers),
      sitesVersion: sites.version,
      offersVersion: offers.version,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(current));
  } catch {
    // offline / CDN down — keep using what we have
  }
}
