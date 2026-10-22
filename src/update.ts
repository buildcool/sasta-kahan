import { fetchText } from './core/fetcher.ts';

// The app is installed from GitHub Releases, not the Play Store, so it checks for updates itself.
const REPO = import.meta.env.VITE_CONFIG_REPO as string | undefined;
const KEY = 'sk.update';
const DAY = 24 * 60 * 60 * 1000;

export interface Update {
  version: string;
  build: number;
  url: string;
}

export const releasesUrl = REPO ? `https://github.com/${REPO}/releases/latest` : undefined;

/** Latest release, if newer than this build. Checks GitHub at most once a day unless forced. */
export async function checkForUpdate(build: number, force = false): Promise<Update | undefined> {
  if (!REPO || !build) return undefined;
  let cached: { at: number; latest?: Update } | undefined;
  try {
    cached = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? undefined;
  } catch {
    cached = undefined;
  }
  let latest = cached?.latest;
  if (force || !cached || Date.now() - cached.at > DAY) {
    const res = await fetchText({ url: `https://api.github.com/repos/${REPO}/releases/latest`, method: 'GET', headers: { Accept: 'application/vnd.github+json' } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const rel = JSON.parse(res.body) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const tag = rel.tag_name ?? '';
    const apk = rel.assets?.find((a) => a.name.endsWith('.apk'));
    // Tags are v1.<minor>.<CI run number>; the run number is also the APK's versionCode.
    latest = { version: tag.replace(/^v/, ''), build: Number(tag.split('.').at(-1)) || 0, url: apk?.browser_download_url ?? `https://github.com/${REPO}/releases/latest` };
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), latest }));
  }
  return latest && latest.build > build ? latest : undefined;
}
