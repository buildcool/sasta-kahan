// Turning a pincode, an area name or the phone's position into a delivery location.
// First the phone's own geocoder (no extra service). Without one: India Post for the
// areas of a pincode, and Open-Meteo's free place search for their coordinates.
import { fetchText } from './core/fetcher.ts';
import { isPincode, placeLabel, type UserLocation } from './core/location.ts';
import { currentPosition, geocode, reverseGeocode, type NativePlace } from './native.ts';

function fromNative(p: NativePlace, source: UserLocation['source']): UserLocation | undefined {
  if (p.country && p.country !== 'IN') return undefined;
  // The geocoder names a pincode search after the pincode itself; that's not an area.
  const area = p.area && !/^\d+$/.test(p.area) ? p.area : undefined;
  const loc: UserLocation = { lat: p.lat, lng: p.lng, area, city: p.city, state: p.state, source, label: '' };
  if (p.pincode && isPincode(p.pincode)) loc.pincode = p.pincode;
  loc.label = placeLabel(loc);
  return loc;
}

const unique = (list: UserLocation[]) => list.filter((l, i) => list.findIndex((x) => x.label === l.label) === i);

async function getJson(url: string): Promise<unknown> {
  const res = await fetchText({ url, method: 'GET', headers: { Accept: 'application/json' } });
  return res.status === 200 ? JSON.parse(res.body) : undefined;
}

interface MeteoPlace {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  admin2?: string;
  postcodes?: string[];
}

async function openMeteo(name: string): Promise<MeteoPlace[]> {
  const data = (await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&countryCode=IN&language=en&format=json`)) as
    | { results?: MeteoPlace[] }
    | undefined;
  return data?.results ?? [];
}

/** Areas of a pincode (India Post) with coordinates where Open-Meteo knows the place. */
async function byIndiaPost(pin: string): Promise<UserLocation[]> {
  const data = (await getJson(`https://api.postalpincode.in/pincode/${pin}`)) as { PostOffice?: { Name: string; District: string; State: string }[] }[] | undefined;
  const offices = data?.[0]?.PostOffice ?? [];
  const out: UserLocation[] = [];
  for (const o of offices.slice(0, 4)) {
    const hit = (await openMeteo(o.Name)).find((m) => (m.admin1 ?? '').toLowerCase() === o.State.toLowerCase());
    if (hit) out.push({ lat: hit.latitude, lng: hit.longitude, pincode: pin, area: o.Name, city: o.District, state: o.State, source: 'pincode', label: placeLabel({ area: o.Name, city: o.District, pincode: pin }) });
  }
  // No coordinates anywhere: the pincode alone still works for JioMart and DMart.
  if (!out.length && offices.length) {
    const o = offices[0];
    out.push({ pincode: pin, area: o.Name, city: o.District, state: o.State, source: 'pincode', label: placeLabel({ area: o.Name, city: o.District, pincode: pin }) });
  }
  return out;
}

async function byOpenMeteo(text: string): Promise<UserLocation[]> {
  return (await openMeteo(text)).map((m) => {
    const pincode = m.postcodes?.find(isPincode);
    const loc: UserLocation = { lat: m.latitude, lng: m.longitude, pincode, area: m.name, city: m.admin2, state: m.admin1, source: 'search', label: '' };
    loc.label = placeLabel(loc);
    return loc;
  });
}

/** Places for what the user typed: a 6-digit pincode or an area name. */
export async function findPlaces(text: string): Promise<UserLocation[]> {
  const q = text.trim().replace(/\s+/g, ' ');
  if (!q) return [];
  const pin = isPincode(q) ? q : undefined;
  try {
    const found = (await geocode(`${q}, India`))
      .map((p) => fromNative(p, pin ? 'pincode' : 'search'))
      .filter((l): l is UserLocation => !!l)
      // For a pincode search, that pincode is what the sites should get.
      .map((l) => (pin ? { ...l, pincode: pin, label: placeLabel({ ...l, pincode: pin }) } : l));
    if (found.length) return unique(found);
  } catch {
    // No geocoder on this phone (or no network for it): use the web fallbacks below.
  }
  try {
    return unique(pin ? await byIndiaPost(pin) : await byOpenMeteo(q));
  } catch {
    return [];
  }
}

/** The phone's current position, with its pincode and area name when the geocoder knows them. */
export async function placeFromGps(): Promise<UserLocation> {
  const { lat, lng } = await currentPosition();
  let near: UserLocation | undefined;
  try {
    const p = (await reverseGeocode(lat, lng))[0];
    near = p && fromNative(p, 'gps');
  } catch {
    // keep the coordinates without a name
  }
  const loc: UserLocation = { ...near, lat, lng, source: 'gps', label: '' };
  loc.label = placeLabel(loc) || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return loc;
}
