import { useState } from 'react';
import { offerApplies } from '../core/effectivePrice.ts';
import type { ScoredListing, SiteResult, Wallet } from '../core/types.ts';
import { useT } from '../i18n.ts';
import { openInApp } from '../native.ts';
import { discountPct, keepaUrl, offerNotes, offerShort, payWith, reportUrl, rupees, statusText } from './format.ts';

type SortBy = 'best' | 'list' | 'rating';

interface Props {
  results: SiteResult[];
  query: string;
  wallet: Wallet;
  version: string;
  membershipName: (id: string) => string;
  onCompareExact: (l: ScoredListing) => void;
  /** Open the delivery-location picker (quick-commerce sites need it). */
  onSetLocation?: () => void;
}

const finalPrice = (r: SiteResult) => r.best!.effective?.mine ?? r.best!.price;

export function Results({ results, query, wallet, version, membershipName, onCompareExact, onSetLocation }: Props) {
  const t = useT();
  const [sortBy, setSortBy] = useState<SortBy>('best');
  const [onlySame, setOnlySame] = useState(false);
  const [hideOos, setHideOos] = useState(false);
  const [onlyQuick, setOnlyQuick] = useState(false);

  const found = results.filter((r) => r.status === 'ok' && r.best);
  // The winner must be buyable and believable: in stock, not a suspiciously low outlier.
  const winner = found.find((r) => r.best!.inStock !== false && !r.outlier);
  const w = winner?.best;
  // Only compare like with like: a "similar" item elsewhere isn't a saving on this product.
  const peers = w ? found.filter((r) => r.best!.match === w.match && r.best!.inStock !== false && !r.outlier) : [];
  const costliest = peers.length > 1 ? Math.max(...peers.map(finalPrice)) : undefined;
  const hasWallet = wallet.cards.length + wallet.apps.length + wallet.memberships.length > 0;

  let shown = found.filter((r) => (!onlySame || r.best!.match === 'exact') && (!hideOos || r.best!.inStock !== false) && (!onlyQuick || r.site.quick));
  if (sortBy === 'list') shown = [...shown].sort((a, b) => a.best!.price - b.best!.price);
  if (sortBy === 'rating') shown = [...shown].sort((a, b) => (b.best!.rating ?? 0) - (a.best!.rating ?? 0) || (b.best!.ratingCount ?? 0) - (a.best!.ratingCount ?? 0));
  const hidden = found.length - shown.length;

  const nomatch = results.filter((r) => r.status === 'nomatch');
  const rest = results.filter((r) => r.status !== 'ok' && r.status !== 'nomatch');
  const loading = results.filter((r) => r.status === 'loading').length;
  const needLocation = rest.filter((r) => r.error === 'needs-location').map((r) => r.site.name);

  return (
    <div className="results">
      {w && winner && (
        <div className={`winner ${w.match === 'exact' ? '' : 'winner-similar'}`}>
          <div className="winner-label">{w.match === 'exact' ? t('res.cheapest') : t('res.cheapestSimilar')}</div>
          <div className="winner-row">
            <span className="winner-site">{winner.site.name}</span>
            <span className="winner-price">{rupees(finalPrice(winner))}</span>
          </div>
          {w.effective?.coupon && <div className="winner-sub">{t('res.afterCoupon', { price: rupees(w.price) })}</div>}
          {w.effective?.mineOffer && w.effective.mine < w.effective.base && (
            <div className="winner-sub">{t('res.afterOffer', { price: rupees(w.effective.base), offer: payWith(w.effective.mineOffer, t) })}</div>
          )}
          {!!w.effective?.mineLater && (
            <div className="winner-sub">{t('res.later', { now: rupees(w.effective.mine + w.effective.mineLater), later: rupees(w.effective.mineLater) })}</div>
          )}
          {!!w.effective?.fees && <div className="winner-sub">{t('res.fees', { fee: rupees(w.effective.fees) })}</div>}
          {costliest !== undefined && costliest > finalPrice(winner) && (
            <div className="winner-sub">{t('res.saves', { amount: rupees(costliest - finalPrice(winner)) })}</div>
          )}
          {!hasWallet && <div className="winner-hint">{t('res.addCards')}</div>}
        </div>
      )}

      {found.length > 1 && (
        <div className="controls">
          <label className="sort">
            {t('res.sort')}
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="best">{t('sort.best')}</option>
              <option value="list">{t('sort.list')}</option>
              <option value="rating">{t('sort.rating')}</option>
            </select>
          </label>
          <button className={`chip small ${onlySame ? 'on' : ''}`} onClick={() => setOnlySame(!onlySame)}>
            {t('res.onlySame')}
          </button>
          {found.some((r) => r.best!.inStock === false) && (
            <button className={`chip small ${hideOos ? 'on' : ''}`} onClick={() => setHideOos(!hideOos)}>
              {t('res.hideOos')}
            </button>
          )}
          {found.some((r) => r.site.quick) && found.some((r) => !r.site.quick) && (
            <button className={`chip small ${onlyQuick ? 'on' : ''}`} onClick={() => setOnlyQuick(!onlyQuick)}>
              {t('res.quickOnly')}
            </button>
          )}
        </div>
      )}

      {shown.map((r) => (
        <SiteCard
          key={r.site.id}
          r={r}
          isWinner={r === winner}
          query={query}
          wallet={wallet}
          version={version}
          membershipName={membershipName}
          onCompareExact={onCompareExact}
        />
      ))}
      {hidden > 0 && <div className="muted small center">{t('res.hidden', { n: hidden })}</div>}

      {loading > 0 && found.length === 0 && <div className="skeleton">{t('res.checking', { n: loading })}</div>}

      {nomatch.length > 0 && (
        <div className="manual">
          <div className="manual-title">{t('res.noMatchTitle')}</div>
          {nomatch.map((r) => (
            <NoMatchRow key={r.site.id} r={r} onCompareExact={onCompareExact} />
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div className="manual">
          <div className="manual-title">{t('res.manualTitle')}</div>
          {needLocation.length > 0 && onSetLocation && (
            <div className="need-loc">
              <span>{t('res.needLocation', { sites: needLocation.join(', ') })}</span>
              <button className="pill" onClick={onSetLocation}>
                {t('res.setLocation')}
              </button>
            </div>
          )}
          {rest.map((r) => (
            <a key={r.site.id} className={`manual-row status-${r.status}`} href={r.manualUrl} target="_blank" rel="noreferrer">
              <span className="site-dot" data-site={r.site.id}>
                {r.site.name[0]}
              </span>
              <span className="manual-name">{r.site.name}</span>
              <span className="manual-status">{statusText(r, t)}</span>
              <span className="manual-go">{t('res.open')}</span>
            </a>
          ))}
        </div>
      )}

      {found.length > 0 && <p className="fineprint">{t('res.fineprint')}</p>}
    </div>
  );
}

function NoMatchRow({ r, onCompareExact }: { r: SiteResult; onCompareExact: (l: ScoredListing) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const closest = [...r.listings].sort((a, b) => b.score - a.score).slice(0, 3);
  return (
    <div className="manual-row column">
      <div className="row">
        <span className="site-dot" data-site={r.site.id}>
          {r.site.name[0]}
        </span>
        <span className="manual-name">{r.site.name}</span>
        <span className="manual-status">{statusText(r, t)}</span>
        {closest.length > 0 && (
          <button className="link" onClick={() => setOpen(!open)}>
            {open ? t('card.hide') : t('res.show')}
          </button>
        )}
        <a className="manual-go" href={r.manualUrl} target="_blank" rel="noreferrer">
          {t('res.open')}
        </a>
      </div>
      {open &&
        closest.map((l) => (
          <div key={l.url} className="other">
            <a href={l.url} target="_blank" rel="noreferrer" className="other-title">
              {l.title}
            </a>
            <div className="other-row">
              <span>{rupees(l.price)}</span>
              <button className="link" onClick={() => onCompareExact(l)}>
                {t('card.compareThis')}
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

interface CardProps {
  r: SiteResult;
  isWinner: boolean;
  query: string;
  wallet: Wallet;
  version: string;
  membershipName: (id: string) => string;
  onCompareExact: (l: ScoredListing) => void;
}

function SiteCard({ r, isWinner, query, wallet, version, membershipName, onCompareExact }: CardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const b = r.best!;
  const eff = b.effective;
  const off = discountPct(b.price, b.mrp);
  const others = r.listings
    .filter((l) => l.match !== 'different' && l.url !== b.url)
    .sort((x, y) => y.score - x.score || x.price - y.price)
    .slice(0, 6);
  const offers = r.offers ?? [];
  const keepa = r.site.id === 'amazon' ? keepaUrl(b.url) : undefined;
  const report = reportUrl(r, query, version);
  const why = b.why;
  const moreLabel = [offers.length ? t('card.offers', { n: offers.length }) : '', others.length ? t('card.options', { n: others.length }) : '', why ? t('card.why') : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`card ${isWinner ? 'card-best' : ''} ${b.inStock === false || r.outlier ? 'card-dim' : ''}`}>
      <div className="card-head">
        <span className="site-dot" data-site={r.site.id}>
          {r.site.name[0]}
        </span>
        <span className="card-site">{r.site.name}</span>
        {b.match !== 'exact' && <span className={`badge badge-${b.match}`}>{t(`match.${b.match}` as 'match.similar')}</span>}
        {r.site.quick && (b.eta ?? r.site.eta) && <span className="badge badge-quick">{t('badge.quick', { eta: b.eta ?? r.site.eta! })}</span>}
        {b.inStock === false && <span className="badge badge-bad">{t('badge.oos')}</span>}
        {r.outlier && <span className="badge badge-bad">{t('badge.outlier')}</span>}
        {isWinner && <span className="badge badge-best">{t('badge.cheapest')}</span>}
      </div>

      <a className="card-body" href={b.url} target="_blank" rel="noreferrer">
        {b.image ? <img className="thumb" src={b.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="thumb" />}
        <div className="card-info">
          <div className="card-title">{b.title}</div>
          <div className="price-row">
            <span className="price">{rupees(b.price)}</span>
            {b.mrp && off > 0 && <span className="mrp">{rupees(b.mrp)}</span>}
            {off > 0 && <span className="off">{off}% off</span>}
          </div>
          {b.coupon && (
            <div className="coupon" title={b.coupon.text}>
              🏷 {t('card.coupon', { price: rupees(b.coupon.price) })}
            </div>
          )}
          {b.unitPrice && (
            <div className="unit">
              {rupees(b.unitPrice.value)} / {b.unitPrice.per}
            </div>
          )}
          {b.rating ? (
            <div className="rating">
              ★ {b.rating.toFixed(1)}
              {b.ratingCount ? ` · ${t('card.ratings', { n: b.ratingCount.toLocaleString('en-IN') })}` : ''}
            </div>
          ) : null}
        </div>
      </a>

      {eff && eff.mineOffer && eff.mine < eff.base && (
        <div className="eff eff-mine">
          <b>{rupees(eff.mine)}</b> {t('card.withYour', { offer: offerShort(eff.mineOffer, t) })}
          {eff.mineLater > 0 && <div className="small muted">{t('res.later', { now: rupees(eff.mine + eff.mineLater), later: rupees(eff.mineLater) })}</div>}
        </div>
      )}
      {eff && eff.anyOffer && eff.any < eff.mine && <div className="eff eff-any">{t('card.withAny', { price: rupees(eff.any), offer: offerShort(eff.anyOffer, t) })}</div>}
      {eff && eff.fees > 0 && (
        <div className="eff eff-any" title={r.site.fees?.note}>
          {t('res.fees', { fee: rupees(eff.fees) })}
        </div>
      )}

      {moreLabel && (
        <button className="more" onClick={() => setOpen(!open)}>
          {open ? t('card.hide') : moreLabel}
        </button>
      )}

      {open && (
        <div className="expand">
          {why && (
            <div className="why">
              {why.found.length > 0 && <div>✓ {t('why.found', { words: why.found.join(', ') })}</div>}
              {why.missing.length > 0 && <div>✗ {t('why.missing', { words: why.missing.join(', ') })}</div>}
              {why.size !== 'none' && (
                <div>
                  {why.size === 'same' ? '✓' : '⚠'} {t(`why.size.${why.size}` as 'why.size.same')}
                </div>
              )}
              {why.variant && <div>⚠ {t('why.variant', { word: why.variant })}</div>}
            </div>
          )}
          {offers.length > 0 && (
            <ul className="offer-list">
              {offers.map((o, i) => (
                <li key={i}>
                  <b>{offerShort(o, t)}</b>
                  {offerApplies(o, wallet) && <span className="tag tag-good">{t('card.yours')}</span>}
                  {offerNotes(o, t, membershipName).map((n) => (
                    <span key={n} className="tag">
                      {n}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {r.site.fees?.note && <div className="small muted">{r.site.fees.note}</div>}
          {others.map((l) => (
            <div key={l.url} className="other">
              <a href={l.url} target="_blank" rel="noreferrer" className="other-title">
                {l.title}
              </a>
              <div className="other-row">
                <span>{rupees(l.price)}</span>
                {l.unitPrice && (
                  <span className="unit">
                    {rupees(l.unitPrice.value)}/{l.unitPrice.per}
                  </span>
                )}
                <button className="link" onClick={() => onCompareExact(l)}>
                  {t('card.compareThis')}
                </button>
              </div>
            </div>
          ))}
          <div className="card-actions">
            {keepa && (
              <a className="link" href={keepa} target="_blank" rel="noreferrer">
                {t('card.history')}
              </a>
            )}
            {report && (
              <a className="link danger" href={report} target="_blank" rel="noreferrer">
                {t('card.report')}
              </a>
            )}
          </div>
        </div>
      )}

      <div className="card-actions">
        <button className="link" onClick={() => onCompareExact(b)}>
          {t('card.exact')}
        </button>
        <button className="link" onClick={() => openInApp(b.url, r.site.app)}>
          {t('card.openApp')}
        </button>
      </div>
    </div>
  );
}
