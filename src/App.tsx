import { App as CapApp } from '@capacitor/app';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nameForBarcode, nameFromAmazon } from './core/barcode.ts';
import { getConfig, refreshConfig } from './core/config.ts';
import { EMPTY_WALLET, expandWallet } from './core/effectivePrice.ts';
import { extractUrl, repriceForWallet, resolveInput, runSearch } from './core/engine.ts';
import { condenseTitle, makeReference, tokens, type Reference } from './core/matcher.ts';
import { parseResponse } from './core/parse.ts';
import type { ScoredListing, SiteResult, Wallet } from './core/types.ts';
import type { WatchItem } from './core/watchLogic.ts';
import { LangContext, defaultLang, translate, type Key, type Lang, type Vars } from './i18n.ts';
import { appVersion, canScan, ensureNotificationPermission, onSharedText, openUrl, readClipboard, scanBarcode, shareText } from './native.ts';
import {
  DEFAULT_SETTINGS,
  addRecent,
  clearRecent,
  loadRecent,
  loadSettings,
  loadWallet,
  loadWatch,
  saveSettings,
  saveWallet,
  updateWatchItem,
  type Recent,
  type Settings,
} from './storage.ts';
import { Cards } from './ui/Cards.tsx';
import { ago, summaryText } from './ui/format.ts';
import { More } from './ui/More.tsx';
import { Results } from './ui/Results.tsx';
import { SearchBar } from './ui/SearchBar.tsx';
import { Watch } from './ui/Watch.tsx';
import { checkForUpdate, type Update } from './update.ts';
import { addToWatch, checkItem, checkStale, removeFromWatch } from './watch.ts';

type Tab = 'search' | 'cards' | 'watch' | 'more';

interface Current {
  query: string;
  label: string;
  ref?: Reference;
  /** Still reading the product from a shared link / barcode. */
  pending?: boolean;
}

const EXAMPLES = ['lakme sunscreen spf 50', 'boat airdopes 141', 'iphone 15 128gb', 'nivea soft cream 100ml'];
const SHOP_LINK =
  /https?:\/\/(?:[\w-]+\.)*(?:amazon\.in|amzn\.(?:in|to|eu)|flipkart\.com|fkrt\.\w+|myntra\.com|myntr\.it|nykaa\.com|nykaafashion\.com|meesho\.com|ajio\.com|tatacliq\.com|croma\.com|reliancedigital\.in|jiomart\.com|vijaysales\.com|purplle\.com|smytten\.com)\S*/i;

/** "**bold**" → <b>bold</b> for translated sentences. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}
    </>
  );
}

/** Short names search better as words; full product titles as "this exact product". */
const refFor = (name: string) => makeReference(name, tokens(name).length <= 6 ? 'query' : 'product');

export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const lang: Lang = settings.lang ?? defaultLang();
  const t = (k: Key, v?: Vars) => translate(lang, k, v);
  const [input, setInput] = useState('');
  const [current, setCurrent] = useState<Current>();
  const [results, setResults] = useState<SiteResult[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<Wallet>(EMPTY_WALLET);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [clip, setClip] = useState<string>();
  const [update, setUpdate] = useState<Update>();
  const [version, setVersion] = useState({ version: 'dev', build: 0 });
  const abort = useRef<AbortController>(undefined);
  // Listeners registered once read the latest state through refs.
  const live = useRef({ wallet, lang, settings, tab, current });
  live.current = { wallet, lang, settings, tab, current };
  const config = getConfig();

  const search = useCallback(async (text: string, ref?: Reference, label?: string, fresh = false) => {
    if (!text.trim()) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const tr = (k: Key, v?: Vars) => translate(live.current.lang, k, v);
    setTab('search');
    setError(undefined);
    setBusy(true);
    setResults([]);
    // A shared link takes a few seconds to read; say so instead of showing the previous product.
    const isLink = !ref && !!extractUrl(text);
    setCurrent(isLink ? { query: '', label: tr('current.resolving'), pending: true } : { query: text, label: label ?? text, ref });
    try {
      const resolved = ref ? { query: text, ref } : await resolveInput(text);
      if (ctrl.signal.aborted) return;
      const shown = label ?? (resolved.ref.mode === 'product' ? resolved.ref.text : resolved.query);
      setCurrent({ query: resolved.query, ref: resolved.ref, label: shown });
      setInput(resolved.ref.mode === 'product' ? '' : resolved.query);
      setRecent(await addRecent({ query: resolved.query, label: shown, refTitle: resolved.ref.mode === 'product' ? resolved.ref.text : undefined }));
      await runSearch({
        query: resolved.query,
        ref: resolved.ref,
        wallet: expandWallet(live.current.wallet),
        onUpdate: (r) => !ctrl.signal.aborted && setResults(r),
        signal: ctrl.signal,
        fresh,
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === 'no-title' ? tr('err.noTitle') : tr('err.generic', { msg }));
      setCurrent((c) => (c?.pending ? undefined : c));
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }, []);

  const runRecent = (r: Recent) => search(r.query, r.refTitle ? makeReference(r.refTitle, 'product') : undefined, r.label);

  useEffect(() => {
    const recheck = (w: Wallet, l: Lang) => checkStale(expandWallet(w), l).then(setWatch).catch(() => undefined);
    const lookAtClipboard = async (s: Settings) => {
      if (!s.clipboard) return;
      const link = (await readClipboard())?.match(SHOP_LINK)?.[0];
      if (link && link !== s.lastClip) setClip(link);
    };
    // Android Back: close the tab / the comparison first, and only then leave the app.
    const onBack = () => {
      const { tab: tb, current: cur } = live.current;
      if (tb !== 'search') setTab('search');
      else if (cur) {
        abort.current?.abort();
        setCurrent(undefined);
        setResults([]);
        setError(undefined);
        setBusy(false);
      } else CapApp.minimizeApp();
    };

    (async () => {
      const [s, w] = await Promise.all([loadSettings(), loadWallet()]);
      setSettings(s);
      setWallet(w);
      setRecent(await loadRecent());
      setWatch(await loadWatch());
      const v = await appVersion();
      setVersion(v);
      checkForUpdate(v.build).then(setUpdate, () => undefined);
      recheck(w, s.lang ?? defaultLang());
      lookAtClipboard(s);
    })();
    refreshConfig();
    let cleanup = () => {};
    onSharedText((text) => {
      setClip(undefined);
      search(text);
    }).then((c) => (cleanup = c));
    const resume = CapApp.addListener('resume', () => {
      const { wallet: w, lang: l, settings: s } = live.current;
      recheck(w, l);
      lookAtClipboard(s);
    }).catch(() => undefined);
    const back = CapApp.addListener('backButton', onBack).catch(() => undefined);
    return () => {
      cleanup();
      resume.then((h) => h?.remove());
      back.then((h) => h?.remove());
    };
  }, [search]);

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  const updateWallet = (w: Wallet) => {
    setWallet(w);
    saveWallet(w);
    setResults((r) => repriceForWallet(r, expandWallet(w)));
  };

  const dismissClip = () => {
    if (clip) updateSettings({ ...settings, lastClip: clip });
    setClip(undefined);
  };

  const compareExact = (l: ScoredListing) => {
    search(condenseTitle(l.title), makeReference(l.title, 'product'), l.title);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const refresh = () => current?.ref && search(current.query, current.ref, current.label, true);

  const scan = async () => {
    setError(undefined);
    try {
      const code = await scanBarcode();
      if (!code) return;
      setTab('search');
      setResults([]);
      setBusy(true);
      setCurrent({ query: '', label: t('scan.lookup', { code }), pending: true });
      const amazon = config.sites.find((s) => s.id === 'amazon')!;
      const name = (await nameForBarcode(code)) ?? (await nameFromAmazon(code, (body) => parseResponse(amazon, body).listings));
      if (!name) {
        setBusy(false);
        setCurrent(undefined);
        setError(t('scan.notFound', { code }));
        return;
      }
      const ref = refFor(name);
      search(ref.mode === 'product' ? condenseTitle(name) : name, ref, name);
    } catch (e) {
      setBusy(false);
      setCurrent(undefined);
      setError(t('scan.failed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const watchCurrent = async () => {
    if (!current?.ref) return;
    const firstImage = results.find((r) => r.best?.image)?.best?.image;
    const refTitle = current.ref.mode === 'product' ? current.ref.text : undefined;
    setWatch(await addToWatch({ query: current.query, refTitle, title: current.label, image: firstImage }, results));
    ensureNotificationPermission();
  };

  const watchId = current?.ref && (current.ref.mode === 'product' ? current.ref.text : current.query).toLowerCase();
  const isWatched = !!watchId && watch.some((w) => w.id === watchId);
  const checked = results.map((r) => r.checkedAt).filter((x): x is number => !!x);
  const checkedAt = checked.length ? Math.min(...checked) : undefined;
  const membershipName = (id: string) => config.memberships.find((m) => m.id === id)?.name ?? id;

  return (
    <LangContext.Provider value={lang}>
      <div className="app">
        <header className="top">
          <div className="brand">
            Sasta<span>Kahan</span>
          </div>
          <div className="tagline">{t('tagline')}</div>
        </header>
        {update && (
          <button className="update-banner" onClick={() => openUrl(update.url)}>
            {t('update.banner', { v: update.version })} · <b>{t('update.download')}</b>
          </button>
        )}

        <main>
          {tab === 'search' && (
            <>
              <SearchBar
                value={input}
                onChange={setInput}
                onSubmit={(v) => search(v)}
                onScan={canScan() ? scan : undefined}
                suggestions={settings.suggestions}
                recent={recent}
              />

              {clip && (
                <div className="clip">
                  <span className="clip-text">📋 {t('clip.found')}</span>
                  <button
                    className="pill"
                    onClick={() => {
                      const link = clip;
                      dismissClip();
                      search(link);
                    }}
                  >
                    {t('clip.compare')}
                  </button>
                  <button className="link" onClick={dismissClip}>
                    {t('clip.dismiss')}
                  </button>
                </div>
              )}

              {!current && (
                <div className="intro">
                  {recent.length > 0 && (
                    <>
                      <div className="row between">
                        <span className="muted small">{t('search.recent')}</span>
                        <button className="link" onClick={async () => setRecent(await clearRecent())}>
                          {t('search.clear')}
                        </button>
                      </div>
                      <div className="chips">
                        {recent.map((r) => (
                          <button key={r.refTitle ?? r.query} className="chip" onClick={() => runRecent(r)}>
                            {r.refTitle ? '🎯 ' : ''}
                            {r.label.length > 48 ? `${r.label.slice(0, 46)}…` : r.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <ol className="how">
                    {(['how.1', 'how.2', 'how.3', ...(canScan() ? (['how.4'] as const) : [])] as const).map((k) => (
                      <li key={k}>
                        <Rich text={t(k)} />
                      </li>
                    ))}
                  </ol>
                  <div className="muted small">{t('search.try')}</div>
                  <div className="chips">
                    {EXAMPLES.map((q) => (
                      <button key={q} className="chip ghost" onClick={() => search(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {current && (
                <div className="current">
                  <div className="current-label">
                    {!current.pending && <span>{current.ref?.mode === 'product' ? t('current.comparing') : t('current.resultsFor')}</span>}
                    <b>{current.label}</b>
                    {busy && <span className="spinner" aria-label="loading" />}
                  </div>
                  {results.some((r) => r.best) && (
                    <div className="current-actions">
                      <button className="pill" onClick={watchCurrent} disabled={isWatched}>
                        {isWatched ? t('current.watching') : t('current.watch')}
                      </button>
                      <button className="pill" onClick={() => shareText(summaryText(current.label, results, t))}>
                        {t('current.share')}
                      </button>
                      {!busy && (
                        <button className="pill" onClick={refresh}>
                          {t('current.refresh')}
                        </button>
                      )}
                    </div>
                  )}
                  {!busy && checkedAt && <div className="muted small">{t('current.checked', { ago: ago(checkedAt, t) })}</div>}
                  {current.ref?.mode === 'query' && results.some((r) => r.best) && <div className="muted small">{t('current.tipExact')}</div>}
                </div>
              )}

              {error && <div className="error">{error}</div>}
              <Results results={results} query={current?.label ?? ''} wallet={wallet} version={version.version} membershipName={membershipName} onCompareExact={compareExact} />
            </>
          )}

          {tab === 'cards' && <Cards wallet={wallet} memberships={config.memberships} offersUpdated={config.offersUpdated} onChange={updateWallet} />}

          {tab === 'watch' && (
            <Watch
              items={watch}
              backgroundOn={settings.background}
              onCheck={async (it) => setWatch(await checkItem(it, expandWallet(wallet), lang))}
              onRemove={async (it) => setWatch(await removeFromWatch(it.id))}
              onOpen={(it) => search(it.query, it.refTitle ? makeReference(it.refTitle, 'product') : undefined, it.title)}
              onTarget={async (it, target) => setWatch(await updateWatchItem(it.id, { target }))}
            />
          )}

          {tab === 'more' && (
            <More
              settings={settings}
              onSettings={updateSettings}
              version={version}
              onRestored={async () => {
                setWallet(await loadWallet());
                setWatch(await loadWatch());
                setRecent(await loadRecent());
                setSettings(await loadSettings());
              }}
            />
          )}
        </main>

        <nav className="tabs">
          <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
            <span>🔍</span>
            {t('tab.compare')}
          </button>
          <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
            <span>💳</span>
            {t('tab.cards')}
            {wallet.cards.length + wallet.apps.length ? ` (${wallet.cards.length + wallet.apps.length})` : ''}
          </button>
          <button className={tab === 'watch' ? 'on' : ''} onClick={() => setTab('watch')}>
            <span>🔔</span>
            {t('tab.watch')}
            {watch.length ? ` (${watch.length})` : ''}
          </button>
          <button className={tab === 'more' ? 'on' : ''} onClick={() => setTab('more')}>
            <span>⚙️</span>
            {t('tab.more')}
          </button>
        </nav>
      </div>
    </LangContext.Provider>
  );
}
