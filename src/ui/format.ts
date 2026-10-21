import { BANKS, COBRANDS } from '../core/offers.ts';
import type { Offer, SiteResult } from '../core/types.ts';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const rupees = (n: number) => `₹${inr.format(Math.round(n))}`;

export const discountPct = (price: number, mrp?: number) => (mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);

export function bankName(o: Offer): string {
  if (o.card) return COBRANDS.find((c) => c.id === o.card)?.name ?? o.card;
  if (o.bank === 'upi') return 'UPI';
  if (o.bank === 'wallet') return o.text.match(/bhim|paytm|phonepe|google pay|gpay|cred|mobikwik|amazon pay|super\.money|navi/i)?.[0] ?? 'Wallet';
  return BANKS.find((b) => b.id === o.bank)?.name ?? o.bank.toUpperCase();
}

export function offerShort(o: Offer): string {
  const amount = o.kind === 'percent' ? `${o.value}%` : rupees(o.value);
  const type = o.cardType === 'any' ? '' : ` ${o.cardType === 'credit' ? 'Credit' : 'Debit'}`;
  return `${amount} ${o.cashback ? 'cashback' : 'off'} · ${bankName(o)}${o.card ? '' : type}`;
}

export const STATUS_TEXT: Record<SiteResult['status'], string> = {
  ok: '',
  loading: 'Searching…',
  empty: 'Not found here',
  blocked: 'Site blocked the check',
  error: "Couldn't load",
  manual: 'Check on site',
};

/** WhatsApp-friendly summary of a comparison. */
export function summaryText(query: string, results: SiteResult[]): string {
  const ok = results.filter((r) => r.best);
  const lines = ok.map((r) => {
    const b = r.best!;
    const eff = b.effective && b.effective.mine < b.price ? ` (${rupees(b.effective.mine)} with ${bankName(b.effective.mineOffer!)})` : '';
    return `• ${r.site.name}: ${rupees(b.price)}${eff}\n  ${b.url}`;
  });
  return `🛒 "${query}" — price check\n\n${lines.join('\n')}\n\nCompared with SastaKahan`;
}
