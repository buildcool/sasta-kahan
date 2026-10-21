import { useState } from 'react';
import type { WatchItem } from '../storage.ts';
import { rupees } from './format.ts';

interface Props {
  items: WatchItem[];
  onCheck: (it: WatchItem) => Promise<void>;
  onRemove: (it: WatchItem) => void;
  onOpen: (it: WatchItem) => void;
}

export function Watch({ items, onCheck, onRemove, onOpen }: Props) {
  const [busy, setBusy] = useState<string>();
  if (!items.length) {
    return (
      <div className="page">
        <h2>Watchlist</h2>
        <p className="muted">Search a product and tap “Watch price”. Whenever you open the app we re-check it, keep a price history, and notify you when it gets cheaper.</p>
      </div>
    );
  }
  return (
    <div className="page">
      <h2>Watchlist</h2>
      {items.map((it) => {
        const last = it.history.at(-1);
        const low = it.history.length ? Math.min(...it.history.map((h) => h.price)) : undefined;
        return (
          <div key={it.id} className="card watch">
            <button className="watch-title link" onClick={() => onOpen(it)}>
              {it.title}
            </button>
            <div className="watch-row">
              <div>
                <div className="price">{last ? rupees(last.price) : '—'}</div>
                <div className="muted small">{last ? `on ${last.site} · ${new Date(last.t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'not checked yet'}</div>
                {low !== undefined && last && low < last.price && <div className="muted small">Lowest seen {rupees(low)}</div>}
              </div>
              <Sparkline points={it.history.map((h) => h.price)} />
            </div>
            <div className="card-actions">
              <button
                className="link"
                disabled={busy === it.id}
                onClick={async () => {
                  setBusy(it.id);
                  await onCheck(it).finally(() => setBusy(undefined));
                }}
              >
                {busy === it.id ? 'Checking…' : 'Check now'}
              </button>
              <button className="link danger" onClick={() => onRemove(it)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="spark-empty muted small">History builds up as we re-check</div>;
  const w = 120;
  const h = 36;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const y = (p: number) => (max === min ? h / 2 : h - 3 - ((p - min) / (max - min)) * (h - 6));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * (w - 4) + 2).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const down = points.at(-1)! < points[0];
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Price history">
      <path d={d} fill="none" stroke={down ? 'var(--good)' : 'var(--muted)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
