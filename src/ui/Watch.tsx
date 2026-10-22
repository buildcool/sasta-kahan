import { useState } from 'react';
import { priceStats, type PricePoint, type WatchItem } from '../core/watchLogic.ts';
import { useT } from '../i18n.ts';
import { rupees, shortDate } from './format.ts';

interface Props {
  items: WatchItem[];
  backgroundOn: boolean;
  onCheck: (it: WatchItem) => Promise<void>;
  onRemove: (it: WatchItem) => void;
  onOpen: (it: WatchItem) => void;
  onTarget: (it: WatchItem, target: number | undefined) => void;
}

export function Watch({ items, backgroundOn, onCheck, onRemove, onOpen, onTarget }: Props) {
  const t = useT();
  if (!items.length) {
    return (
      <div className="page">
        <h2>{t('watch.title')}</h2>
        <p className="muted">{t('watch.empty')}</p>
      </div>
    );
  }
  return (
    <div className="page">
      <h2>{t('watch.title')}</h2>
      {!backgroundOn && <p className="muted small">{t('watch.bgOff')}</p>}
      {items.map((it) => (
        <WatchCard key={it.id} it={it} onCheck={onCheck} onRemove={onRemove} onOpen={onOpen} onTarget={onTarget} />
      ))}
      <p className="muted small">{t('watch.note')}</p>
    </div>
  );
}

function WatchCard({ it, onCheck, onRemove, onOpen, onTarget }: Omit<Props, 'items' | 'backgroundOn'> & { it: WatchItem }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(it.target ? String(it.target) : '');
  // Older points stored the after-card price; chart the site prices once there are enough of them.
  const v2 = it.history.filter((h) => h.v === 2);
  const points = v2.length >= 2 ? v2 : it.history;
  const last = it.history.at(-1);
  const stats = priceStats(it.history);
  const low = points.length ? Math.min(...points.map((h) => h.price)) : undefined;

  const saveTarget = () => {
    const n = Number(val.replace(/[^\d.]/g, ''));
    onTarget(it, n > 0 ? n : undefined);
    setEditing(false);
  };

  return (
    <div className="card watch">
      <button className="watch-title link" onClick={() => onOpen(it)}>
        {it.title}
      </button>
      <div className="watch-row">
        <div>
          <div className="price">{last ? rupees(last.price) : '—'}</div>
          <div className="muted small">{last ? t('watch.on', { site: last.site, date: shortDate(last.t) }) : t('watch.notChecked')}</div>
          {low !== undefined && last && low < last.price && <div className="muted small">{t('watch.lowest', { price: rupees(low) })}</div>}
        </div>
        {stats && <span className={`badge deal-${stats.deal}`}>{t(`watch.deal.${stats.deal}`)}</span>}
      </div>
      {it.inStock === false && <div className="badge badge-bad inline">{t('watch.oos')}</div>}
      <Chart points={points} target={it.target} />
      {stats && <div className="muted small">{t('watch.stats', { low: rupees(stats.low), avg: rupees(stats.avg), high: rupees(stats.high) })}</div>}

      {editing ? (
        <form
          className="target-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveTarget();
          }}
        >
          <label>
            {t('watch.target')}
            <input inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
          </label>
          <button className="pill" type="submit">
            {t('watch.targetSave')}
          </button>
        </form>
      ) : (
        <div className="card-actions">
          <button className="link" onClick={() => setEditing(true)}>
            {it.target ? t('watch.targetSet', { price: rupees(it.target) }) : `🎯 ${t('watch.target').replace(/\s*₹$/, '')}`}
          </button>
          {it.target && (
            <button className="link" onClick={() => onTarget(it, undefined)}>
              {t('watch.targetClear')}
            </button>
          )}
        </div>
      )}

      <div className="card-actions">
        <button
          className="link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onCheck(it).finally(() => setBusy(false));
          }}
        >
          {busy ? t('watch.checking') : t('watch.check')}
        </button>
        <button className="link danger" onClick={() => onRemove(it)}>
          {t('watch.remove')}
        </button>
      </div>
    </div>
  );
}

/** Price over time, with the target as a dashed line. */
function Chart({ points, target }: { points: PricePoint[]; target?: number }) {
  const t = useT();
  if (points.length < 2) return <div className="spark-empty muted small">{t('watch.history')}</div>;
  const w = 300;
  const h = 70;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices, target ?? Infinity);
  const max = Math.max(...prices);
  const y = (p: number) => (max === min ? h / 2 : h - 6 - ((p - min) / (max - min)) * (h - 12));
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const down = prices.at(-1)! < prices[0];
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Price history">
      {target !== undefined && target >= min && target <= max && (
        <line x1="0" x2={w} y1={y(target)} y2={y(target)} stroke="var(--warn)" strokeDasharray="4 4" strokeWidth="1" />
      )}
      <path d={d} fill="none" stroke={down ? 'var(--good)' : 'var(--brand)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(prices.at(-1)!)} r="3" fill={down ? 'var(--good)' : 'var(--brand)'} />
    </svg>
  );
}
