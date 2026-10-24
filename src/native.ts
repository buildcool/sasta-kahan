import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor, CapacitorCookies, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { UA } from './core/fetcher.ts';
import type { PageRequest, PageResult } from './core/search.ts';

const native = Capacitor.isNativePlatform();

/**
 * "Share → SastaKahan" from Amazon/Flipkart/any app.
 * Implemented in android/app/src/main/java/app/sastakahan/ShareInPlugin.java.
 */
interface ShareInPlugin {
  getShared(): Promise<{ text?: string }>;
  addListener(event: 'shared', cb: (d: { text: string }) => void): Promise<PluginListenerHandle>;
}
const ShareIn = registerPlugin<ShareInPlugin>('ShareIn');

/** A place from the phone's geocoder. */
export interface NativePlace {
  lat: number;
  lng: number;
  pincode?: string;
  area?: string;
  city?: string;
  state?: string;
  country?: string;
}

/** Implemented in android/app/src/main/java/app/sastakahan/ToolsPlugin.java. */
interface ToolsPlugin {
  openInApp(o: { url: string; package?: string }): Promise<{ opened: boolean }>;
  scanBarcode(): Promise<{ code: string }>;
  openLogin(o: { url: string; title: string; userAgent: string }): Promise<void>;
  clearCookies(o: { url: string; domain?: string }): Promise<void>;
  getCookies(o: { url: string }): Promise<Record<string, string>>;
  readPage(o: PageRequest): Promise<PageResult>;
  geocode(o: { query: string; max?: number }): Promise<{ results: NativePlace[] }>;
  reverseGeocode(o: { lat: number; lng: number }): Promise<{ results: NativePlace[] }>;
}
const Tools = registerPlugin<ToolsPlugin>('Tools');

export async function onSharedText(cb: (text: string) => void): Promise<() => void> {
  if (!native) return () => {};
  const first = await ShareIn.getShared().catch(() => ({ text: undefined }));
  if (first.text) cb(first.text);
  const h = await ShareIn.addListener('shared', (d) => d.text && cb(d.text));
  return () => void h.remove();
}

export async function shareText(text: string): Promise<void> {
  if (native) {
    await Share.share({ text, dialogTitle: 'Share' });
  } else if (navigator.share) {
    await navigator.share({ text });
  } else {
    await navigator.clipboard.writeText(text);
    alert('Copied to clipboard');
  }
}

/** Open a link the normal way (browser, or the shop's app if Android prefers it). */
export function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener');
}

/** Open a product in the shop's own app; falls back to the browser when the app isn't installed. */
export async function openInApp(url: string, pkg?: string): Promise<void> {
  if (native) {
    const { opened } = await Tools.openInApp({ url, package: pkg }).catch(() => ({ opened: false }));
    if (opened) return;
  }
  openUrl(url);
}

export const canScan = () => native;

/** Scan a product barcode (EAN/UPC). Resolves undefined when the user cancels. */
export async function scanBarcode(): Promise<string | undefined> {
  try {
    return (await Tools.scanBarcode()).code;
  } catch (e) {
    if ((e as { code?: string }).code === 'CANCELED') return undefined;
    throw e;
  }
}

/** Text on the clipboard, if reading it is possible (only while the app is in front). */
export async function readClipboard(): Promise<string | undefined> {
  if (!native) return undefined;
  try {
    const { value } = await Clipboard.read();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/** Log in to a shop inside the app (beta). Cookies are shared with the price checks. */
export async function openLogin(url: string, title: string): Promise<void> {
  if (!native) {
    openUrl(url);
    return;
  }
  await Tools.openLogin({ url, title, userAgent: UA });
}

/** Log out of a shop (beta logins): expire its cookies, including domain-wide ones. */
export async function clearCookies(url: string, domain?: string): Promise<void> {
  if (native) await Tools.clearCookies({ url, domain }).catch(() => CapacitorCookies.clearCookies({ url }));
}

/** The hidden in-app browser for sites that only answer real browsers (Android only). */
export const canReadPage = () => native;

export async function readPage(req: PageRequest): Promise<PageResult> {
  try {
    return await Tools.readPage(req);
  } catch (e) {
    return { captures: [], reason: `error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Cookies the app holds for a site (its WebView cookie store, shared with the native requests). */
export async function cookiesFor(url: string): Promise<Record<string, string>> {
  if (!native) return {};
  return Tools.getCookies({ url }).catch(() => ({}));
}

/** Places for a pincode or area name from the phone's own geocoder; throws when there's none. */
export async function geocode(query: string): Promise<NativePlace[]> {
  if (!native) throw new Error('no-geocoder');
  return (await Tools.geocode({ query, max: 5 })).results;
}

export async function reverseGeocode(lat: number, lng: number): Promise<NativePlace[]> {
  if (!native) throw new Error('no-geocoder');
  return (await Tools.reverseGeocode({ lat, lng })).results;
}

/** Where the phone is, asking for location permission first. Throws 'denied' if refused. */
export async function currentPosition(): Promise<{ lat: number; lng: number }> {
  if (native) {
    const has = (p: { location: string; coarseLocation: string }) => p.location === 'granted' || p.coarseLocation === 'granted';
    if (!has(await Geolocation.checkPermissions())) {
      if (!has(await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] }))) throw new Error('denied');
    }
  }
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 120000 });
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

export async function appVersion(): Promise<{ version: string; build: number }> {
  if (!native) return { version: 'dev', build: 0 };
  const info = await App.getInfo();
  return { version: info.version, build: Number(info.build) || 0 };
}

export async function notify(title: string, body: string): Promise<void> {
  if (!native) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted' && (await LocalNotifications.requestPermissions()).display !== 'granted') return;
  await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2147483647, title, body }] });
}

export async function ensureNotificationPermission(): Promise<void> {
  if (!native) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
}
