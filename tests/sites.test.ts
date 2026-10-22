import { describe, expect, it } from 'vitest';
import { buildRequest, manualUrl, parseResponse } from '../src/core/parse.ts';
import { fixture, parseHtml, site } from './helpers.ts';

// Saved real search pages. If a site changes its layout, re-save the fixture
// (npm run live) and fix config/sites.json until these pass again.
const cases: [id: string, expectWord: RegExp, min: number][] = [
  ['amazon', /lakme/i, 10],
  ['flipkart', /sunscreen/i, 10],
  ['nykaa', /lakme/i, 10],
  ['myntra', /lakme/i, 10],
  ['meesho', /lakme/i, 10],
  ['ajio', /lakme/i, 10],
  ['tatacliq', /lakme/i, 2],
  ['reliance', /boat|airdopes/i, 10],
  ['croma', /boat|airdopes/i, 10],
];

describe.each(cases)('%s search page', (id, word, min) => {
  const { status, listings } = parseResponse(site(id), fixture(`search-${id}`), parseHtml);

  it('finds listings', () => {
    expect(status).toBe('ok');
    expect(listings.length).toBeGreaterThanOrEqual(min);
  });

  it('listings have sane fields', () => {
    const relevant = listings.filter((l) => word.test(l.title));
    expect(relevant.length).toBeGreaterThanOrEqual(Math.min(min, 2));
    for (const l of relevant) {
      expect(l.price).toBeGreaterThan(0);
      expect(l.url).toMatch(new RegExp(`^${site(id).base.replace(/\./g, '\\.')}/`));
      if (l.mrp) expect(l.mrp).toBeGreaterThanOrEqual(l.price);
    }
  });
});

describe('amazon specifics', () => {
  const { listings } = parseResponse(site('amazon'), fixture('search-amazon'), parseHtml);
  it('strips the "Sponsored Ad" prefix', () => {
    expect(listings.some((l) => /^Sponsored/i.test(l.title))).toBe(false);
  });
  it('handles the layout where brand and title are separate headings', () => {
    const v2 = parseResponse(site('amazon'), fixture('search-amazon-v2'), parseHtml).listings;
    const l = v2.find((x) => x.price === 999 && /Airdopes 141/.test(x.title))!;
    expect(l.title).toMatch(/^boAt Airdopes 141/);
    expect(l.mrp).toBe(3999);
  });
  it('reads MRP separately from price', () => {
    const l = listings.find((x) => x.url.includes('B06WRQQXF5'))!;
    expect(l.price).toBe(217);
    expect(l.mrp).toBe(395);
  });
});

describe('requests', () => {
  it('puts myntra queries in the path', () => {
    expect(buildRequest(site('myntra'), 'Lakme Sunscreen').url).toBe('https://www.myntra.com/lakme-sunscreen');
  });
  it('escapes the query inside JSON bodies', () => {
    const r = buildRequest(site('meesho'), 'kurti "cotton"');
    expect(r.method).toBe('POST');
    expect(JSON.parse(r.body!).query).toBe('kurti "cotton"');
  });
  it('manual link opens the normal site search, not the API', () => {
    expect(manualUrl(site('croma'), 'boat airdopes')).toBe('https://www.croma.com/searchB?q=boat+airdopes');
  });
});

describe('blocked pages', () => {
  it('detects amazon captcha', () => {
    const r = parseResponse(site('amazon'), '<html>Enter the characters you see below</html>', parseHtml);
    expect(r.status).toBe('blocked');
  });
});

describe('coupon prices, stock and rating counts', () => {
  const parse = (id: string) => parseResponse(site(id), fixture(`search-${id}`), parseHtml).listings;

  it('Ajio: the price is the real price, offerPrice is the coupon price', () => {
    const l = parse('ajio').find((x) => x.url.includes('4900024890'))!;
    expect(l.price).toBe(331);
    expect(l.coupon?.price).toBe(298);
  });
  it('Myntra: "Best Price ₹348 with coupon"', () => {
    const l = parse('myntra').find((x) => x.coupon?.price === 348)!;
    expect(l.price).toBe(465);
    expect(l.coupon?.text).toBe('Best Price ₹348 with coupon');
  });
  it('Amazon: "Buy for ₹273 with coupon"', () => {
    expect(parse('amazon').some((x) => x.coupon?.price === 273)).toBe(true);
  });
  it('rating counts', () => {
    expect(parse('amazon').some((x) => x.ratingCount === 17974)).toBe(true);
    expect(parse('flipkart').some((x) => x.ratingCount === 34456)).toBe(true);
    expect(parse('myntra').some((x) => x.ratingCount === 12300)).toBe(true);
  });
  it('stock flags', () => {
    expect(parse('nykaa').every((x) => x.inStock === true)).toBe(true);
    expect(parse('tatacliq').some((x) => x.inStock === true)).toBe(true);
    expect(parse('reliance').some((x) => x.inStock === true)).toBe(true);
  });
});

describe('empty pages', () => {
  it('Amazon page with no products and no "No results" message is a failed check, not "not found"', () => {
    const r = parseResponse(site('amazon'), '<html><body><div id="search"></div></body></html>', parseHtml);
    expect(r).toMatchObject({ status: 'blocked', reason: 'empty-page' });
  });
  it('Amazon "No results for" is a real empty result', () => {
    const r = parseResponse(site('amazon'), '<html><body>No results for xyzzy.</body></html>', parseHtml);
    expect(r.status).toBe('empty');
  });
});
