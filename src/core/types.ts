export type Category = 'beauty' | 'fashion' | 'electronics' | 'grocery' | 'home' | 'general';

/** One product row found on a site's search page. */
export interface Listing {
  site: string;
  title: string;
  price: number;
  mrp?: number;
  url: string;
  image?: string;
  rating?: number;
  sponsored?: boolean;
}

/** Remote-updatable description of how to read a site (config/sites.json). */
export interface SiteConfig {
  id: string;
  name: string;
  base: string;
  /** Search page URL, `{q}` is replaced with the encoded query. */
  search: string;
  /** What we open for "Check manually"; defaults to `search`. */
  manual?: string;
  /** For JSON APIs: method, headers and a body template (`{q}` = query). */
  request?: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  };
  /** Which categories this site is worth querying for. */
  categories: Category[];
  /** false → never fetched, only shown as a "Check manually" link. */
  fetch?: boolean;
  /** Overrides for the generic JSON walker. */
  json?: {
    name?: string[];
    price?: string[];
    mrp?: string[];
    url?: string[];
    image?: string[];
    rating?: string[];
    brand?: string[];
    /** Fields appended to the title, e.g. a separate "30 g" subtitle. */
    extra?: string[];
    /** Build the product URL from fields, e.g. "/p/{productMeta.productId}". */
    urlTemplate?: string;
  };
  /** CSS selectors for HTML-only result pages. */
  selectors?: {
    item: string;
    title: string;
    titleAttr?: string;
    /** Some layouts show the brand in a separate element from the title. */
    brand?: string;
    price: string;
    mrp?: string;
    link?: string;
    idAttr?: string;
    urlTemplate?: string;
    image?: string;
    rating?: string;
  };
  /** Text that means we got a captcha / bot wall instead of results. */
  blockedMarkers?: string[];
  /** Searches for this site that use the query's words in the URL path. */
  slugQuery?: boolean;
}

export type SiteStatus = 'ok' | 'empty' | 'blocked' | 'error' | 'manual' | 'loading';

export interface SiteResult {
  site: SiteConfig;
  status: SiteStatus;
  listings: ScoredListing[];
  /** Best listing on this site for the query (after matching). */
  best?: ScoredListing;
  /** Bank / card offers found for `best` (product page + offers.json). */
  offers?: Offer[];
  error?: string;
  manualUrl: string;
}

export interface Quantity {
  value: number;
  /** Normalised unit: ml, g, gb, tb, pcs */
  unit: 'ml' | 'g' | 'gb' | 'tb' | 'pcs';
  pack: number;
}

export type MatchLabel = 'exact' | 'similar' | 'size' | 'different';

export interface ScoredListing extends Listing {
  score: number;
  match: MatchLabel;
  qty?: Quantity;
  /** ₹ per 100ml / 100g / unit, when quantity known. */
  unitPrice?: { value: number; per: string };
  effective?: EffectivePrice;
}

export type OfferKind = 'percent' | 'flat' | 'emi';
export type CardType = 'credit' | 'debit' | 'any';

export interface Offer {
  site: string;
  /** Lowercase bank id (hdfc, icici, sbi, axis ...), "upi" (any UPI app) or "wallet" (one specific app). */
  bank: string;
  cardType: CardType;
  /** Specific card name when the offer is card-specific (e.g. "amazon pay icici"). */
  card?: string;
  kind: OfferKind;
  /** Paid back later (statement credit / reward points) rather than an instant discount. */
  cashback?: boolean;
  /** Percent (10 = 10%) or rupees for flat. */
  value: number;
  cap?: number;
  minOrder?: number;
  emiOnly?: boolean;
  text: string;
  source: 'page' | 'config';
}

export interface UserCard {
  bank: string;
  type: 'credit' | 'debit';
  /** Optional co-branded card id from offers.json (e.g. "amazon-pay-icici"). */
  card?: string;
}

export interface EffectivePrice {
  price: number;
  /** Final price with the best of the user's cards. */
  mine: number;
  mineOffer?: Offer;
  /** Best price with any card at all. */
  any: number;
  anyOffer?: Offer;
}
