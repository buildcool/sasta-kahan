import { BANKS, COBRANDS } from '../core/offers.ts';
import type { UserCard } from '../core/types.ts';

interface Props {
  cards: UserCard[];
  onChange: (cards: UserCard[]) => void;
}

const key = (c: UserCard) => `${c.bank}:${c.type}:${c.card ?? ''}`;

export function Cards({ cards, onChange }: Props) {
  const has = (c: UserCard) => cards.some((x) => key(x) === key(c));
  const toggle = (c: UserCard) => onChange(has(c) ? cards.filter((x) => key(x) !== key(c)) : [...cards, c]);

  return (
    <div className="page">
      <h2>My Cards</h2>
      <p className="muted">
        Pick the cards you have. We only use this to calculate which offer you can actually use — it never leaves your phone. No card numbers needed.
      </p>

      <h3>Shopping cards</h3>
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

      <h3>Bank cards</h3>
      <div className="bank-grid">
        {BANKS.map((b) => (
          <div key={b.id} className="bank-row">
            <span className="bank-name">{b.name}</span>
            {(['credit', 'debit'] as const).map((type) => {
              const card: UserCard = { bank: b.id, type };
              return (
                <button key={type} className={`chip small ${has(card) ? 'on' : ''}`} onClick={() => toggle(card)}>
                  {type === 'credit' ? 'Credit' : 'Debit'}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="muted">Tip: if you have a co-branded card (e.g. Amazon Pay ICICI), choosing it above also counts as that bank's credit card.</p>
    </div>
  );
}

/** A co-branded card is also a normal credit card of its bank. */
export function expandCards(cards: UserCard[]): UserCard[] {
  const extra = cards.filter((c) => c.card).map((c) => ({ bank: c.bank, type: 'credit' as const }));
  return [...cards, ...extra];
}
