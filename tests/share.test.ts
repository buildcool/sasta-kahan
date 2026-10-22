import { describe, expect, it } from 'vitest';
import { condenseTitle } from '../src/core/matcher.ts';
import { cleanSharedText, cleanStoreTitle, isProductTitle } from '../src/core/share.ts';

describe('cleanSharedText', () => {
  it('Flipkart share message', () => {
    const t = cleanSharedText('Check this out on Flipkart! Take a look at this GEL-KAYANO 32 Running Shoes For Unisex https://dl.flipkart.com/s/abc123');
    expect(t).toBe('GEL-KAYANO 32 Running Shoes For Unisex');
    expect(condenseTitle(t)).toBe('gel kayano 32 running shoes unisex');
  });

  it('Amazon share message', () => {
    expect(cleanSharedText('Check this out! Lakmé Sun Expert Tinted Sunscreen SPF 50 PA+++ 50 ml https://amzn.in/d/xYz')).toBe(
      'Lakmé Sun Expert Tinted Sunscreen SPF 50 PA+++ 50 ml',
    );
  });

  it('Nykaa and Meesho share messages', () => {
    expect(cleanSharedText('Check out Minimalist SPF 50 Sunscreen on Nykaa https://nykaa.app.link/q1')).toBe('Minimalist SPF 50 Sunscreen');
    expect(cleanSharedText('Check out this product on Meesho! Oversized T-shirt at ₹249 only https://meesho.com/s/p/5x')).toBe('Oversized T-shirt');
  });

  it('message with no product name is empty', () => {
    expect(cleanSharedText('Hey! Check out this product on Myntra! https://myntr.it/AbC')).toBe('');
  });
});

describe('cleanStoreTitle', () => {
  it('Flipkart page title', () => {
    expect(
      cleanStoreTitle(
        'Asics GEL-KAYANO 32 Running Shoes For Unisex - Buy Asics GEL-KAYANO 32 Running Shoes For Unisex Online at Best Price - Shop Online for Footwears in India | Flipkart.com',
      ),
    ).toBe('Asics GEL-KAYANO 32 Running Shoes For Unisex');
  });

  it('Amazon and Myntra page titles', () => {
    expect(cleanStoreTitle('Lakme Sun Expert SPF 50 Sunscreen, 100ml : Amazon.in: Beauty')).toBe('Lakme Sun Expert SPF 50 Sunscreen, 100ml');
    expect(cleanStoreTitle('Buy ASICS Men GEL-KAYANO 32 Running Shoes - Sports Shoes for Men 31234567 | Myntra')).toBe(
      'ASICS Men GEL-KAYANO 32 Running Shoes',
    );
  });
});

describe('isProductTitle', () => {
  it('rejects bot checks and home pages', () => {
    expect(isProductTitle('Amazon.in')).toBe(false);
    expect(isProductTitle('Online Shopping Site for Mobiles, Electronics, Furniture, Grocery, Lifestyle, Books & More. Best Offers!')).toBe(false);
    expect(isProductTitle('Robot Check')).toBe(false);
    expect(isProductTitle(undefined)).toBe(false);
    expect(isProductTitle('Asics GEL-KAYANO 32 Running Shoes For Unisex')).toBe(true);
  });
});

describe('cleanStoreTitle (more stores)', () => {
  it.each([
    ['Buy Tossido Grey Fine Woven Micro Fiber Necktie Online', 'Tossido Grey Fine Woven Micro Fiber Necktie'],
    ['Buy Minimalist Niacinamide 10% + Zinc Serum - 30 ml Online At Best Price @ Tata CLiQ', 'Minimalist Niacinamide 10% + Zinc Serum - 30 ml'],
    ['Buy Titan Neo Analog Watch for Men Online @ Tata CLiQ', 'Titan Neo Analog Watch for Men'],
    ['Buy Minimalist  Set of Vitamin B5 Moisturizer + SPF50 Sunscreen -  - Personal Care for Unisex', 'Minimalist Set of Vitamin B5 Moisturizer + SPF50 Sunscreen'],
    ['Buy Minimalist Niacinamide Serum - 30 ml - Personal Care for Women', 'Minimalist Niacinamide Serum - 30 ml'],
    ['Buy Minimalist Set of Moisturizer - Skin Care Combo for Unisex 41358430 | Myntra', 'Minimalist Set of Moisturizer'],
  ])('%s', (raw, clean) => expect(cleanStoreTitle(raw)).toBe(clean));
  it('"Access Denied" is not a product', () => expect(isProductTitle('Access Denied')).toBe(false));
});
