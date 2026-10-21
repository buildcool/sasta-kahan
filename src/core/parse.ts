import { dedupe, extractJsonBlobs, extractWithSelectors, findProducts } from './extract.ts';
import type { Listing, SiteConfig, SiteStatus } from './types.ts';

export interface SiteRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export function encodeQuery(site: SiteConfig, query: string): string {
  const q = query.trim().replace(/\s+/g, ' ');
  // Myntra-style sites put the query in the path: /lakme-sunscreen
  if (site.slugQuery) return encodeURIComponent(q.toLowerCase().replace(/ /g, '-'));
  return encodeURIComponent(q).replace(/%20/g, '+');
}

export function buildRequest(site: SiteConfig, query: string): SiteRequest {
  const r = site.request ?? {};
  const isApi = !!r.body || (r.headers?.Accept ?? '').includes('json');
  const qUrl = isApi ? encodeURIComponent(query.trim()) : encodeQuery(site, query);
  return {
    url: site.search.replace('{q}', qUrl),
    method: r.method ?? 'GET',
    headers: { ...r.headers },
    // JSON.stringify(...).slice(1, -1) escapes quotes so the query is safe inside the JSON body.
    body: r.body?.replace('{q}', JSON.stringify(query.trim()).slice(1, -1)),
  };
}

export function manualUrl(site: SiteConfig, query: string): string {
  return (site.manual ?? site.search).replace('{q}', encodeQuery(site, query));
}

export interface ParseResult {
  status: SiteStatus;
  listings: Listing[];
}

type HtmlParser = (html: string) => Document;

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
  return { status: listings.length ? 'ok' : 'empty', listings };
}
