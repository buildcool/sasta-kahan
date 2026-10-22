import { fetchText } from './fetcher.ts';

/**
 * Product name for a barcode (EAN/UPC), from the free Open Food / Beauty / Products Facts
 * databases. Good for groceries and cosmetics; returns undefined when nobody has listed it.
 */
export async function nameForBarcode(code: string): Promise<string | undefined> {
  if (!/^\d{8,14}$/.test(code)) return undefined;
  for (const host of ['world.openfoodfacts.org', 'world.openbeautyfacts.org', 'world.openproductsfacts.org']) {
    try {
      const res = await fetchText({
        url: `https://${host}/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,quantity`,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.status !== 200) continue;
      const p = (JSON.parse(res.body) as { product?: Record<string, string> }).product;
      const name = p?.product_name_en || p?.product_name;
      if (!name) continue;
      const brand = p.brands?.split(',')[0]?.trim();
      return [brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : '', name, p.quantity ?? ''].join(' ').replace(/\s+/g, ' ').trim();
    } catch {
      // try the next database
    }
  }
  return undefined;
}

/** Fallback: Amazon search usually knows a barcode; its first result's title names the product. */
export async function nameFromAmazon(code: string, read: (body: string) => { title: string }[]): Promise<string | undefined> {
  try {
    const res = await fetchText({ url: `https://www.amazon.in/s?k=${code}`, method: 'GET', headers: {} });
    return res.status === 200 ? read(res.body)[0]?.title : undefined;
  } catch {
    return undefined;
  }
}
