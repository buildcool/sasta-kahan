import { useEffect, useRef, useState } from 'react';
import { fetchText } from '../core/fetcher.ts';
import { useT } from '../i18n.ts';
import type { Recent } from '../storage.ts';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onScan?: () => void;
  /** Ask Amazon for suggestions while typing (setting). */
  suggestions: boolean;
  recent: Recent[];
}

const SUGGEST_URL = 'https://www.amazon.in/suggestions?limit=8&alias=aps&mid=A21TJRUUN4KGV&prefix=';

export function SearchBar({ value, onChange, onSubmit, onScan, suggestions, recent }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (!open || q.length < 2 || /https?:\/\//i.test(q)) {
      setItems([]);
      return;
    }
    const mine = recent
      .filter((r) => r.label.toLowerCase().includes(q.toLowerCase()))
      .map((r) => r.label)
      .slice(0, 3);
    setItems(mine);
    if (!suggestions) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetchText({ url: SUGGEST_URL + encodeURIComponent(q), method: 'GET', headers: { Accept: 'application/json' } });
        if (n !== seq.current || res.status !== 200) return;
        const remote = ((JSON.parse(res.body) as { suggestions?: { value: string }[] }).suggestions ?? []).map((s) => s.value);
        setItems([...new Set([...mine, ...remote])].slice(0, 8));
      } catch {
        // offline: recent searches only
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [value, open, suggestions, recent]);

  const pick = (s: string) => {
    onChange(s);
    setOpen(false);
    onSubmit(s);
  };

  return (
    <form
      className="searchbar"
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        onSubmit(value);
      }}
    >
      <div className="search-field">
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t('search.placeholder')}
          enterKeyHint="search"
          autoCapitalize="off"
          autoComplete="off"
        />
        {onScan && (
          <button type="button" className="scan" onClick={onScan} aria-label={t('search.scan')} title={t('search.scan')}>
            📷
          </button>
        )}
        {open && items.length > 0 && (
          <ul className="suggest" role="listbox">
            {items.map((s) => (
              <li key={s}>
                {/* mousedown keeps the input focused so the list doesn't close before the tap lands */}
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit" disabled={!value.trim()}>
        {t('search.go')}
      </button>
    </form>
  );
}
