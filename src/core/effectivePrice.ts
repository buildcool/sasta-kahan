import type { EffectivePrice, Offer, UserCard } from './types.ts';

/** Rupees saved by one offer at this price (0 if it doesn't apply). */
export function offerSaving(o: Offer, price: number): number {
  if (o.minOrder && price < o.minOrder) return 0;
  if (o.kind === 'emi') return 0;
  let save = o.kind === 'flat' ? o.value : (price * o.value) / 100;
  if (o.cap) save = Math.min(save, o.cap);
  return Math.min(Math.round(save * 100) / 100, price);
}

export function cardMatches(o: Offer, c: UserCard): boolean {
  if (o.bank === 'upi') return true; // everyone has UPI
  if (o.bank !== c.bank) return false;
  if (o.card && o.card !== c.card) return false;
  return o.cardType === 'any' || o.cardType === c.type;
}

function best(offers: Offer[], price: number): { save: number; offer?: Offer } {
  let top: { save: number; offer?: Offer } = { save: 0 };
  for (const o of offers) {
    if (o.emiOnly) continue; // EMI-only discounts need EMI; don't assume
    const save = offerSaving(o, price);
    if (save > top.save) top = { save, offer: o };
  }
  return top;
}

export function effectivePrice(price: number, offers: Offer[], cards: UserCard[]): EffectivePrice {
  const mine = best(offers.filter((o) => cards.some((c) => cardMatches(o, c))), price);
  const any = best(offers, price);
  return {
    price,
    mine: round(price - mine.save),
    mineOffer: mine.offer,
    any: round(price - any.save),
    anyOffer: any.offer,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
