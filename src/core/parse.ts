import { dedupe, extractJsonBlobs, extractWithSelectors, findProducts } from './extract.ts';
import type { HttpMethod, Listing, RequestTemplate, SiteConfig, SiteStatus } from './types.ts';

export interface SiteRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
}

/** Values for `{name}` placeholders in config/sites.json templates. */
export type Vars = Record<string, string>;

export function encodeQuery(site: SiteConfig, query: string): string {
  const q = query.trim().replace(/\s+/g, ' ');
  // Myntra-style sites put the query in the path: /lakme-sunscreen
  if (site.slugQuery) return encodeURIComponent(q.toLowerCase().replace(/ /g, '-'));
  return encodeURIComponent(q).replace(/%20/g, '+');
}

/** Random id for `{uuid}` (no crypto.randomUUID in the background checker's engine). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

/**
 * Fill `{name}` placeholders. Only names we have a value for are replaced, so JSON braces
 * in bodies are left alone. URLs get encoded values, JSON bodies escaped ones.
 */
export function fill(template: string, vars: Vars, mode: 'url' | 'json' | 'raw'): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => {
    if (k === 'uuid') return uuid();
    const v = vars[k];
    if (v === undefined) return all;
    if (mode === 'url') return encodeURIComponent(v);
    if (mode === 'json') return JSON.stringify(v).slice(1, -1);
    return v;
  });
}

/** A request from a template: the search, or a setup step. */
export function templateRequest(url: string, t: RequestTemplate, vars: Vars, qUrl?: string): SiteRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.headers ?? {})) headers[k] = fill(v, vars, 'raw');
  return {
    url: fill(qUrl === undefined ? url : url.replace(/\{q\}/g, qUrl), vars, 'url'),
    method: t.method ?? 'GET',
    headers,
    body: t.body === undefined ? undefined : fill(t.body, vars, 'json'),
  };
}

export function buildRequest(site: SiteConfig, query: string, vars: Vars = {}): SiteRequest {
  const r = site.request ?? {};
  const isApi = !!r.body || (r.headers?.Accept ?? '').includes('json');
  const q = query.trim();
  const qUrl = isApi ? encodeURIComponent(q) : encodeQuery(site, query);
  // {q} in a header (a Referer) is URL-encoded; in a JSON body it's escaped text; {qu} is URL-encoded anywhere.
  const req = templateRequest(site.search, { ...r, headers: undefined }, { ...vars, q, qu: encodeURIComponent(q) }, qUrl);
  for (const [k, v] of Object.entries(r.headers ?? {})) req.headers[k] = fill(v, { ...vars, q: encodeURIComponent(q), qu: encodeURIComponent(q) }, 'raw');
  return req;
}

export function manualUrl(site: SiteConfig, query: string): string {
  return (site.manual ?? site.search).replace(/\{q\}/g, encodeQuery(site, query));
}

export interface ParseResult {
  status: SiteStatus;
  listings: Listing[];
  /** Why a page counts as failed: 'empty-page' = no products and no "no results" message. */
  reason?: string;
}

export type HtmlParser = (html: string) => Document;

const defaultHtmlParser: HtmlParser = (html) => new DOMParser().parseFromString(html, 'text/html');

/** Turn a site's raw response body into listings. */
export function parseResponse(site: SiteConfig, body: string, parseHtml: HtmlParser = defaultHtmlParser): ParseResult {
  const trimmed = body.trimStart();
  if (site.blockedMarkers?.some((m) => body.includes(m))) return { status: 'blocked', listings: [] };

  let listings: Listing[] = [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      listings = findProducts(JSON.parse(trimmed), site);
    } catch {
      return { status: 'error', listings: [] };
    }
  } else {
    if (site.selectors) listings = extractWithSelectors(parseHtml(body), site);
    if (!listings.length) listings = extractJsonBlobs(body).flatMap((b) => findProducts(b, site));
  }
  listings = dedupe(listings);
  if (listings.length) return { status: 'ok', listings };
  // Some sites (Amazon) answer busy moments with a normal-looking page that has no products.
  // Only call it "no results" when the page says so.
  if (site.emptyMarkers?.length && !site.emptyMarkers.some((m) => body.includes(m))) return { status: 'blocked', listings, reason: 'empty-page' };
  return { status: 'empty', listings };
}
