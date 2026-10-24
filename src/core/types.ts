export type Category = 'beauty' | 'fashion' | 'electronics' | 'grocery' | 'home' | 'general';

/** A price you get by applying a public coupon on the site (no card needed). */
export interface Coupon {
  price: number;
  text: string;
  code?: string;
}

/** One product row found on a site's search page. */
export interface Listing {
  site: string;
  title: string;
  price: number;
  mrp?: number;
  url: string;
  image?: string;
  rating?: number;
  /** Number of ratings, when the site shows it. */
  ratingCount?: number;
  sponsored?: boolean;
  /** undefined = the site didn't say. */
  inStock?: boolean;
  coupon?: Coupon;
  /** Delivery time the site promises, e.g. "10 min" (quick-commerce sites). */
  eta?: string;
}

/** Delivery / platform fees a site adds at checkout (config/sites.json, approximate). */
export interface SiteFees {
  /** Delivery charge on orders below `freeAbove`. */
  delivery?: number;
  freeAbove?: number;
  /** Charged on every order. */
  platform?: number;
  /** Membership ids (config/offers.json) that get free delivery. */
  freeWith?: string[];
  note?: string;
  verified?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT';

/**
 * A request template. `{q}` is the query; `{lat}` `{lng}` `{pincode}` `{area}` `{city}` `{state}`
 * come from the user's delivery location; `{uuid}` is a fresh random id; setup steps can add more.
 */
export interface RequestTemplate {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * One request a site needs before searching, e.g. telling it the delivery location or
 * looking up the store for a pincode. Runs once per location (cached for a few hours).
 */
export interface SetupStep extends RequestTemplate {
  url: string;
  /** Values to keep for later requests: a JSON path into the response, or "cookie:NAME". */
  save?: Record<string, string>;
  /** "path" (truthy) or "path=value" that must hold, or the site doesn't deliver to this location. */
  require?: string;
}

/** Reading a site in a hidden in-app browser (Android only), for sites that only answer real browsers. */
export interface BrowserConfig {
  /** Page to open (template). Defaults to `manual`. */
  page?: string;
  /** Cookies to set first, e.g. the delivery location. `encode` URL-encodes the filled value. */
  cookies?: { url: string; name: string; value: string; domain?: string; encode?: boolean }[];
  /** Keep the page's own responses whose URL matches this regular expression. */
  capture?: string;
  /** Instead of capturing, run the site's search `request` inside the opened page. */
  run?: boolean;
  /** Use the browser only when the normal request is blocked. */
  fallback?: boolean;
  timeoutMs?: number;
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
  request?: RequestTemplate;
  /** Quick-commerce store (delivery in minutes from a nearby dark store). */
  quick?: boolean;
  /** Typical delivery time to show when the search results don't say, e.g. "10 min". */
  eta?: string;
  /** The site's prices depend on where you are: it needs the user's coordinates, pincode or both. */
  location?: 'latlng' | 'pincode' | 'both';
  /** Requests to make before searching (location, store lookup). */
  setup?: SetupStep[];
  /** Hours a setup stays valid (default 6). */
  setupHours?: number;
  /** Requests rely on cookies from earlier requests (the app's cookie store), so it can't be checked without one. */
  session?: boolean;
  browser?: BrowserConfig;
  /** Which categories this site is worth querying for. */
  categories: Category[];
  /** false → never fetched, only shown as a "Check manually" link. */
  fetch?: boolean;
  /** false → don't open product pages for bank offers (site has none / blocks quickly). */
  productOffers?: boolean;
  /** Android package of the site's app, for "Open in app". */
  app?: string;
  fees?: SiteFees;
  /** Overrides for the generic JSON walker. */
  json?: {
    name?: string[];
    price?: string[];
    mrp?: string[];
    url?: string[];
    image?: string[];
    rating?: string[];
    ratingCount?: string[];
    brand?: string[];
    /** Price after the site's coupon: a number, or text like "Best Price ₹348 with coupon". */
    coupon?: string[];
    /** Fields appended to the title, e.g. a separate "30 g" subtitle. */
    extra?: string[];
    /** Build the product URL from fields, e.g. "/p/{productMeta.productId}"; "{^x}" reads x from the parent object. */
    urlTemplate?: string;
    /** Multiply prices by this, e.g. 0.01 for prices in paise. */
    priceScale?: number;
    /** Stock rules: "path" (a count or flag; 0/false = out of stock) or "path=value" (in stock only when equal). */
    stock?: string[];
    /** Delivery time text, e.g. "10 mins". */
    eta?: string[];
    /** Delivery time in seconds. */
    etaSeconds?: string[];
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
    ratingCount?: string;
  };
  /** Text that means we got a captcha / bot wall instead of results. */
  blockedMarkers?: string[];
  /**
   * Text the site shows when a search really has no results. When set, a page
   * with no products and none of these markers is treated as a failed check
   * (e.g. Amazon sometimes answers busy periods with an empty page).
   */
  emptyMarkers?: string[];
  /** Searches for this site that use the query's words in the URL path. */
  slugQuery?: boolean;
}

/**
 * ok       — found the product
 * nomatch  — site returned products, none is this product
 * empty    — site says there are no results
 * blocked  — captcha / bot wall / too many requests
 * error    — network error or unreadable page
 * manual   — we don't fetch this site; "check yourself" link only
 */
export type SiteStatus = 'ok' | 'nomatch' | 'empty' | 'blocked' | 'error' | 'manual' | 'loading';

export interface SiteResult {
  site: SiteConfig;
  status: SiteStatus;
  listings: ScoredListing[];
  /** Best listing on this site for the query (after matching). */
  best?: ScoredListing;
  /** Bank / card offers found for `best` (product page + offers.json). */
  offers?: Offer[];
  /** Price is far below the other sites — probably an accessory or a different pack. */
  outlier?: boolean;
  error?: string;
  /** When the site was actually fetched (cached results keep their original time). */
  checkedAt?: number;
  manualUrl: string;
}

export interface Quantity {
  value: number;
  /** Normalised unit: ml, g, gb, tb, pcs */
  unit: 'ml' | 'g' | 'gb' | 'tb' | 'pcs';
  pack: number;
}

export type MatchLabel = 'exact' | 'similar' | 'size' | 'different';

/** Why a listing got its label — shown to the user as "Why this match". */
export interface MatchWhy {
  /** Words of the search found in the listing title. */
  found: string[];
  /** Words of the search missing from the listing title. */
  missing: string[];
  size: 'same' | 'different' | 'unknown' | 'none';
  /** A variant word the search doesn't have ("pro", "lite", "plus"…). */
  variant?: string;
  /** The listing is an accessory for the product (case, cable, protector…). */
  accessory?: boolean;
}

export interface ScoredListing extends Listing {
  score: number;
  match: MatchLabel;
  why?: MatchWhy;
  qty?: Quantity;
  /** ₹ per 100ml / 100g / unit, when quantity known. */
  unitPrice?: { value: number; per: string };
  effective?: EffectivePrice;
}

export type OfferKind = 'percent' | 'flat' | 'emi';
export type CardType = 'credit' | 'debit' | 'any';

export interface Offer {
  site: string;
  /**
   * Lowercase bank id (hdfc, icici, sbi, axis ...), "upi" (any UPI app),
   * "wallet" (one specific payment app, see `app`), "rupay" (RuPay credit card on UPI)
   * or "coupon" (site coupon, anyone can use).
   */
  bank: string;
  cardType: CardType;
  /** Specific card name when the offer is card-specific (e.g. "amazon-pay-icici"). */
  card?: string;
  /** Payment app id for bank === 'wallet' (cred, paytm, phonepe, jupiter…). */
  app?: string;
  kind: OfferKind;
  /** Paid back later (statement credit / balance) rather than an instant discount. */
  cashback?: boolean;
  /** Paid as reward points / coins whose rupee value isn't fixed — not counted in prices. */
  points?: boolean;
  /** "Up to ₹300 cashback": the actual amount may be less — not counted in prices. */
  upTo?: boolean;
  /** Only for first order / new users of the site or app. */
  newUser?: boolean;
  /** Membership needed (prime, flipkart-vip, myntra-insider …). */
  requires?: string;
  /** Percent (10 = 10%) or rupees for flat. */
  value: number;
  cap?: number;
  minOrder?: number;
  emiOnly?: boolean;
  text: string;
  source: 'page' | 'config';
  /** Date (YYYY-MM-DD) someone last checked a config offer against the bank's terms. */
  verified?: string;
}

export interface UserCard {
  bank: string;
  type: 'credit' | 'debit';
  /** Optional co-branded card id from offers.json (e.g. "amazon-pay-icici"). */
  card?: string;
}

/** Everything about the user that decides which offers they can use. Stays on the phone. */
export interface Wallet {
  cards: UserCard[];
  /** Payment apps the user has (cred, paytm, phonepe, gpay, jupiter …) and "rupay" for RuPay credit card on UPI. */
  apps: string[];
  /** prime, flipkart-vip, flipkart-plus, myntra-insider, nykaa-prive … */
  memberships: string[];
  /** Count first-order / new-user offers. */
  newUser: boolean;
}

export interface EffectivePrice {
  price: number;
  /** Price after the site's coupon (= price when there's no coupon). */
  base: number;
  coupon?: Coupon;
  /** Approximate delivery + platform fees at this price. */
  fees: number;
  /** Final price with the best of the user's cards, coupon and fees included. */
  mine: number;
  mineOffer?: Offer;
  /** Part of `price - mine` that comes back later (cashback) rather than off the bill. */
  mineLater: number;
  /** Best price with any card at all. */
  any: number;
  anyOffer?: Offer;
}
