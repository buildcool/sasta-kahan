import type { Coupon, EffectivePrice, Offer, SiteFees, UserCard, Wallet } from './types.ts';

export const EMPTY_WALLET: Wallet = { cards: [], apps: [], memberships: [], newUser: false };

/** A co-branded card is also a normal credit card of its bank. */
export function expandWallet(w: Wallet): Wallet {
  const extra = w.cards.filter((c) => c.card).map((c) => ({ bank: c.bank, type: 'credit' as const }));
  return { ...w, cards: [...w.cards, ...extra] };
}

/** Rupees saved by one offer at this price (0 if it doesn't apply or isn't a sure saving). */
export function offerSaving(o: Offer, price: number): number {
  if (o.minOrder && price < o.minOrder) return 0;
  if (o.kind === 'emi' || o.emiOnly) return 0; // EMI-only discounts need EMI; don't assume
  if (o.points || o.upTo) return 0; // coins and "up to ₹X" aren't a sure saving
  let save = o.kind === 'flat' ? o.value : (price * o.value) / 100;
  if (o.cap) save = Math.min(save, o.cap);
  // A bank offer taking off more than half the price is a misread or a one-time promo.
  if (save > price / 2) return 0;
  return Math.round(save * 100) / 100;
}

/** Card offers: the right bank, card type, and (for co-branded offers) the exact card. */
export function cardMatches(o: Offer, c: UserCard): boolean {
  if (o.bank !== c.bank) return false;
  if (o.card && o.card !== c.card) return false;
  return o.cardType === 'any' || o.cardType === c.type;
}

/** Can this user use this offer? */
export function offerApplies(o: Offer, w: Wallet): boolean {
  if (o.newUser && !w.newUser) return false;
  if (o.requires && !w.memberships.includes(o.requires)) return false;
  switch (o.bank) {
    case 'upi': // any UPI app
    case 'coupon':
      return true;
    case 'wallet':
      return !!o.app && w.apps.includes(o.app);
    case 'rupay':
      return w.apps.includes('rupay');
    default:
      return w.cards.some((c) => cardMatches(o, c));
  }
}

function best(offers: Offer[], price: number): { save: number; offer?: Offer } {
  let top: { save: number; offer?: Offer } = { save: 0 };
  for (const o of offers) {
    const save = offerSaving(o, price);
    if (save > top.save) top = { save, offer: o };
  }
  return top;
}

/** Approximate delivery + platform fees for an order of `amount` (0 when unknown). */
export function feesFor(amount: number, fees: SiteFees | undefined, w: Wallet): number {
  if (!fees) return 0;
  const freeDelivery = fees.freeWith?.some((m) => w.memberships.includes(m)) || (fees.freeAbove !== undefined && amount >= fees.freeAbove);
  return (freeDelivery ? 0 : fees.delivery ?? 0) + (fees.platform ?? 0);
}

/**
 * What the user really pays: site coupon first, then the best offer they can use.
 * "any" is the best price with any card (ignoring new-user offers), for the "with X card" hint.
 */
export function effectivePrice(price: number, offers: Offer[], w: Wallet, coupon?: Coupon, fees?: SiteFees): EffectivePrice {
  const base = coupon && coupon.price < price ? coupon.price : price;
  const mine = best(offers.filter((o) => offerApplies(o, w)), base);
  const any = best(offers.filter((o) => !o.newUser), base);
  return {
    price,
    base,
    coupon: base < price ? coupon : undefined,
    fees: feesFor(base, fees, w),
    mine: round(base - mine.save),
    mineOffer: mine.offer,
    mineLater: mine.offer?.cashback ? mine.save : 0,
    any: round(base - any.save),
    anyOffer: any.offer,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
