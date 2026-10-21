import { useState } from 'react';
import type { ScoredListing, SiteResult } from '../core/types.ts';
import { STATUS_TEXT, bankName, discountPct, offerShort, rupees } from './format.ts';

interface Props {
  results: SiteResult[];
  hasCards: boolean;
  onCompareExact: (l: ScoredListing) => void;
}

const MATCH_TEXT = { exact: 'Same product', similar: 'Similar — check name', size: 'Different size', different: '' } as const;

export function Results({ results, hasCards, onCompareExact }: Props) {
  const found = results.filter((r) => r.best);
  const rest = results.filter((r) => !r.best);
  const cheapest = found[0]?.best;
  // Only compare like with like: a "similar" item elsewhere isn't a saving on this product.
  const peers = found.filter((r) => r.best!.match === cheapest?.match);
  const costliest = peers.length > 1 ? Math.max(...peers.map((r) => r.best!.effective?.mine ?? r.best!.price)) : undefined;
  const loading = results.some((r) => r.status === 'loading');

  return (
    <div className="results">
      {cheapest && (
        <div className="winner">
          <div className="winner-label">Sabse sasta</div>
          <div className="winner-row">
            <span className="winner-site">{found[0].site.name}</span>
            <span className="winner-price">{rupees(cheapest.effective?.mine ?? cheapest.price)}</span>
          </div>
          {cheapest.effective?.mineOffer && cheapest.effective.mine < cheapest.price && (
            <div className="winner-sub">
              {rupees(cheapest.price)} − your {bankName(cheapest.effective.mineOffer)} offer
            </div>
          )}
          {costliest && costliest > (cheapest.effective?.mine ?? cheapest.price) && (
            <div className="winner-sub">
              Saves {rupees(costliest - (cheapest.effective?.mine ?? cheapest.price))} vs the costliest site
            </div>
          )}
          {!hasCards && <div className="winner-hint">Add your cards in “My Cards” to see prices after bank offers.</div>}
        </div>
      )}

      {found.map((r, i) => (
        <SiteCard key={r.site.id} r={r} rank={i} onCompareExact={onCompareExact} />
      ))}

      {loading && found.length === 0 && <div className="skeleton">Checking {results.filter((r) => r.status === 'loading').length} sites…</div>}

      {rest.length > 0 && (
        <div className="manual">
          <div className="manual-title">Check these yourself</div>
          {rest.map((r) => (
            <a key={r.site.id} className={`manual-row status-${r.status}`} href={r.manualUrl} target="_blank" rel="noreferrer">
              <span className="site-dot" data-site={r.site.id}>{r.site.name[0]}</span>
              <span className="manual-name">{r.site.name}</span>
              <span className="manual-status">{STATUS_TEXT[r.status]}</span>
              <span className="manual-go">Open →</span>
            </a>
          ))}
        </div>
      )}

      {found.length > 0 && <p className="fineprint">Prices and offers as shown on each site right now. Bank offers can change at checkout; card cashback is credited later.</p>}
    </div>
  );
}

function SiteCard({ r, rank, onCompareExact }: { r: SiteResult; rank: number; onCompareExact: (l: ScoredListing) => void }) {
  const [open, setOpen] = useState(false);
  const b = r.best!;
  const eff = b.effective;
  const off = discountPct(b.price, b.mrp);
  const others = r.listings
    .filter((l) => l.match !== 'different' && l.url !== b.url)
    .sort((x, y) => y.score - x.score || x.price - y.price)
    .slice(0, 6);
  const offers = r.offers ?? [];

  return (
    <div className={`card ${rank === 0 ? 'card-best' : ''}`}>
      <div className="card-head">
        <span className="site-dot" data-site={r.site.id}>{r.site.name[0]}</span>
        <span className="card-site">{r.site.name}</span>
        {b.match !== 'exact' && <span className={`badge badge-${b.match}`}>{MATCH_TEXT[b.match]}</span>}
        {rank === 0 && <span className="badge badge-best">Cheapest</span>}
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
          {b.unitPrice && (
            <div className="unit">
              {rupees(b.unitPrice.value)} / {b.unitPrice.per}
            </div>
          )}
          {b.rating ? <div className="rating">★ {b.rating.toFixed(1)}</div> : null}
        </div>
      </a>

      {eff && eff.mine < eff.price && eff.mineOffer && (
        <div className="eff eff-mine">
          <b>{rupees(eff.mine)}</b> with your {bankName(eff.mineOffer)} · {offerShort(eff.mineOffer)}
        </div>
      )}
      {eff && eff.any < eff.mine && eff.anyOffer && (
        <div className="eff eff-any">
          {rupees(eff.any)} with {offerShort(eff.anyOffer)}
        </div>
      )}

      {(others.length > 0 || offers.length > 0) && (
        <button className="more" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : `${offers.length ? `${offers.length} bank offers` : ''}${offers.length && others.length ? ' · ' : ''}${others.length ? `${others.length} more options` : ''}`}
        </button>
      )}

      {open && (
        <div className="expand">
          {offers.length > 0 && (
            <ul className="offer-list">
              {offers.map((o, i) => (
                <li key={i}>
                  <b>{offerShort(o)}</b>
                  {o.cap ? ` · max ${rupees(o.cap)}` : ''}
                  {o.minOrder ? ` · min order ${rupees(o.minOrder)}` : ''}
                  {o.emiOnly ? ' · EMI only' : ''}
                  {o.source === 'config' && <span className="tag">card benefit</span>}
                </li>
              ))}
            </ul>
          )}
          {others.map((l) => (
            <div key={l.url} className="other">
              <a href={l.url} target="_blank" rel="noreferrer" className="other-title">
                {l.title}
              </a>
              <div className="other-row">
                <span>{rupees(l.price)}</span>
                {l.unitPrice && <span className="unit">{rupees(l.unitPrice.value)}/{l.unitPrice.per}</span>}
                <button className="link" onClick={() => onCompareExact(l)}>
                  Compare this one
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card-actions">
        <button className="link" onClick={() => onCompareExact(b)}>
          Find exactly this everywhere
        </button>
      </div>
    </div>
  );
}
