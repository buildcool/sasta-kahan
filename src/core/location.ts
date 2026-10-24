// The user's delivery location. Quick-commerce sites (Blinkit, Zepto, Instamart,
// BigBasket, Flipkart Minutes…) price and stock items per dark store, so they need
// to know where you are. Saved on the phone only; sent only to those sites.

export interface UserLocation {
  lat?: number;
  lng?: number;
  pincode?: string;
  /** Locality, e.g. "Koramangala". */
  area?: string;
  city?: string;
  state?: string;
  /** What we show, e.g. "Koramangala, Bengaluru 560034". */
  label: string;
  source: 'gps' | 'pincode' | 'search';
}

/** What a site needs: coordinates, a pincode, or both. */
export type LocationNeed = 'latlng' | 'pincode' | 'both';

export const isPincode = (s: string) => /^[1-9]\d{5}$/.test(s.trim());

export function hasNeed(loc: UserLocation | undefined, need: LocationNeed | undefined): boolean {
  if (!need) return true;
  if (!loc) return false;
  const ll = loc.lat != null && loc.lng != null;
  return need === 'pincode' ? !!loc.pincode : need === 'both' ? ll && !!loc.pincode : ll;
}

/** Quotes and the like would break the JSON bodies the values go into. */
const clean = (s: string | undefined) => (s ?? '').replace(/["\\<>{}]/g, '').replace(/\s+/g, ' ').trim();

/** "12.935200" → "12.9352": what a browser would send. */
const coord = (n: number) => String(Math.round(n * 1e6) / 1e6);

// First two digits of a pincode → state (India Post circles). Approximate at the borders,
// but sites that want an address (Flipkart Minutes) only need a sensible one.
const PIN_STATES: [string, string][] = [
  ['11', 'Delhi'], ['12', 'Haryana'], ['13', 'Haryana'], ['14', 'Punjab'], ['15', 'Punjab'], ['16', 'Punjab'],
  ['17', 'Himachal Pradesh'], ['18', 'Jammu and Kashmir'], ['19', 'Jammu and Kashmir'], ['24', 'Uttarakhand'], ['26', 'Uttarakhand'],
  ['20', 'Uttar Pradesh'], ['21', 'Uttar Pradesh'], ['22', 'Uttar Pradesh'], ['23', 'Uttar Pradesh'], ['25', 'Uttar Pradesh'],
  ['27', 'Uttar Pradesh'], ['28', 'Uttar Pradesh'], ['30', 'Rajasthan'], ['31', 'Rajasthan'], ['32', 'Rajasthan'], ['33', 'Rajasthan'],
  ['34', 'Rajasthan'], ['36', 'Gujarat'], ['37', 'Gujarat'], ['38', 'Gujarat'], ['39', 'Gujarat'], ['403', 'Goa'], ['40', 'Maharashtra'],
  ['41', 'Maharashtra'], ['42', 'Maharashtra'], ['43', 'Maharashtra'], ['44', 'Maharashtra'], ['45', 'Madhya Pradesh'],
  ['46', 'Madhya Pradesh'], ['47', 'Madhya Pradesh'], ['48', 'Madhya Pradesh'], ['49', 'Chhattisgarh'], ['50', 'Telangana'],
  ['51', 'Andhra Pradesh'], ['52', 'Andhra Pradesh'], ['53', 'Andhra Pradesh'], ['56', 'Karnataka'], ['57', 'Karnataka'],
  ['58', 'Karnataka'], ['59', 'Karnataka'], ['605', 'Puducherry'], ['60', 'Tamil Nadu'], ['61', 'Tamil Nadu'], ['62', 'Tamil Nadu'],
  ['63', 'Tamil Nadu'], ['64', 'Tamil Nadu'], ['67', 'Kerala'], ['68', 'Kerala'], ['69', 'Kerala'], ['737', 'Sikkim'],
  ['744', 'Andaman and Nicobar Islands'], ['70', 'West Bengal'], ['71', 'West Bengal'], ['72', 'West Bengal'], ['73', 'West Bengal'],
  ['74', 'West Bengal'], ['75', 'Odisha'], ['76', 'Odisha'], ['77', 'Odisha'], ['78', 'Assam'], ['79', 'Meghalaya'],
  ['81', 'Jharkhand'], ['82', 'Jharkhand'], ['83', 'Jharkhand'], ['80', 'Bihar'], ['84', 'Bihar'], ['85', 'Bihar'],
];

export function stateFromPincode(pin: string | undefined): string | undefined {
  return pin ? PIN_STATES.find(([p]) => pin.startsWith(p))?.[1] : undefined;
}

/** Template values for requests in config/sites.json: {lat} {lng} {pincode} {area} {city} {state}. */
export function locationVars(loc: UserLocation | undefined): Record<string, string> {
  if (!loc) return {};
  // Address fields are never empty: Flipkart Minutes ignores a location update without them.
  const state = clean(loc.state) || clean(stateFromPincode(loc.pincode));
  const city = clean(loc.city) || clean(loc.area) || state;
  const v: Record<string, string> = {
    pincode: clean(loc.pincode),
    city,
    state: state || city,
    area: clean(loc.area) || city,
  };
  if (loc.lat != null && loc.lng != null) {
    v.lat = coord(loc.lat);
    v.lng = coord(loc.lng);
  }
  return v;
}

/** Same key = same store: about 100 m of rounding. */
export function locationKey(loc: UserLocation | undefined): string {
  if (!loc) return '';
  const ll = loc.lat != null && loc.lng != null ? `${loc.lat.toFixed(3)},${loc.lng.toFixed(3)}` : '';
  return `${ll}|${loc.pincode ?? ''}`;
}

export function placeLabel(p: Pick<UserLocation, 'area' | 'city' | 'pincode'>): string {
  const parts = [p.area, p.city].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  return [parts.join(', '), p.pincode].filter(Boolean).join(' ') || p.pincode || '';
}

/** Checks a stored value really is a location (it comes from storage / a backup). */
export function asLocation(v: unknown): UserLocation | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Partial<UserLocation>;
  const okNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const loc: UserLocation = {
    label: typeof o.label === 'string' ? o.label : '',
    source: o.source === 'gps' || o.source === 'search' ? o.source : 'pincode',
  };
  if (okNum(o.lat) && okNum(o.lng) && Math.abs(o.lat!) <= 90 && Math.abs(o.lng!) <= 180) {
    loc.lat = o.lat;
    loc.lng = o.lng;
  }
  if (typeof o.pincode === 'string' && isPincode(o.pincode)) loc.pincode = o.pincode;
  for (const k of ['area', 'city', 'state'] as const) if (typeof o[k] === 'string' && o[k]) loc[k] = o[k];
  if (loc.lat == null && !loc.pincode) return undefined;
  loc.label ||= placeLabel(loc);
  return loc;
}
