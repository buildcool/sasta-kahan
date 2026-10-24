import { describe, expect, it } from 'vitest';
import { asLocation, hasNeed, locationKey, locationVars, stateFromPincode, type UserLocation } from '../src/core/location.ts';
import { makeReference } from '../src/core/matcher.ts';
import { buildRequest, parseResponse, type SiteRequest } from '../src/core/parse.ts';
import { canCheck, checkSiteWith, pageRequest, readPageResult, readSearch, runSetup, type FetchResult, type Net } from '../src/core/search.ts';
import { fixture, site } from './helpers.ts';

const BLR: UserLocation = { lat: 12.9352, lng: 77.6245, pincode: '560034', area: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', label: 'Koramangala, Bengaluru 560034', source: 'pincode' };
const vars = locationVars(BLR);
const milk = makeReference('amul taaza toned milk 500 ml', 'query');

/** A fake network: answers by URL, remembers every request. */
function fakeNet(answer: (req: SiteRequest) => FetchResult | undefined, cookies?: Record<string, string>): Net & { sent: SiteRequest[] } {
  const sent: SiteRequest[] = [];
  return {
    sent,
    fetch: async (req) => {
      sent.push(req);
      return answer(req) ?? { status: 404, body: '' };
    },
    cookies: cookies && (async () => cookies),
  };
}

// Real search responses saved from the phone on 2026-10-24 (trimmed). Re-save with `npm run live` when a site changes.
describe('quick-commerce search responses', () => {
  it('Blinkit: name, pack size, price and stock from the add-to-cart data', () => {
    const { status, listings } = parseResponse(site('blinkit'), fixture('search-blinkit'));
    expect(status).toBe('ok');
    expect(listings).toHaveLength(6);
    expect(listings.find((l) => l.url.endsWith('/prid/19512'))).toMatchObject({
      title: 'Amul Taaza Toned Milk, 500 ml',
      price: 29,
      inStock: true,
      url: 'https://blinkit.com/prn/x/prid/19512',
    });
    expect(listings.find((l) => /Country Delight Buffalo/.test(l.title))).toMatchObject({ price: 52, mrp: 62 });
  });

  it('BigBasket (BB Now): brand, pack size, delivery time and stock', () => {
    const { listings } = parseResponse(site('bigbasket'), fixture('search-bigbasket'));
    expect(listings.length).toBeGreaterThanOrEqual(6);
    expect(listings[0]).toMatchObject({
      title: 'Amul Taaza Homogenised Toned Milk, 1 L',
      price: 73,
      mrp: 77,
      eta: '10 min',
      inStock: true,
      url: 'https://www.bigbasket.com/pd/306926/amul-homogenised-toned-milk-1-l-carton/',
    });
  });

  it('BigBasket prices follow the delivery location (Mumbai store)', () => {
    const blr = parseResponse(site('bigbasket'), fixture('search-bigbasket')).listings.find((l) => l.url.includes('/40090894/'));
    const mum = parseResponse(site('bigbasket'), fixture('search-bigbasket-mumbai')).listings.find((l) => l.url.includes('/40090894/'));
    expect(blr?.price).toBe(27);
    expect(mum?.price).toBe(30);
    expect(mum?.eta).toBe('7 min');
  });

  it('Flipkart Minutes: price, MRP and delivery time in seconds', () => {
    const { listings } = parseResponse(site('fkminutes'), fixture('search-fkminutes'));
    expect(listings).toHaveLength(6);
    const taaza = listings.find((l) => l.url.includes('pid=MLKHFR86BF77KGXZ'))!;
    expect(taaza).toMatchObject({ title: 'Amul Taaza Toned Milk, 500 ml', price: 27, mrp: 29, eta: '12 min', inStock: true });
    expect(taaza.url).toBe('https://www.flipkart.com/amul-taaza-toned-milk/p/itm8a494bf913753?pid=MLKHFR86BF77KGXZ');
    expect(taaza.image).toMatch(/^https:\/\/rukminim1\.flixcart\.com\/image\/312\/312\//);
  });

  it('JioMart', () => {
    const { listings } = parseResponse(site('jiomart'), fixture('search-jiomart'));
    expect(listings).toHaveLength(6);
    expect(listings[0]).toMatchObject({
      title: 'Amul Moti Toned Milk 450 ml',
      price: 28,
      mrp: 30,
      url: 'https://www.jiomart.com/product/amul-moti-toned-milk-450-ml-mffmxm-7515564',
    });
  });

  it('DMart Ready: SKU prices, and the product link from the parent product', () => {
    const { listings } = parseResponse(site('dmart'), fixture('search-dmart'));
    expect(listings[0]).toMatchObject({
      title: 'Amul Taaza Toned Milk : 1 L',
      price: 73,
      mrp: 77,
      inStock: true,
      url: 'https://www.dmart.in/product/amul-taaza-toned-milk?selectedProd=11866',
    });
  });

  it('finds the same product on Blinkit and Flipkart Minutes', () => {
    for (const id of ['blinkit', 'fkminutes']) {
      const check = readSearch(site(id), { status: 200, body: fixture(`search-${id}`) }, milk);
      expect(check.best?.match, id).toBe('exact');
      expect(check.best?.title, id).toMatch(/Taaza Toned Milk, 500 ml/);
    }
  });
});

describe('location templates', () => {
  it('Blinkit sends the coordinates as headers', () => {
    const req = buildRequest(site('blinkit'), 'amul milk', vars);
    expect(req).toMatchObject({ url: 'https://blinkit.com/v1/layout/search?q=amul%20milk&start=0&size=20', method: 'POST', body: '{}' });
    expect(req.headers).toMatchObject({ lat: '12.9352', lon: '77.6245', Referer: 'https://blinkit.com/s/?q=amul%20milk' });
  });

  it('Flipkart Minutes: data centre in the host, query and location in the body', () => {
    const req = buildRequest(site('fkminutes'), 'amul milk', { ...vars, dc: '1' });
    expect(req.url).toBe('https://1.rome.api.flipkart.com/api/4/page/fetch?cacheFirst=false');
    const body = JSON.parse(req.body!);
    expect(body.pageUri).toBe('/search?q=amul%20milk&marketplace=HYPERLOCAL&pincode=560034');
    expect(body.locationContext).toEqual({ pincode: 560034, latitude: 12.9352, longitude: 77.6245, changed: false });
  });

  it('JioMart sends the pincode in a header', () => {
    const req = buildRequest(site('jiomart'), 'amul milk', vars);
    expect(JSON.parse(req.headers['x-location-detail'])).toEqual({ pincode: '560034', country: 'INDIA' });
  });

  it('DMart searches the store found for the pincode', () => {
    expect(buildRequest(site('dmart'), 'amul milk', { ...vars, store: '10744' }).url).toBe(
      'https://digital.dmart.in/api/v3/search/amul%20milk?page=1&size=20&channel=web&storeId=10744',
    );
  });

  it('quotes in place names cannot break a JSON body', () => {
    const v = locationVars({ ...BLR, area: 'HSR "Layout" \\ 2', city: 'Bengaluru' });
    expect(v.area).toBe('HSR Layout 2');
    const step = site('fkminutes').setup!.find((s) => s.url.includes('location/update'))!;
    expect(() => JSON.parse(step.body!.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '0'))).not.toThrow();
  });

  it('address fields are never empty (Flipkart Minutes ignores a location without them)', () => {
    expect(locationVars({ lat: 12.9, lng: 77.6, pincode: '560034', label: '', source: 'gps' })).toMatchObject({ state: 'Karnataka', city: 'Karnataka', area: 'Karnataka' });
    expect([stateFromPincode('403001'), stateFromPincode('400069'), stateFromPincode('110001'), stateFromPincode('605001')]).toEqual(['Goa', 'Maharashtra', 'Delhi', 'Puducherry']);
  });

  it('location helpers', () => {
    expect(hasNeed(undefined, 'latlng')).toBe(false);
    expect(hasNeed({ pincode: '560034', label: '', source: 'pincode' }, 'latlng')).toBe(false);
    expect(hasNeed({ pincode: '560034', label: '', source: 'pincode' }, 'pincode')).toBe(true);
    expect(hasNeed({ lat: 1, lng: 2, label: '', source: 'gps' }, 'both')).toBe(false);
    expect(locationKey(BLR)).toBe('12.935,77.624|560034'); // ~100 m buckets
    expect(asLocation({ lat: 'x', pincode: '12' })).toBeUndefined();
    expect(asLocation({ lat: 12.9, lng: 77.6, source: 'gps' })).toMatchObject({ lat: 12.9, lng: 77.6, source: 'gps' });
  });
});

describe('setup steps', () => {
  it('DMart looks up the store for the pincode', async () => {
    const net = fakeNet((r) => (r.url.includes('pincodes/details') ? { status: 200, body: fixture('dmart-pincode') } : undefined));
    const setup = await runSetup(site('dmart'), vars, net);
    expect(setup).toMatchObject({ ok: true, vars: { store: '10744' } });
    expect(JSON.parse(net.sent[0].body!)).toMatchObject({ pincode: '560034' });
  });

  it("says so when DMart doesn't deliver to the pincode", async () => {
    const net = fakeNet(() => ({ status: 200, body: '{"isPincodeServiceable":"false","storePincodeDetails":{}}' }));
    expect(await runSetup(site('dmart'), vars, net)).toMatchObject({ ok: false, check: { status: 'empty', reason: 'no-delivery' } });
  });

  it('BigBasket: copies its CSRF cookie into the "set delivery address" call', async () => {
    const net = fakeNet(
      (r) =>
        r.url.includes('/serviceable/')
          ? { status: 200, body: '{"serviceable_ecs_info":{"bbnow":{"serviceable":"bb2.0"}}}' }
          : { status: 200, body: r.method === 'PUT' ? '{}' : '<html></html>' },
      { csurftoken: 'tok=en/1' },
    );
    expect((await runSetup(site('bigbasket'), vars, net)).ok).toBe(true);
    const put = net.sent.find((r) => r.method === 'PUT')!;
    expect(put.headers['x-csurftoken']).toBe('tok=en/1');
    expect(JSON.parse(put.body!)).toEqual({ lat: 12.9352, long: 77.6245, return_hub_cookies: false, area: null, contact_zipcode: '560034' });
  });

  it("BigBasket: no 10-minute store here means it doesn't deliver", async () => {
    const net = fakeNet((r) => ({ status: 200, body: r.url.includes('/serviceable/') ? '{"serviceable_ecs_info":{"bbnow":{"serviceable":"NA"}}}' : '' }), { csurftoken: 'x' });
    expect(await runSetup(site('bigbasket'), vars, net)).toMatchObject({ ok: false, check: { reason: 'no-delivery' } });
  });

  it('Flipkart Minutes moves to the data centre its API names ("DC Change")', async () => {
    const dcChange = { status: 406, body: '{"RESPONSE":{"id":"2","dc":"CH"},"ERROR_MESSAGE":"DC Change","STATUS_CODE":406}' };
    const net = fakeNet((r) => {
      if (r.url.startsWith('https://1.rome')) return dcChange;
      if (r.url.includes('serviceability')) return { status: 200, body: '{"RESPONSE":{"serviceable":true}}' };
      if (r.url.includes('page/fetch')) return { status: 200, body: fixture('search-fkminutes') };
      return { status: 200, body: '{}' };
    });
    const check = await checkSiteWith(site('fkminutes'), 'amul taaza toned milk 500 ml', milk, { net, location: BLR });
    expect(check.status).toBe('ok');
    expect(check.best?.price).toBe(27);
    expect(net.sent.filter((r) => r.url.startsWith('https://2.rome'))).toHaveLength(3);
  });

  it('a blocked setup is reported as blocked', async () => {
    const net = fakeNet(() => ({ status: 403, body: 'Access Denied' }));
    expect(await runSetup(site('dmart'), vars, net)).toMatchObject({ ok: false, check: { status: 'blocked' } });
  });
});

describe('what can be checked where', () => {
  const plain: Net = { fetch: async () => ({ status: 200, body: '' }) };
  const app: Net = { ...plain, cookies: async () => ({}), readPage: async () => ({ captures: [] }) };
  it('needs a location first', () => {
    expect(canCheck(site('zepto'), app, undefined)).toBe('needs-location');
    expect(canCheck(site('blinkit'), app, { pincode: '560034', label: '', source: 'pincode' })).toBe('needs-location');
    expect(canCheck(site('dmart'), plain, { pincode: '560034', label: '', source: 'pincode' })).toBe('yes');
    expect(canCheck(site('fkminutes'), app, { lat: 1, lng: 2, label: '', source: 'gps' })).toBe('needs-location');
  });
  it('browser-only and cookie-session sites need the app', () => {
    expect(canCheck(site('zepto'), plain, BLR)).toBe('app-only');
    expect(canCheck(site('bigbasket'), plain, BLR)).toBe('app-only');
    expect(canCheck(site('zepto'), app, BLR)).toBe('yes');
    expect(canCheck(site('bigbasket'), app, BLR)).toBe('yes');
  });
  it('Blinkit works without the browser (it is only a fallback)', () => {
    expect(canCheck(site('blinkit'), plain, BLR)).toBe('yes');
  });
});

// Zepto and Instamart answer only real browsers, so these responses follow the shape that
// public scrapers (October 2026) document instead of a saved copy. Check them on the phone.
const ZEPTO = JSON.stringify({
  layout: [
    {
      widgetId: 'PRODUCT_GRID',
      data: {
        resolver: {
          data: {
            items: [
              {
                productResponse: {
                  id: 'sp-1',
                  product: { name: 'Amul Taaza Toned Fresh Milk', brand: 'Amul' },
                  productVariant: { id: '6f1c2a90-0000-4000-8000-000000000001', formattedPacksize: '500 ml', mrp: 2900 },
                  mrp: 2900,
                  sellingPrice: 2800,
                  discountedSellingPrice: 2700,
                  outOfStock: false,
                  availableQuantity: 12,
                },
              },
              {
                productResponse: {
                  id: 'sp-2',
                  product: { name: 'Amul Gold Full Cream Milk', brand: 'Amul' },
                  productVariant: { id: '6f1c2a90-0000-4000-8000-000000000002', formattedPacksize: '500 ml', mrp: 3400 },
                  mrp: 3400,
                  sellingPrice: 3400,
                  discountedSellingPrice: 3400,
                  outOfStock: true,
                  availableQuantity: 0,
                },
              },
            ],
          },
        },
      },
    },
  ],
});

const INSTAMART = JSON.stringify({
  statusCode: 0,
  data: {
    cards: [
      {
        card: {
          card: {
            gridElements: {
              infoWithStyle: {
                items: [
                  {
                    productId: 'XYZ12AB',
                    displayName: 'Amul Taaza Toned Fresh Milk',
                    brand: 'Amul',
                    inStock: true,
                    isAvail: true,
                    variations: [
                      {
                        displayName: 'Amul Taaza Toned Fresh Milk',
                        quantityDescription: '500 ml',
                        price: { mrp: { currencyCode: 'INR', units: '29' }, offerPrice: { currencyCode: 'INR', units: '27' } },
                        inventory: { inStock: true },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    ],
  },
});

describe('hidden in-app browser', () => {
  it('Zepto: opens its search page with the location cookie and captures its own search call', () => {
    const req = pageRequest(site('zepto'), 'amul milk', vars);
    expect(req.url).toBe('https://www.zepto.com/search?query=amul%20milk');
    expect(req.cookies).toEqual([{ url: 'https://www.zepto.com', value: `user_position=${encodeURIComponent('{"latitude":12.9352,"longitude":77.6245}')}; path=/` }]);
    expect(new RegExp(req.capture!).test('https://bff-gateway.zepto.com/user-search-service/api/v3/search')).toBe(true);
    expect(req.origins).toEqual(['https://www.zepto.com']);
    expect(req.run).toBeUndefined();
  });

  it('Instamart: location cookie for every swiggy.com host', () => {
    const req = pageRequest(site('instamart'), 'amul milk', vars);
    expect(req.cookies[0].value).toMatch(/^userLocation=%7B%22lat%22%3A12\.9352%2C%22lng%22%3A77\.6245.*; path=\/; domain=\.swiggy\.com$/);
    expect(new RegExp(req.capture!).test('/api/instamart/search/v2?offset=0&ageConsent=false')).toBe(true);
  });

  it('Blinkit fallback: runs its own search request inside the page', () => {
    const req = pageRequest(site('blinkit'), 'amul milk', vars);
    expect(req.url).toBe('https://blinkit.com/');
    expect(req.run).toMatchObject({ url: 'https://blinkit.com/v1/layout/search?q=amul%20milk&start=0&size=20', method: 'POST' });
    expect(req.run!.headers.lat).toBe('12.9352');
  });

  it('Zepto prices are in paise', () => {
    const check = readPageResult(site('zepto'), { captures: [{ url: 'x', status: 200, body: ZEPTO }] }, milk);
    expect(check.status).toBe('ok');
    expect(check.best).toMatchObject({ title: 'Amul Taaza Toned Fresh Milk, 500 ml', price: 27, mrp: 29, inStock: true });
    expect(check.best!.url).toBe('https://www.zepto.com/pn/x/pvid/6f1c2a90-0000-4000-8000-000000000001');
    expect(check.listings.find((l) => /Gold/.test(l.title))?.inStock).toBe(false);
  });

  it('Instamart', () => {
    const check = readPageResult(site('instamart'), { captures: [{ url: 'x', status: 200, body: INSTAMART }] }, milk);
    expect(check.best).toMatchObject({ title: 'Amul Taaza Toned Fresh Milk, 500 ml', price: 27, mrp: 29, inStock: true, url: 'https://www.swiggy.com/instamart/item/XYZ12AB' });
  });

  it('tells "no delivery here", a block and a timeout apart', () => {
    const z = site('zepto');
    expect(readPageResult(z, { captures: [], text: 'Sorry! We are not serviceable at your location yet' }, milk)).toMatchObject({ status: 'empty', reason: 'no-delivery' });
    expect(readPageResult(z, { captures: [], title: 'Access Denied' }, milk).status).toBe('blocked');
    expect(readPageResult(z, { captures: [{ url: 'x', status: 403, body: '' }] }, milk).status).toBe('blocked');
    expect(readPageResult(z, { captures: [], reason: 'timeout' }, milk)).toMatchObject({ status: 'error', error: 'browser: timeout' });
  });

  it('checkSiteWith goes to the browser only when the plain request is blocked (Blinkit)', async () => {
    let pages = 0;
    const net: Net = {
      fetch: async () => ({ status: 403, body: '<html>challenge</html>' }),
      readPage: async () => {
        pages++;
        return { captures: [{ url: 'run', status: 200, body: fixture('search-blinkit') }] };
      },
    };
    const check = await checkSiteWith(site('blinkit'), 'amul taaza toned milk 500 ml', milk, { net, location: BLR });
    expect(pages).toBe(1);
    expect(check.best?.price).toBe(29);
  });
});
