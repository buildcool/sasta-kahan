import { describe, expect, it } from 'vitest';
import { cardMatches, effectivePrice, offerSaving } from '../src/core/effectivePrice.ts';
import { harvestOffers, parseOfferText } from '../src/core/offers.ts';
import type { Offer, UserCard } from '../src/core/types.ts';
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
  it('never more than the price', () => expect(offerSaving(offer({ kind: 'flat', value: 500 }), 300)).toBe(300));
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

describe('effectivePrice', () => {
  const offers = [
    offer({ bank: 'hdfc', value: 10, cap: 100 }),
    offer({ bank: 'icici', kind: 'flat', value: 150 }),
    offer({ bank: 'sbi', value: 20, emiOnly: true }),
  ];
  it('best offer for my cards vs any card', () => {
    const e = effectivePrice(1000, offers, [{ bank: 'hdfc', type: 'credit' }]);
    expect(e.mine).toBe(900);
    expect(e.any).toBe(850);
    expect(e.anyOffer?.bank).toBe('icici');
  });
  it('ignores EMI-only discounts', () => {
    expect(effectivePrice(1000, offers, [{ bank: 'sbi', type: 'credit' }]).mine).toBe(1000);
  });
  it('no cards → list price', () => {
    expect(effectivePrice(1000, offers, []).mine).toBe(1000);
  });
});
