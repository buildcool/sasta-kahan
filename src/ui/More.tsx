import { useState } from 'react';
import type { UserLocation } from '../core/location.ts';
import { LANGS, useT } from '../i18n.ts';
import { clearCookies, openLogin, openUrl, shareText } from '../native.ts';
import { exportBackup, importBackup, type Settings } from '../storage.ts';
import { checkForUpdate, releasesUrl, type Update } from '../update.ts';

/** Shops you can log in to inside the app (beta). Home page when the login page has no stable URL. */
const LOGIN_SITES = [
  { id: 'amazon', name: 'Amazon', url: 'https://www.amazon.in/gp/css/homepage.html', site: 'https://www.amazon.in', domain: '.amazon.in' },
  { id: 'flipkart', name: 'Flipkart', url: 'https://www.flipkart.com/account/login', site: 'https://www.flipkart.com', domain: '.flipkart.com' },
  { id: 'myntra', name: 'Myntra', url: 'https://www.myntra.com/login', site: 'https://www.myntra.com', domain: '.myntra.com' },
  { id: 'nykaa', name: 'Nykaa', url: 'https://www.nykaa.com/', site: 'https://www.nykaa.com', domain: '.nykaa.com' },
  { id: 'ajio', name: 'Ajio', url: 'https://www.ajio.com/', site: 'https://www.ajio.com', domain: '.ajio.com' },
  { id: 'tatacliq', name: 'Tata CLiQ', url: 'https://www.tatacliq.com/', site: 'https://www.tatacliq.com', domain: '.tatacliq.com' },
];

const REPO = import.meta.env.VITE_CONFIG_REPO as string | undefined;

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  version: { version: string; build: number };
  onRestored: () => void;
  location?: UserLocation;
  onEditLocation: () => void;
}

export function More({ settings, onSettings, version, onRestored, location, onEditLocation }: Props) {
  const t = useT();
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string>();
  const [update, setUpdate] = useState<Update | null>();
  const [updateMsg, setUpdateMsg] = useState<string>();
  const logins = settings.logins ?? [];

  const toggle = (k: 'background' | 'clipboard' | 'suggestions' | 'quickBrowser') => onSettings({ ...settings, [k]: !settings[k] });

  return (
    <div className="page">
      <h2>{t('more.title')}</h2>

      <h3>{t('more.lang')}</h3>
      <div className="chips">
        {LANGS.map((l) => (
          <button key={l.id} className={`chip ${(settings.lang ?? 'en') === l.id ? 'on' : ''}`} onClick={() => onSettings({ ...settings, lang: l.id })}>
            {l.name}
          </button>
        ))}
      </div>

      <label className="toggle">
        <input type="checkbox" checked={settings.background} onChange={() => toggle('background')} />
        <span>
          {t('more.bg')}
          <span className="muted small block">{t('more.bgHint')}</span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.clipboard} onChange={() => toggle('clipboard')} />
        <span>
          {t('more.clip')}
          <span className="muted small block">{t('more.clipHint')}</span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.suggestions} onChange={() => toggle('suggestions')} />
        <span>
          {t('more.suggest')}
          <span className="muted small block">{t('more.suggestHint')}</span>
        </span>
      </label>

      <h3>{t('more.location')}</h3>
      <div className="row between">
        <span className={location ? '' : 'muted small'}>{location ? location.label : t('more.locationNone')}</span>
        <button className="pill" onClick={onEditLocation}>
          {t('more.locationChange')}
        </button>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={settings.quickBrowser} onChange={() => toggle('quickBrowser')} />
        <span>
          {t('more.quickBrowser')}
          <span className="muted small block">{t('more.quickBrowserHint')}</span>
        </span>
      </label>

      <h3>{t('more.logins')}</h3>
      <p className="muted small">{t('more.loginsHint')}</p>
      <div className="bank-grid">
        {LOGIN_SITES.map((s) => {
          const on = logins.includes(s.id);
          return (
            <div key={s.id} className="bank-row">
              <span className="bank-name">
                {s.name} {on && <span className="tag tag-good">{t('more.loggedIn')}</span>}
              </span>
              <button
                className="chip small"
                onClick={async () => {
                  await openLogin(s.url, s.name);
                  if (!on) onSettings({ ...settings, logins: [...logins, s.id] });
                }}
              >
                {t('more.login')}
              </button>
              {on && (
                <button
                  className="chip small"
                  onClick={async () => {
                    await clearCookies(s.site, s.domain);
                    onSettings({ ...settings, logins: logins.filter((x) => x !== s.id) });
                  }}
                >
                  {t('more.logout')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h3>{t('more.backup')}</h3>
      <p className="muted small">{t('more.backupHint')}</p>
      <div className="row gap">
        <button className="pill" onClick={async () => shareText(await exportBackup())}>
          {t('more.export')}
        </button>
      </div>
      <textarea className="backup" rows={3} placeholder={t('more.importHint')} value={importText} onChange={(e) => setImportText(e.target.value)} />
      <div className="row gap">
        <button
          className="pill"
          disabled={!importText.trim()}
          onClick={async () => {
            try {
              const n = await importBackup(importText);
              setImportMsg(t('more.importDone', { n }));
              setImportText('');
              onRestored();
            } catch {
              setImportMsg(t('more.importBad'));
            }
          }}
        >
          {t('more.import')}
        </button>
        {importMsg && <span className="muted small">{importMsg}</span>}
      </div>

      <h3>{t('more.version', { v: version.version })}</h3>
      <div className="row gap">
        <button
          className="pill"
          onClick={async () => {
            setUpdateMsg(undefined);
            try {
              const u = await checkForUpdate(version.build, true);
              setUpdate(u ?? null);
              if (!u) setUpdateMsg(t('more.upToDate'));
            } catch {
              setUpdateMsg(t('more.updateFailed'));
            }
          }}
        >
          {t('more.checkUpdate')}
        </button>
        {update && (
          <button className="pill" onClick={() => openUrl(update.url)}>
            {t('update.download')} {update.version}
          </button>
        )}
        {updateMsg && <span className="muted small">{updateMsg}</span>}
      </div>

      <h3>{t('more.privacy')}</h3>
      <ul className="privacy">
        {(['privacy.1', 'privacy.2', 'privacy.3', 'privacy.4', 'privacy.5', 'privacy.6'] as const).map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>

      {REPO && (
        <div className="card-actions">
          <a className="link" href={`https://github.com/${REPO}/issues/new`} target="_blank" rel="noreferrer">
            {t('more.report')}
          </a>
          <a className="link" href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer">
            {t('more.source')}
          </a>
          {releasesUrl && (
            <a className="link" href={releasesUrl} target="_blank" rel="noreferrer">
              Releases
            </a>
          )}
        </div>
      )}
    </div>
  );
}
