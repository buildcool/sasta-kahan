import { extractJsonBlobs } from './extract.ts';
import type { CardType, Offer } from './types.ts';

/** Bank id → patterns that identify it in offer text. Order matters (co-brands first). */
export const BANKS: { id: string; name: string; re: RegExp }[] = [
  { id: 'hdfc', name: 'HDFC Bank', re: /\bhdfc\b/i },
  { id: 'icici', name: 'ICICI Bank', re: /\bicici\b/i },
  { id: 'sbi', name: 'SBI Card', re: /\bsbi\b|state bank/i },
  { id: 'axis', name: 'Axis Bank', re: /\baxis\b/i },
  { id: 'kotak', name: 'Kotak', re: /\bkotak\b/i },
  { id: 'idfc', name: 'IDFC FIRST', re: /\bidfc\b/i },
  { id: 'indusind', name: 'IndusInd', re: /\bindusind\b/i },
  { id: 'bob', name: 'Bank of Baroda', re: /\bbob(card)?\b|bank of baroda/i },
  { id: 'yes', name: 'YES Bank', re: /\byes bank\b/i },
  { id: 'au', name: 'AU Bank', re: /\bau (small finance )?bank\b/i },
  { id: 'rbl', name: 'RBL Bank', re: /\brbl\b/i },
  { id: 'hsbc', name: 'HSBC', re: /\bhsbc\b/i },
  { id: 'sc', name: 'Standard Chartered', re: /standard chartered/i },
  { id: 'federal', name: 'Federal Bank', re: /\bfederal bank\b/i },
  { id: 'amex', name: 'American Express', re: /\bamex\b|american express/i },
  { id: 'onecard', name: 'OneCard', re: /\bone ?card\b/i },
  { id: 'canara', name: 'Canara Bank', re: /\bcanara\b/i },
  { id: 'pnb', name: 'PNB', re: /\bpnb\b|punjab national/i },
  { id: 'union', name: 'Union Bank', re: /\bunion bank\b/i },
  { id: 'dbs', name: 'DBS', re: /\bdbs\b/i },
];

/** Co-branded cards that get site-specific rewards. */
export const COBRANDS: { id: string; name: string; bank: string; re: RegExp }[] = [
  { id: 'amazon-pay-icici', name: 'Amazon Pay ICICI', bank: 'icici', re: /amazon pay icici/i },
  { id: 'flipkart-axis', name: 'Flipkart Axis', bank: 'axis', re: /flipkart axis/i },
  { id: 'flipkart-sbi', name: 'Flipkart SBI', bank: 'sbi', re: /flipkart sbi/i },
  { id: 'myntra-kotak', name: 'Myntra Kotak', bank: 'kotak', re: /myntra kotak/i },
  { id: 'tata-neu-hdfc', name: 'Tata Neu HDFC', bank: 'hdfc', re: /tata neu|neucard/i },
  { id: 'swiggy-hdfc', name: 'Swiggy HDFC', bank: 'hdfc', re: /swiggy hdfc/i },
  { id: 'airtel-axis', name: 'Airtel Axis', bank: 'axis', re: /airtel axis/i },
  { id: 'sbi-cashback', name: 'SBI Cashback', bank: 'sbi', re: /sbi cashback/i },
  { id: 'hdfc-millennia', name: 'HDFC Millennia', bank: 'hdfc', re: /millennia/i },
  { id: 'nykaa-rbl', name: 'Nykaa RBL', bank: 'rbl', re: /nykaa rbl/i },
];

const num = (s: string) => parseFloat(s.replace(/,/g, ''));

/**
 * Parse one human offer sentence, e.g.
 *  "10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card Transactions. Min purchase value ₹5,000"
 *  "Flat ₹100 off on ICICI Debit Cards"
 *  "5% Unlimited Cashback on Flipkart Axis Bank Credit Card"
 */
export function parseOfferText(text: string, site: string, source: Offer['source'] = 'page'): Offer | null {
  const t = text.replace(/\s+/g, ' ').replace(/\bRs\.?\s*(?=\d)/gi, '₹').trim();
  if (t.length < 8 || t.length > 400) return null;

  const cobrand = COBRANDS.find((c) => c.re.test(t));
  const bank = cobrand?.bank ?? BANKS.find((b) => b.re.test(t))?.id;
  const upi = /\bupi\b/i.test(t);
  // Offers tied to one payment app (BHIM, Paytm, CRED...) — not something every user has.
  const wallet = /\b(bhim|paytm|phonepe|google pay|gpay|cred|mobikwik|amazon pay (?:upi|balance|later)|super\.money|navi)\b/i.test(t);
  if (!bank && !upi && !wallet) return null;

  const credit = /credit/i.test(t);
  const debit = /debit/i.test(t);
  const cardType: CardType = credit && !debit ? 'credit' : debit && !credit ? 'debit' : 'any';

  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  const flat = t.match(/(?:flat|extra|get|save|instant discount of|discount of)?\s*₹\s*([\d,]+(?:\.\d+)?)\s*(?:off|instant|discount|cashback|savings?)/i)
    ?? t.match(/^₹\s*([\d,]+)\s/);
  const cap = t.match(/(?:up\s*to|upto|max(?:imum)?(?: discount)?(?: of)?)\s*₹\s*([\d,]+)/i);
  const min = t.match(/(?:min(?:imum)?\.?\s*(?:purchase|order|txn|transaction|cart)?\s*(?:value|amount)?\s*(?:of)?|above|on orders? (?:of|above)|spend(?:ing)?)\s*₹\s*([\d,]+)/i);
  const cashback = /cash\s*back|%\s*back\b/i.test(t);
  const emi = /\bemi\b/i.test(t);
  const emiOnly = emi && !/(?:emi|non[- ]emi)\s*(?:&|and|or|\/)\s*(?:non[- ]emi|emi)/i.test(t) && !/full swipe/i.test(t);

  let kind: Offer['kind'];
  let value: number;
  if (pct) {
    kind = 'percent';
    value = num(pct[1]);
  } else if (flat) {
    kind = 'flat';
    value = num(flat[1]);
  } else if (/no[- ]cost emi/i.test(t)) {
    kind = 'emi';
    value = 0;
  } else {
    return null;
  }
  if (!value && kind !== 'emi') return null;
  if (kind === 'percent' && value > 80) return null;

  return {
    site,
    bank: bank ?? (wallet ? 'wallet' : 'upi'),
    cardType: bank ? cardType : 'any',
    card: cobrand?.id,
    kind,
    cashback: cashback || undefined,
    value,
    cap: pct && cap ? num(cap[1]) : undefined,
    minOrder: min ? num(min[1]) : undefined,
    emiOnly: kind === 'emi' || emiOnly || undefined,
    text: t,
    source,
  };
}

const OFFER_HINT = /(bank|credit card|debit card|cashback|instant discount|\bupi\b|\bemi\b)/i;

/** Collect bank / card offers mentioned anywhere on a product page. */
export function harvestOffers(html: string, site: string): Offer[] {
  const found: Offer[] = [];
  const texts = new Set<string>();

  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 60) return;
    if (typeof node === 'string') {
      if (node.length < 300 && OFFER_HINT.test(node) && /[%₹]|rs\.?\s*\d/i.test(node)) texts.add(node);
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    // Flipkart: {type: "NepOffers", offerTitle: "Flipkart Axis", offerSubTitleRC: "Credit Card • Cashback", discountedPriceText: "₹14 off"}
    if (o.type === 'NepOffers' && typeof o.offerTitle === 'string' && typeof o.discountedPriceText === 'string') {
      const sub = JSON.stringify(o.offerSubTitleRC ?? '').match(/"contentValue":"([^"]+)"/)?.[1] ?? '';
      texts.add(`${o.discountedPriceText} on ${o.offerTitle} ${sub}`.replace(/•/g, ''));
    }
    for (const k in o) visit(o[k], depth + 1);
  };
  for (const blob of extractJsonBlobs(html)) visit(blob, 0);

  // Visible text too (sites that render offers in HTML).
  const plain = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&#8377;|&#x20B9;/g, '₹');
  for (const line of plain.split(/\n+/)) {
    const l = line.trim();
    if (l.length < 300 && OFFER_HINT.test(l) && /[%₹]/.test(l)) texts.add(l);
  }

  for (const t of texts) {
    const o = parseOfferText(t, site);
    if (o) found.push(o);
  }
  return dedupeOffers(found);
}

export function dedupeOffers(offers: Offer[]): Offer[] {
  const seen = new Map<string, Offer>();
  for (const o of offers) {
    // Same offer is often listed twice (pill + bottom sheet), once without the word "cashback".
    const key = [o.site, o.bank, o.card, o.cardType, o.value, o.cap, o.minOrder, o.emiOnly].join('|');
    const prev = seen.get(key);
    if (!prev || (!prev.cashback && o.cashback)) seen.set(key, o);
  }
  return [...seen.values()];
}
