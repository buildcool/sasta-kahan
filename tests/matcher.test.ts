import { describe, expect, it } from 'vitest';
import { condenseTitle, detectCategories, extractQuantity, makeReference, normalize, pickBest, score, scoreListings, unitPrice } from '../src/core/matcher.ts';
import type { Listing } from '../src/core/types.ts';

const match = (query: string, title: string, mode: 'query' | 'product' = 'query') => scoreListings(makeReference(query, mode), [{ site: 's', title, price: 100, url: 'u' }])[0];

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
    expect(c).toContain('50ml');
  });
});

describe('normalize', () => {
  it('apostrophes do not split brands', () => {
    expect(normalize("Levi's Men's 511")).toBe('levis mens 511');
    expect(normalize('L’Oréal Paris')).toBe('loreal paris');
  });
  it('one spelling for units', () => {
    expect(normalize('5 Litre')).toBe('5l');
    expect(normalize('5 L')).toBe('5l');
    expect(normalize('5Ltr')).toBe('5l');
    expect(normalize('500 gms')).toBe('500g');
    expect(normalize('1 Kg')).toBe('1kg');
    expect(normalize('55" TV')).toBe('55inch tv');
    expect(normalize('2 in 1')).toBe('2 in 1');
  });
});

describe('extractQuantity (units)', () => {
  it('litres', () => expect(extractQuantity('Prestige Cooker 5 Litre')).toEqual({ value: 5000, unit: 'ml', pack: 1 }));
  it('"5G" on a phone is not 5 grams', () => expect(extractQuantity('Redmi 13 5G (6GB RAM, 128GB Storage)')).toEqual({ value: 128, unit: 'gb', pack: 1 }));
  it('5 g sample is grams', () => expect(extractQuantity('Lakme Kajal 5 g')).toEqual({ value: 5, unit: 'g', pack: 1 }));
});

describe('bugs found by live testing (2026-10-22)', () => {
  it('accessories are never the same product', () => {
    expect(match('iphone 15 128gb', 'Gripp 2In1 Focal Camera Lens Protector for Iphone 15 & Iphone 15 Plus').match).toBe('different');
    expect(match('iphone 15 128gb', 'Apple 100 cm (1 m) Type-C to Type-C Charging Cable, compatible with iPhone 15').match).toBe('different');
    expect(match('iphone 15 128gb', 'Spigen Ultra Hybrid iPhone 15 Case, Crystal Clear').match).toBe('different');
    expect(match('iphone 15 128gb', 'Apple iPhone 15 (128 GB) - Black').match).toBe('exact');
    expect(match('iphone 15 128gb', 'Apple iPhone 15 (128 GB) - Black').why?.accessory).toBeUndefined();
  });
  it('products whose names contain accessory words still match', () => {
    expect(match('apple watch series 9 45mm', 'APPLE Watch Series 9 GPS 45mm Midnight Aluminium Case with Midnight Sport Band - M/L').match).toBe('exact');
    expect(match('boat airdopes 141', 'boAt Airdopes 141 TWS Earbuds with 42H Playtime, Charging Case').match).toBe('exact');
    expect(match('samsung galaxy s24', 'Samsung Galaxy S24 5G (Onyx Black, 8GB, 256GB) without charger').match).toBe('exact');
    expect(match('iphone 15 case', 'Spigen Ultra Hybrid iPhone 15 Case').match).toBe('exact');
  });
  it("brands with apostrophes match (Levi's)", () => {
    expect(match('levis 511 jeans', "Levi's Men's 511 Slim Fit Mid Rise Jeans").match).toBe('exact');
    expect(match('ponds light moisturiser', "POND'S Light Moisturiser 75 ml").match).toBe('exact');
  });
  it('litre / L / Ltr are the same size', () => {
    const l = match('prestige popular svachh 5 litre pressure cooker', 'Prestige Popular Svachh 5 L Pressure Cooker with Outer Lid');
    expect(l.match).toBe('exact');
    expect(l.why?.size).toBe('same');
  });
  it('a listing that does not show its size is not "same product"', () => {
    const l = match('minimalist niacinamide 10 serum 30ml', 'Minimalist Niacinamide 10 Face Serum');
    expect(l.match).toBe('similar');
    expect(l.why?.size).toBe('unknown');
  });
  it('variants are not the same product', () => {
    expect(match('tata salt 1kg', 'TATA SALT Lite, 1 kg').match).toBe('similar');
    expect(match('tata salt 1kg', 'TATA SALT Lite, 1 kg').why?.variant).toBe('lite');
    expect(match('tata salt 1kg', 'Tata Salt Pink Salt 1 kg').match).toBe('similar');
    expect(match('tata salt 1kg', 'Tata TAT01 Himalayan Pink Salt Grinder, 1 kg').match).toBe('similar');
    expect(match('tata salt 1kg', 'Tata Salt, Vacuum Evaporated Iodised Salt, 1 kg').match).toBe('exact');
    expect(match('iphone 15 128gb', 'Apple iPhone 15 Plus (128 GB) - Blue').match).toBe('similar');
    expect(match('samsung galaxy s24', 'Samsung Galaxy S24 FE 5G AI Smartphone').match).toBe('similar');
  });
  it('brand + one common word is a different product', () => {
    expect(match('prestige popular svachh 5 litre pressure cooker', 'Prestige Delight PRWO 1.5 Litre Electric Rice Cooker').match).toBe('different');
    expect(match('lakme sunscreen spf 50', 'Lakme Sun Expert Ultra Matte SPF 50 Lotion').match).toBe('similar');
  });
  it('another brand is a different product', () => {
    expect(match('Minimalist Niacinamide 10% + Zinc Serum - 30 ml', 'BEETL SKIN 10% Niacinamide + Zinc Face Serum for Acne Marks, 30 ml', 'product').match).toBe('different');
  });
  it('home appliance variants', () => {
    expect(match('prestige popular svachh 5 litre pressure cooker', 'Prestige Popular Plus Svachh 5 L Pressure Cooker').why?.variant).toBe('plus');
  });
  it('explains the match', () => {
    const l = match('boat airdopes 141', 'boAt Airdopes 141 TWS Earbuds');
    expect(l.why).toMatchObject({ found: ['boat', 'airdopes', '141'], missing: [], size: 'none' });
  });
});

describe('detectCategories (weak words)', () => {
  it.each([
    ['titan analog watch', ['fashion']],
    ['asics gel kayano 32 running shoes', ['fashion']],
    ['prestige pressure cooker 5 litre', ['home']],
    ['lakme gel', ['beauty']],
  ])('%s → %j', (q, c) => expect(detectCategories(q).sort()).toEqual([...c].sort()));
  it('a bare "watch" checks both fashion and electronics sites', () => {
    expect(detectCategories('watch for men').sort()).toEqual(['electronics', 'fashion']);
  });
  it('smartwatch is electronics', () => expect(detectCategories('noise smartwatch')).toEqual(['electronics']));
});

describe('pickBest (stock and sanity)', () => {
  const ref = makeReference('boat airdopes 141', 'query');
  const l = (price: number, extra: Partial<Listing> = {}): Listing => ({ site: 's', title: 'boAt Airdopes 141 TWS', price, url: `u${price}`, ...extra });
  it('in-stock beats a cheaper out-of-stock listing', () => {
    expect(pickBest(scoreListings(ref, [l(899, { inStock: false }), l(999)]))?.price).toBe(999);
  });
  it('shows an out-of-stock listing when nothing is in stock', () => {
    expect(pickBest(scoreListings(ref, [l(899, { inStock: false })]))?.inStock).toBe(false);
  });
  it('ignores one "same product" far cheaper than the rest', () => {
    expect(pickBest(scoreListings(ref, [l(99), l(999), l(1049), l(1099)]))?.price).toBe(999);
  });
});
