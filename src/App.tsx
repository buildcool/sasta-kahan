import { App as CapApp } from '@capacitor/app';
import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshConfig } from './core/config.ts';
import { repriceForCards, resolveInput, runSearch } from './core/engine.ts';
import { condenseTitle, makeReference, type Reference } from './core/matcher.ts';
import type { ScoredListing, SiteResult, UserCard } from './core/types.ts';
import { ensureNotificationPermission, onSharedText, shareText } from './native.ts';
import { addRecent, loadCards, loadRecent, loadWatch, saveCards, type WatchItem } from './storage.ts';
import { Cards, expandCards } from './ui/Cards.tsx';
import { summaryText } from './ui/format.ts';
import { Results } from './ui/Results.tsx';
import { Watch } from './ui/Watch.tsx';
import { addToWatch, checkItem, checkStale, removeFromWatch } from './watch.ts';

type Tab = 'search' | 'cards' | 'watch';

interface Current {
  query: string;
  label: string;
  ref: Reference;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const [input, setInput] = useState('');
  const [current, setCurrent] = useState<Current>();
  const [results, setResults] = useState<SiteResult[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<UserCard[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const abort = useRef<AbortController>(undefined);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const search = useCallback(async (text: string, ref?: Reference, label?: string) => {
    if (!text.trim()) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setTab('search');
    setError(undefined);
    setBusy(true);
    setResults([]);
    try {
      const resolved = ref ? { query: text, ref } : await resolveInput(text);
      const shown = label ?? (resolved.ref.mode === 'product' ? resolved.ref.text : resolved.query);
      setCurrent({ query: resolved.query, ref: resolved.ref, label: shown });
      setInput(resolved.ref.mode === 'product' ? '' : resolved.query);
      setRecent(await addRecent(resolved.query));
      await runSearch({
        query: resolved.query,
        ref: resolved.ref,
        cards: expandCards(cardsRef.current),
        onUpdate: (r) => !ctrl.signal.aborted && setResults(r),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadCards().then(setCards);
    loadRecent().then(setRecent);
    loadWatch().then(setWatch);
    refreshConfig();
    let cleanup = () => {};
    onSharedText((t) => search(t)).then((c) => (cleanup = c));
    // Re-check stale watch items on open and whenever the app comes back to the foreground.
    const recheck = () => loadCards().then((c) => checkStale(expandCards(c)).then(setWatch));
    recheck();
    const sub = CapApp.addListener('resume', recheck).catch(() => undefined);
    return () => {
      cleanup();
      sub.then((h) => h?.remove());
    };
  }, [search]);

  const updateCards = (c: UserCard[]) => {
    setCards(c);
    saveCards(c);
    setResults((r) => repriceForCards(r, expandCards(c)));
  };

  const compareExact = (l: ScoredListing) => {
    search(condenseTitle(l.title), makeReference(l.title, 'product'), l.title);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const watchCurrent = async () => {
    if (!current) return;
    const firstImage = results.find((r) => r.best?.image)?.best?.image;
    setWatch(
      await addToWatch(
        { query: current.query, refTitle: current.ref.mode === 'product' ? current.ref.text : undefined, title: current.label, image: firstImage },
        results,
      ),
    );
    ensureNotificationPermission();
  };

  const isWatched = current && watch.some((w) => w.id === (current.ref.mode === 'product' ? current.ref.text : current.query).toLowerCase());

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          Sasta<span>Kahan</span>
        </div>
        <div className="tagline">Ek search, sab sites, best card offer</div>
      </header>

      <main>
        {tab === 'search' && (
          <>
            <form
              className="searchbar"
              onSubmit={(e) => {
                e.preventDefault();
                search(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Product name or paste a link"
                enterKeyHint="search"
                autoCapitalize="off"
              />
              <button type="submit" disabled={!input.trim()}>
                Compare
              </button>
            </form>

            {!current && (
              <div className="intro">
                {recent.length > 0 && (
                  <>
                    <div className="muted small">Recent</div>
                    <div className="chips">
                      {recent.map((q) => (
                        <button key={q} className="chip" onClick={() => search(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <ol className="how">
                  <li>
                    Type a product, <b>or</b> in Amazon/Flipkart tap <b>Share → SastaKahan</b>.
                  </li>
                  <li>We check Amazon, Flipkart, Nykaa, Myntra, Meesho, Ajio, Tata CLiQ, Croma, Reliance Digital… from your phone.</li>
                  <li>
                    Add your cards in <b>My Cards</b> to see the price after bank offers.
                  </li>
                </ol>
                <div className="chips">
                  {['lakme sunscreen spf 50', 'boat airdopes 141', 'iphone 15 128gb', 'nivea soft cream 100ml'].map((q) => (
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
                  {current.ref.mode === 'product' ? 'Comparing' : 'Results for'} <b>{current.label}</b>
                  {busy && <span className="spinner" aria-label="loading" />}
                </div>
                {results.some((r) => r.best) && (
                  <div className="current-actions">
                    <button className="pill" onClick={watchCurrent} disabled={isWatched}>
                      {isWatched ? '✓ Watching' : '🔔 Watch price'}
                    </button>
                    <button className="pill" onClick={() => shareText(summaryText(current.label, results))}>
                      Share
                    </button>
                  </div>
                )}
                {current.ref.mode === 'query' && results.some((r) => r.best) && (
                  <div className="muted small">Many products match? Tap “Find exactly this everywhere” on the one you want.</div>
                )}
              </div>
            )}

            {error && <div className="error">{error}</div>}
            <Results results={results} hasCards={cards.length > 0} onCompareExact={compareExact} />
          </>
        )}

        {tab === 'cards' && <Cards cards={cards} onChange={updateCards} />}

        {tab === 'watch' && (
          <Watch
            items={watch}
            onCheck={async (it) => setWatch(await checkItem(it, expandCards(cards)))}
            onRemove={async (it) => setWatch(await removeFromWatch(it.id))}
            onOpen={(it) => search(it.query, it.refTitle ? makeReference(it.refTitle, 'product') : undefined, it.title)}
          />
        )}
      </main>

      <nav className="tabs">
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
          <span>🔍</span>Compare
        </button>
        <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
          <span>💳</span>My Cards{cards.length ? ` (${cards.length})` : ''}
        </button>
        <button className={tab === 'watch' ? 'on' : ''} onClick={() => setTab('watch')}>
          <span>🔔</span>Watchlist{watch.length ? ` (${watch.length})` : ''}
        </button>
      </nav>
    </div>
  );
}
