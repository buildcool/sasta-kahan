import { BANKS, COBRANDS, PAY_APPS } from '../core/offers.ts';
import type { Offer, ScoredListing, SiteResult } from '../core/types.ts';
import type { T } from '../i18n.ts';

import { rupees } from '../core/money.ts';

export { rupees };

export const discountPct = (price: number, mrp?: number) => (mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);

export const appName = (id: string) => PAY_APPS.find((a) => a.id === id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1);

/** Who the offer is for: "HDFC Bank Credit", "Flipkart Axis", "CRED", "any UPI app". */
export function payWith(o: Offer, t: T): string {
  if (o.card) return COBRANDS.find((c) => c.id === o.card)?.name ?? o.card;
  if (o.bank === 'upi') return t('offer.upi');
  if (o.bank === 'rupay') return t('offer.rupay');
  if (o.bank === 'wallet') return o.app ? appName(o.app) : 'UPI';
  const bank = BANKS.find((b) => b.id === o.bank)?.name ?? o.bank.toUpperCase();
  return o.cardType === 'any' ? bank : `${bank} ${t(o.cardType === 'credit' ? 'offer.credit' : 'offer.debit')}`;
}

export function offerShort(o: Offer, t: T): string {
  const amount = o.kind === 'percent' ? `${o.value}%` : rupees(o.value);
  return `${amount} ${t(o.cashback ? 'offer.cashback' : 'offer.off')} · ${payWith(o, t)}`;
}

/** Fine print worth seeing before you count on an offer. */
export function offerNotes(o: Offer, t: T, membershipName: (id: string) => string): string[] {
  const notes: string[] = [];
  if (o.cap) notes.push(t('offer.max', { cap: rupees(o.cap) }));
  if (o.minOrder) notes.push(t('offer.min', { min: rupees(o.minOrder) }));
  if (o.emiOnly) notes.push(t('offer.emi'));
  if (o.newUser) notes.push(t('tag.newUser'));
  if (o.points) notes.push(t('tag.points'));
  if (o.upTo) notes.push(t('tag.upTo'));
  if (o.requires) notes.push(t('tag.needs', { what: membershipName(o.requires) }));
  if (o.source === 'config') notes.push(t('tag.config') + (o.verified ? ` · ${t('tag.verified', { date: shortDate(o.verified) })}` : ''));
  return notes;
}

export const shortDate = (d: string | number) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: typeof d === 'string' ? 'numeric' : undefined });

export function ago(ts: number, t: T): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return t('ago.now');
  if (min < 60) return t('ago.min', { n: min });
  const h = Math.floor(min / 60);
  return h < 24 ? t('ago.hour', { n: h }) : t('ago.day', { n: Math.floor(h / 24) });
}

export function statusText(r: SiteResult, t: T): string {
  if (r.status === 'blocked' && r.error?.startsWith('paused:')) {
    return t('status.paused', { n: Math.max(1, Math.ceil((Number(r.error.slice(7)) - Date.now()) / 60000)) });
  }
  if (r.status === 'blocked' && r.error === 'empty-page') return t('status.emptyPage');
  if (r.status === 'manual' && r.error === 'needs-location') return t('status.needsLocation');
  if (r.status === 'manual' && r.error === 'app-only') return t('status.appOnly');
  if (r.status === 'manual' && r.error === 'browser-off') return t('status.browserOff');
  if (r.status === 'empty' && r.error === 'no-delivery') return t('status.noDelivery');
  if (r.status === 'nomatch') return t('status.nomatch', { n: r.listings.length });
  if (r.status === 'ok') return '';
  return t(`status.${r.status}`);
}

/** Amazon product id from a link, for Keepa's price history. */
export function keepaUrl(url: string): string | undefined {
  const asin = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1];
  return asin ? `https://keepa.com/#!product/10-${asin}` : undefined;
}

const REPO = import.meta.env.VITE_CONFIG_REPO as string | undefined;

/** Pre-filled GitHub issue for a wrong price (the user reviews it before sending). */
export function reportUrl(r: SiteResult, query: string, version: string): string | undefined {
  if (!REPO || !r.best) return undefined;
  const b: ScoredListing = r.best;
  const title = `Wrong price on ${r.site.name}: ${b.title.slice(0, 60)}`;
  const body = [
    `**Search:** ${query}`,
    `**Site:** ${r.site.name}`,
    `**App showed:** ${rupees(b.price)}${b.coupon ? ` (coupon ${rupees(b.coupon.price)})` : ''} · match: ${b.match} (${b.score.toFixed(2)})`,
    `**Listing:** ${b.title}`,
    `**Link:** ${b.url}`,
    `**App version:** ${version}`,
    '',
    '**What the site really shows / what is wrong:**',
    '',
  ].join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=wrong-price`;
}

/** WhatsApp-friendly summary of a comparison. */
export function summaryText(query: string, results: SiteResult[], t: T): string {
  const ok = results.filter((r) => r.best && r.best.match !== 'different');
  const lines = ok.map((r) => {
    const b = r.best!;
    const e = b.effective;
    const eff = e && e.mine < b.price ? ` (${rupees(e.mine)}${e.mineOffer ? ` · ${payWith(e.mineOffer, t)}` : e.coupon ? ' · coupon' : ''})` : '';
    return `• ${r.site.name}: ${rupees(b.price)}${eff}\n  ${b.url}`;
  });
  return `🛒 "${query}"\n\n${lines.join('\n')}\n\nSastaKahan`;
}
