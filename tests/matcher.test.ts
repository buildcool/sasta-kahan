import { describe, expect, it } from 'vitest';
import { condenseTitle, detectCategories, extractQuantity, makeReference, pickBest, score, scoreListings, unitPrice } from '../src/core/matcher.ts';

describe('extractQuantity', () => {
  it.each([
    ['Lakme Sunscreen SPF 50, 50 ml', { value: 50, unit: 'ml', pack: 1 }],
    ['Dot & Key Sunscreen, 30 g', { value: 30, unit: 'g', pack: 1 }],
    ['Fortune Oil 1 L', { value: 1000, unit: 'ml', pack: 1 }],
    ['Aashirvaad Atta 5kg', { value: 5000, unit: 'g', pack: 1 }],
    ['Nivea Cream 100ml (Pack of 2)', { value: 100, unit: 'ml', pack: 2 }],
    ['iPhone 15 (Black, 128 GB) 6GB RAM', { value: 128, unit: 'gb', pack: 1 }],
  ])('%s', (title, q) => expect(extractQuantity(title)).toEqual(q));

  it('returns undefined when there is no size', () => {
    expect(extractQuantity('boAt Airdopes 141')).toBeUndefined();
  });
});

describe('unitPrice', () => {
  it('per 100ml', () => expect(unitPrice(217, { value: 50, unit: 'ml', pack: 1 })).toEqual({ value: 434, per: '100ml' }));
  it('accounts for packs', () => expect(unitPrice(400, { value: 100, unit: 'ml', pack: 2 })?.value).toBe(200));
  it('no unit price for phones', () => expect(unitPrice(70000, { value: 128, unit: 'gb', pack: 1 })).toBeUndefined());
});

describe('score', () => {
  const q = makeReference('boat airdopes 141', 'query');
  it('matches when all words are present', () => {
    expect(score(q, 'boAt Airdopes 141 TWS Earbuds with 42H Playtime')).toBe(1);
  });
  it('model numbers must match exactly', () => {
    expect(score(q, 'boAt Airdopes 181 Pro TWS')).toBeLessThan(0.55);
    expect(score(q, 'boAt Airdopes 1410')).toBeLessThan(0.55);
  });
  it('SPF 50 does not match SPF 25 ... 50 ml', () => {
    const r = makeReference('lakme sunscreen spf 50', 'query');
    expect(score(r, 'Lakme Sun Expert SPF 25 Sunscreen 50 ml')).toBeLessThan(0.99);
  });
  it('handles accents and spacing', () => {
    expect(score(makeReference('lakme sunscreen', 'query'), 'Lakmé Sun-Screen... Sunscreen')).toBe(1);
  });
  it('product mode separates variants', () => {
    const r = makeReference('Lakme Sun Expert Dry Matte Fluid SPF 50 PA++++ Sunscreen 50 ml', 'product');
    const same = score(r, 'Lakme Sun Expert Dry Matte Fluid SPF 50 PA++++ Sunscreen - 50 ml');
    const variant = score(r, 'Lakme Sun Expert Tinted Matte Fluid SPF 50 Sunscreen with 1% Ceramide');
    expect(same).toBeGreaterThan(0.85);
    expect(variant).toBeLessThan(0.85);
  });
});

describe('pickBest', () => {
  const ref = makeReference('Nivea Soft Cream 100 ml', 'product');
  const list = scoreListings(ref, [
    { site: 's', title: 'Nivea Soft Light Moisturising Cream 100 ml', price: 199, url: 'u1' },
    { site: 's', title: 'Nivea Soft Light Moisturising Cream 200 ml', price: 150, url: 'u2' },
    { site: 's', title: 'Nivea Soft Cream 100ml', price: 210, url: 'u3' },
    { site: 's', title: 'Pond\'s Light Cream 100 ml', price: 99, url: 'u4' },
  ]);
  it('prefers the right size over a cheaper other size, never a different product', () => {
    const b = pickBest(list)!;
    expect(b.url).not.toBe('u4');
    expect(b.url).not.toBe('u2');
  });
});

describe('detectCategories', () => {
  it.each([
    ['lakme sunscreen', 'beauty'],
    ['boat airdopes 141', 'electronics'],
    ['iphone 15 128gb', 'electronics'],
    ['nike running shoes', 'fashion'],
    ['aashirvaad atta 5kg', 'grocery'],
  ])('%s → %s', (q, c) => expect(detectCategories(q)).toContain(c));
  it('unknown → general', () => expect(detectCategories('xyzzy')).toEqual(['general']));
});

describe('condenseTitle', () => {
  it('keeps brand, key words and size', () => {
    const c = condenseTitle('Lakme Sunscreen for Bright Skin, SPF 50 PA++++, Water Light, Niacinamide, in Vivo Tested, 50 ml');
    expect(c).toMatch(/^lakme sunscreen bright skin/);
    expect(c).toContain('50 ml');
  });
});
