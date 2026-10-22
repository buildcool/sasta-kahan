import bundledSites from '../../config/sites.json' with { type: 'json' };
import bundledOffers from '../../config/offers.json' with { type: 'json' };
import type { Offer, SiteConfig } from './types.ts';

// Pure config handling, shared by the app and the background price checker.

export type SitesFile = { version: number; updated?: string; sites: unknown[] };
export type OffersFile = { version: number; updated?: string; offers: unknown[]; memberships?: unknown[] };

export interface Membership {
  id: string;
  name: string;
  site: string;
}

export interface AppConfig {
  sites: SiteConfig[];
  offers: Offer[];
  memberships: Membership[];
  sitesVersion: number;
  offersVersion: number;
  /** Date of the offers file (offers.json "updated"). */
  offersUpdated?: string;
}

/** Remote copy saved on the phone. */
export interface CachedConfig {
  at: number;
  sites?: SitesFile;
  offers?: OffersFile;
}

export const CONFIG_KEY = 'sk.remoteConfig';

export const isSitesFile = (v: unknown): v is SitesFile => !!v && typeof v === 'object' && Array.isArray((v as SitesFile).sites) && typeof (v as SitesFile).version === 'number';
export const isOffersFile = (v: unknown): v is OffersFile => !!v && typeof v === 'object' && Array.isArray((v as OffersFile).offers) && typeof (v as OffersFile).version === 'number';

/** Each file separately: the downloaded copy wins only when it's newer than the one inside the APK. */
export function chooseConfig(cached?: CachedConfig | null): AppConfig {
  const sites = cached?.sites && isSitesFile(cached.sites) && cached.sites.version > bundledSites.version ? cached.sites : bundledSites;
  const offers = cached?.offers && isOffersFile(cached.offers) && cached.offers.version > bundledOffers.version ? cached.offers : (bundledOffers as OffersFile);
  return {
    sites: sites.sites as SiteConfig[],
    offers: offers.offers.map((o) => ({ ...(o as Offer), source: 'config' as const })),
    memberships: (offers.memberships ?? []) as Membership[],
    sitesVersion: sites.version,
    offersVersion: offers.version,
    offersUpdated: offers.updated,
  };
}
