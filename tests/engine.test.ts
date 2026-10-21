import { describe, expect, it } from 'vitest';
import { sortResults } from '../src/core/engine.ts';
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
