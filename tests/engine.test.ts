import { describe, expect, it } from 'vitest';
import { flagOutliers, sortResults } from '../src/core/search.ts';
import type { MatchLabel, SiteResult } from '../src/core/types.ts';
import { site } from './helpers.ts';

const result = (id: string, price: number, match: MatchLabel): SiteResult => ({
  site: site(id),
  status: 'ok',
  listings: [],
  manualUrl: '',
  best: { site: id, title: id, price, url: '', score: 1, match },
});

describe('sortResults', () => {
  it('a cheaper "similar" item never beats the same product', () => {
    const sorted = sortResults([result('flipkart', 13599, 'exact'), result('myntra', 6299, 'similar'), result('ajio', 10837, 'exact')]);
    expect(sorted.map((r) => r.site.id)).toEqual(['ajio', 'flipkart', 'myntra']);
  });
});

describe('flagOutliers', () => {
  it('a "same product" far cheaper than the other sites is flagged and sorted after them', () => {
    const r = flagOutliers([result('tatacliq', 499, 'exact'), result('flipkart', 67999, 'exact'), result('croma', 72490, 'exact'), result('reliance', 59900, 'exact')]);
    expect(r.find((x) => x.site.id === 'tatacliq')?.outlier).toBe(true);
    expect(sortResults(r).map((x) => x.site.id)).toEqual(['reliance', 'flipkart', 'croma', 'tatacliq']);
  });
  it('needs at least three sites to judge', () => {
    expect(flagOutliers([result('tatacliq', 499, 'exact'), result('flipkart', 67999, 'exact')]).some((x) => x.outlier)).toBe(false);
  });
});

describe('sortResults (stock)', () => {
  it('out of stock goes after in-stock', () => {
    const oos = result('flipkart', 100, 'exact');
    oos.best!.inStock = false;
    expect(sortResults([oos, result('amazon', 200, 'exact')]).map((x) => x.site.id)).toEqual(['amazon', 'flipkart']);
  });
});
