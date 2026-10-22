import type { Membership } from '../core/config.ts';
import { BANKS, COBRANDS, PAY_APPS } from '../core/offers.ts';
import type { UserCard, Wallet } from '../core/types.ts';
import { useT } from '../i18n.ts';
import { shortDate } from './format.ts';

interface Props {
  wallet: Wallet;
  memberships: Membership[];
  offersUpdated?: string;
  onChange: (w: Wallet) => void;
}

const key = (c: UserCard) => `${c.bank}:${c.type}:${c.card ?? ''}`;
const toggled = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function Cards({ wallet, memberships, offersUpdated, onChange }: Props) {
  const t = useT();
  const cards = wallet.cards;
  const has = (c: UserCard) => cards.some((x) => key(x) === key(c));
  const toggle = (c: UserCard) => onChange({ ...wallet, cards: has(c) ? cards.filter((x) => key(x) !== key(c)) : [...cards, c] });

  return (
    <div className="page">
      <h2>{t('cards.title')}</h2>
      <p className="muted">{t('cards.intro')}</p>

      <h3>{t('cards.cobrand')}</h3>
      <div className="chips">
        {COBRANDS.map((c) => {
          const card: UserCard = { bank: c.bank, type: 'credit', card: c.id };
          return (
            <button key={c.id} className={`chip ${has(card) ? 'on' : ''}`} onClick={() => toggle(card)}>
              {c.name}
            </button>
          );
        })}
      </div>

      <h3>{t('cards.upi')}</h3>
      <p className="muted small">{t('cards.upiHint')}</p>
      <div className="chips">
        {PAY_APPS.map((a) => (
          <button key={a.id} className={`chip ${wallet.apps.includes(a.id) ? 'on' : ''}`} onClick={() => onChange({ ...wallet, apps: toggled(wallet.apps, a.id) })}>
            {a.name}
          </button>
        ))}
        <button className={`chip ${wallet.apps.includes('rupay') ? 'on' : ''}`} onClick={() => onChange({ ...wallet, apps: toggled(wallet.apps, 'rupay') })}>
          {t('offer.rupay')}
        </button>
      </div>

      {memberships.length > 0 && (
        <>
          <h3>{t('cards.member')}</h3>
          <p className="muted small">{t('cards.memberHint')}</p>
          <div className="chips">
            {memberships.map((m) => (
              <button
                key={m.id}
                className={`chip ${wallet.memberships.includes(m.id) ? 'on' : ''}`}
                onClick={() => onChange({ ...wallet, memberships: toggled(wallet.memberships, m.id) })}
              >
                {m.name}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="toggle">
        <input type="checkbox" checked={wallet.newUser} onChange={(e) => onChange({ ...wallet, newUser: e.target.checked })} />
        <span>
          {t('cards.newUser')}
          <span className="muted small block">{t('cards.newUserHint')}</span>
        </span>
      </label>

      <h3>{t('cards.banks')}</h3>
      <div className="bank-grid">
        {BANKS.map((b) => (
          <div key={b.id} className="bank-row">
            <span className="bank-name">{b.name}</span>
            {(['credit', 'debit'] as const).map((type) => {
              const card: UserCard = { bank: b.id, type };
              return (
                <button key={type} className={`chip small ${has(card) ? 'on' : ''}`} onClick={() => toggle(card)}>
                  {t(type === 'credit' ? 'cards.credit' : 'cards.debit')}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="muted small">{t('cards.tip')}</p>
      {offersUpdated && <p className="muted small">{t('cards.verified', { date: shortDate(offersUpdated) })}</p>}
    </div>
  );
}
