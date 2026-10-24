import { useState, type FormEvent } from 'react';
import { isPincode, placeLabel, type UserLocation } from '../core/location.ts';
import { findPlaces, placeFromGps } from '../geo.ts';
import { useT } from '../i18n.ts';

interface Props {
  value?: UserLocation;
  onSave: (loc: UserLocation | undefined) => void;
  onClose: () => void;
}

/** Pick the delivery location: the phone's position, a pincode or an area name. */
export function LocationSheet({ value, onSave, onClose }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<'gps' | 'find'>();
  const [places, setPlaces] = useState<UserLocation[]>();
  const [msg, setMsg] = useState<string>();

  const useGps = async () => {
    setBusy('gps');
    setMsg(undefined);
    try {
      onSave(await placeFromGps());
      setPlaces(undefined);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg(m === 'denied' ? t('loc.denied') : t('loc.gpsFailed', { msg: m }));
    } finally {
      setBusy(undefined);
    }
  };

  const choose = (p: UserLocation) => {
    onSave(p);
    setPlaces(undefined);
    setText('');
  };

  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy('find');
    setMsg(undefined);
    const found = await findPlaces(text);
    setBusy(undefined);
    setPlaces(found);
    if (!found.length) setMsg(t('loc.none'));
    else if (found.length === 1) choose(found[0]);
  };

  const addPin = (e: FormEvent) => {
    e.preventDefault();
    if (!value || !isPincode(pin)) return;
    onSave({ ...value, pincode: pin.trim(), label: placeLabel({ ...value, pincode: pin.trim() }) });
    setPin('');
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('loc.title')} onClick={(e) => e.stopPropagation()}>
        <h3>{t('loc.title')}</h3>
        <p className="muted small">{t('loc.why')}</p>

        <button className="pill wide" onClick={useGps} disabled={!!busy}>
          {busy === 'gps' ? t('loc.finding') : t('loc.gps')}
        </button>

        <form className="loc-form" onSubmit={find}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('loc.placeholder')} enterKeyHint="search" aria-label={t('loc.placeholder')} />
          <button className="pill" disabled={!!busy || !text.trim()}>
            {busy === 'find' ? '…' : t('loc.find')}
          </button>
        </form>
        {msg && <div className="error small">{msg}</div>}

        {places && places.length > 1 && (
          <div className="places">
            {places.map((p) => (
              <button key={`${p.label}|${p.lat}`} className="place" onClick={() => choose(p)}>
                <span>{p.label}</span>
                {p.lat == null && <span className="muted small block">{t('loc.pinOnly')}</span>}
              </button>
            ))}
          </div>
        )}

        {value && (
          <div className="loc-current">
            <div>✓ {t('loc.saved', { place: value.label })}</div>
            {value.lat == null && <div className="muted small">{t('loc.pinOnly')}</div>}
            {!value.pincode && (
              <form className="loc-form" onSubmit={addPin}>
                <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="560034" aria-label={t('loc.addPin')} />
                <button className="pill" disabled={!isPincode(pin)}>
                  {t('loc.save')}
                </button>
              </form>
            )}
            {!value.pincode && <div className="muted small">{t('loc.addPin')}</div>}
            <button className="link danger" onClick={() => onSave(undefined)}>
              {t('loc.clear')}
            </button>
          </div>
        )}

        <button className="pill wide ghost" onClick={onClose}>
          {t('loc.done')}
        </button>
      </div>
    </div>
  );
}
