import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';

/**
 * "Share → SastaKahan" from Amazon/Flipkart/any app.
 * Implemented in android/app/src/main/java/app/sastakahan/ShareInPlugin.java.
 */
interface ShareInPlugin {
  getShared(): Promise<{ text?: string }>;
  addListener(event: 'shared', cb: (d: { text: string }) => void): Promise<PluginListenerHandle>;
}
const ShareIn = registerPlugin<ShareInPlugin>('ShareIn');

export async function onSharedText(cb: (text: string) => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  const first = await ShareIn.getShared().catch(() => ({ text: undefined }));
  if (first.text) cb(first.text);
  const h = await ShareIn.addListener('shared', (d) => d.text && cb(d.text));
  return () => void h.remove();
}

export async function shareText(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Share.share({ text, dialogTitle: 'Share prices' });
  } else if (navigator.share) {
    await navigator.share({ text });
  } else {
    await navigator.clipboard.writeText(text);
    alert('Copied to clipboard');
  }
}

export async function notify(title: string, body: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted' && (await LocalNotifications.requestPermissions()).display !== 'granted') return;
  await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2147483647, title, body }] });
}

export async function ensureNotificationPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
}
