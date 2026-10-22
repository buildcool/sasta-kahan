import { describe, expect, it } from 'vitest';
import { EMPTY_WALLET, cardMatches, effectivePrice, feesFor, offerApplies, offerSaving } from '../src/core/effectivePrice.ts';
import { harvestOffers, parseOfferText } from '../src/core/offers.ts';
import type { Offer, UserCard, Wallet } from '../src/core/types.ts';
import { fixture } from './helpers.ts';

describe('parseOfferText', () => {
  it('percent with cap and minimum', () => {
    expect(parseOfferText('10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card Transactions. Min purchase value ₹5,000', 'amazon')).toMatchObject({
      bank: 'hdfc', cardType: 'credit', kind: 'percent', value: 10, cap: 1500, minOrder: 5000,
    });
  });
  it('flat debit card offer', () => {
    expect(parseOfferText('Flat ₹100 off on ICICI Bank Debit Cards on orders above ₹999', 'x')).toMatchObject({
      bank: 'icici', cardType: 'debit', kind: 'flat', value: 100, minOrder: 999,
    });
  });
  it('co-branded cashback card', () => {
    expect(parseOfferText('5% Unlimited Cashback on Flipkart Axis Bank Credit Card', 'flipkart')).toMatchObject({
      bank: 'axis', card: 'flipkart-axis', kind: 'percent', value: 5, cashback: true,
    });
  });
  it('"Rs" inside words is not a rupee sign', () => {
    expect(parseOfferText('Get 5% back with Amazon Pay ICICI Bank credit card for Prime members', 'amazon')?.text).toContain('members');
  });
  it('EMI-only offers are flagged', () => {
    expect(parseOfferText('10% off up to ₹1000 on Kotak Credit Card EMI transactions', 'x')?.emiOnly).toBe(true);
    expect(parseOfferText('10% off on Kotak Credit Card EMI & Non-EMI transactions', 'x')?.emiOnly).toBeUndefined();
  });
  it('UPI offers apply to everyone', () => {
    expect(parseOfferText('₹50 off on UPI payments above ₹499', 'x')).toMatchObject({ bank: 'upi', kind: 'flat', value: 50, minOrder: 499 });
  });
  it('app-specific UPI offers are not for everyone', () => {
    const o = parseOfferText('Get upto ₹40 OFF on BHIM UPI Payment', 'nykaa')!;
    expect(o.bank).toBe('wallet');
    expect(cardMatches(o, { bank: 'hdfc', type: 'credit' })).toBe(false);
  });
  it('ignores text without a bank', () => {
    expect(parseOfferText('Get 10% off on your first order', 'x')).toBeNull();
  });
});

describe('harvestOffers', () => {
  it('reads UPI offers from a Reliance Digital product page', () => {
    const offers = harvestOffers(fixture('product-reliance'), 'reliance');
    expect(offers).toContainEqual(expect.objectContaining({ bank: 'upi', kind: 'flat', value: 100 }));
  });
  it('marks Nykaa BHIM UPI offer as app-specific', () => {
    const offers = harvestOffers(fixture('product-nykaa'), 'nykaa');
    expect(offers).toContainEqual(expect.objectContaining({ bank: 'wallet', value: 40 }));
  });
  it('reads Flipkart bank offer pills', () => {
    const offers = harvestOffers(fixture('product-flipkart'), 'flipkart');
    expect(offers.map((o) => o.card).sort()).toEqual(['flipkart-axis', 'flipkart-sbi']);
    expect(offers.every((o) => o.kind === 'flat' && o.value === 14 && o.cashback)).toBe(true);
  });
});

const offer = (o: Partial<Offer>): Offer => ({ site: 's', bank: 'hdfc', cardType: 'credit', kind: 'percent', value: 10, text: '', source: 'page', ...o });

describe('offerSaving', () => {
  it('caps percent offers', () => expect(offerSaving(offer({ value: 10, cap: 50 }), 1000)).toBe(50));
  it('respects minimum order', () => expect(offerSaving(offer({ minOrder: 5000 }), 1000)).toBe(0));
  it('flat', () => expect(offerSaving(offer({ kind: 'flat', value: 100 }), 1000)).toBe(100));
  it('ignores a "saving" of more than half the price', () => expect(offerSaving(offer({ kind: 'flat', value: 100 }), 106)).toBe(0));
  it('coins and "up to" amounts are not counted', () => {
    expect(offerSaving(offer({ kind: 'flat', value: 50, points: true }), 1000)).toBe(0);
    expect(offerSaving(offer({ kind: 'flat', value: 300, upTo: true }), 1000)).toBe(0);
  });
});

describe('cardMatches', () => {
  const hdfcCredit: UserCard = { bank: 'hdfc', type: 'credit' };
  it('bank + type', () => {
    expect(cardMatches(offer({}), hdfcCredit)).toBe(true);
    expect(cardMatches(offer({ cardType: 'debit' }), hdfcCredit)).toBe(false);
    expect(cardMatches(offer({ bank: 'icici' }), hdfcCredit)).toBe(false);
  });
  it('co-brand offers need that exact card', () => {
    const fkAxis = offer({ bank: 'axis', card: 'flipkart-axis' });
    expect(cardMatches(fkAxis, { bank: 'axis', type: 'credit' })).toBe(false);
    expect(cardMatches(fkAxis, { bank: 'axis', type: 'credit', card: 'flipkart-axis' })).toBe(true);
  });
});

const wallet = (w: Partial<Wallet>): Wallet => ({ ...EMPTY_WALLET, ...w });

describe('effectivePrice', () => {
  const offers = [
    offer({ bank: 'hdfc', value: 10, cap: 100 }),
    offer({ bank: 'icici', kind: 'flat', value: 150 }),
    offer({ bank: 'sbi', value: 20, emiOnly: true }),
  ];
  it('best offer for my cards vs any card', () => {
    const e = effectivePrice(1000, offers, wallet({ cards: [{ bank: 'hdfc', type: 'credit' }] }));
    expect(e.mine).toBe(900);
    expect(e.any).toBe(850);
    expect(e.anyOffer?.bank).toBe('icici');
  });
  it('ignores EMI-only discounts', () => {
    expect(effectivePrice(1000, offers, wallet({ cards: [{ bank: 'sbi', type: 'credit' }] })).mine).toBe(1000);
  });
  it('no cards → list price', () => {
    expect(effectivePrice(1000, offers, EMPTY_WALLET).mine).toBe(1000);
  });
  it('applies the site coupon first, then the card offer on the lower price', () => {
    const e = effectivePrice(1000, [offer({ value: 10 })], wallet({ cards: [{ bank: 'hdfc', type: 'credit' }] }), { price: 800, text: 'Buy for ₹800 with coupon' });
    expect(e.base).toBe(800);
    expect(e.mine).toBe(720);
  });
  it('separates cashback (paid later) from instant discounts', () => {
    const e = effectivePrice(1000, [offer({ value: 5, cashback: true })], wallet({ cards: [{ bank: 'hdfc', type: 'credit' }] }));
    expect(e.mine).toBe(950);
    expect(e.mineLater).toBe(50);
  });
  it('the Ajio ₹106 case: new-user and app offers never make it ₹0', () => {
    const page = [
      'Get Flat ₹100 Cashback on your first-ever CRED UPI transaction',
      'Get upto ₹300 cashback on Jupiter UPI for new users',
      'Flat ₹50 cashback on POP UPI, in the form of Jewels. MOV of ₹249',
    ].map((t) => parseOfferText(t, 'ajio')!);
    expect(effectivePrice(106, page, EMPTY_WALLET).mine).toBe(106);
    expect(effectivePrice(106, page, wallet({ apps: ['cred', 'jupiter', 'pop'] })).mine).toBe(106);
  });
});

describe('who can use an offer', () => {
  it('new-user offers only count when you say you are new', () => {
    const o = parseOfferText('Flat ₹100 off on your first order using Paytm UPI', 'x')!;
    expect(o.newUser).toBe(true);
    expect(offerApplies(o, wallet({ apps: ['paytm'] }))).toBe(false);
    expect(offerApplies(o, wallet({ apps: ['paytm'], newUser: true }))).toBe(true);
  });
  it('app offers need that app', () => {
    const o = parseOfferText('₹25 cashback on Jupiter UPI payments', 'x')!;
    expect(o).toMatchObject({ bank: 'wallet', app: 'jupiter' });
    expect(offerApplies(o, wallet({ apps: ['paytm'] }))).toBe(false);
    expect(offerApplies(o, wallet({ apps: ['jupiter'] }))).toBe(true);
  });
  it('an unknown app before "UPI" is still one app, not "any UPI"', () => {
    expect(parseOfferText('Get ₹40 off using Zing UPI', 'x')).toMatchObject({ bank: 'wallet', app: 'zing' });
    expect(parseOfferText('Flat ₹40 off on any UPI payment', 'x')).toMatchObject({ bank: 'upi' });
  });
  it('membership offers need the membership', () => {
    const prime = offer({ bank: 'icici', card: 'amazon-pay-icici', value: 5, requires: 'prime' });
    const card: UserCard = { bank: 'icici', type: 'credit', card: 'amazon-pay-icici' };
    expect(offerApplies(prime, wallet({ cards: [card] }))).toBe(false);
    expect(offerApplies(prime, wallet({ cards: [card], memberships: ['prime'] }))).toBe(true);
  });
  it('RuPay credit card on UPI', () => {
    const o = parseOfferText('10% off up to ₹100 on RuPay Credit Card on UPI', 'x')!;
    expect(o.bank).toBe('rupay');
    expect(offerApplies(o, wallet({ apps: ['rupay'] }))).toBe(true);
    expect(offerApplies(o, EMPTY_WALLET)).toBe(false);
  });
});

describe('parseOfferText (fine print)', () => {
  it('"upto ₹300 cashback" is not a sure ₹300', () => expect(parseOfferText('Get upto ₹300 cashback on Paytm UPI', 'x')).toMatchObject({ kind: 'flat', value: 300, upTo: true }));
  it('coins are points, not cash', () => expect(parseOfferText('Get 10% back as SuperCoins on Flipkart UPI', 'x')?.points).toBe(true));
  it('MOV is a minimum order', () => expect(parseOfferText('Flat ₹50 off on Mobikwik UPI, MOV of ₹249', 'x')?.minOrder).toBe(249));
  it('minimum order value wording', () => expect(parseOfferText('10% off on HDFC credit cards, minimum order value ₹1,999', 'x')?.minOrder).toBe(1999));
});

describe('feesFor', () => {
  const fees = { delivery: 40, freeAbove: 499, freeWith: ['prime'] };
  it('delivery below the free threshold', () => expect(feesFor(300, fees, EMPTY_WALLET)).toBe(40));
  it('free above it', () => expect(feesFor(600, fees, EMPTY_WALLET)).toBe(0));
  it('free with the membership', () => expect(feesFor(300, fees, wallet({ memberships: ['prime'] }))).toBe(0));
});
