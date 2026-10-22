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
  { id: 'tata-neu-hdfc', name: 'Tata Neu Infinity HDFC', bank: 'hdfc', re: /tata neu infinity|neu ?card/i },
  { id: 'tata-neu-plus-hdfc', name: 'Tata Neu Plus HDFC', bank: 'hdfc', re: /tata neu plus/i },
  { id: 'swiggy-hdfc', name: 'Swiggy HDFC', bank: 'hdfc', re: /swiggy hdfc/i },
  { id: 'airtel-axis', name: 'Airtel Axis', bank: 'axis', re: /airtel axis/i },
  { id: 'sbi-cashback', name: 'SBI Cashback', bank: 'sbi', re: /sbi cashback/i },
  { id: 'hdfc-millennia', name: 'HDFC Millennia', bank: 'hdfc', re: /millennia/i },
  { id: 'nykaa-rbl', name: 'Nykaa RBL', bank: 'rbl', re: /nykaa rbl/i },
];

/** Payment apps that run their own offers — only useful if you have the app (My Cards → UPI apps). */
export const PAY_APPS: { id: string; name: string; re: RegExp }[] = [
  { id: 'gpay', name: 'Google Pay', re: /\bgoogle ?pay\b|\bgpay\b/i },
  { id: 'phonepe', name: 'PhonePe', re: /\bphone ?pe\b/i },
  { id: 'paytm', name: 'Paytm', re: /\bpaytm\b/i },
  { id: 'cred', name: 'CRED', re: /\bcred\b/i },
  { id: 'amazonpay', name: 'Amazon Pay UPI', re: /\bamazon ?pay\b(?!\s*icici)/i },
  { id: 'supermoney', name: 'super.money', re: /\bsuper\.?money\b/i },
  { id: 'bhim', name: 'BHIM', re: /\bbhim\b/i },
  { id: 'mobikwik', name: 'MobiKwik', re: /\bmobikwik\b/i },
  { id: 'navi', name: 'Navi', re: /\bnavi\b/i },
  { id: 'jupiter', name: 'Jupiter', re: /\bjupiter\b/i },
  { id: 'pop', name: 'POP UPI', re: /\bpop\b/i },
  { id: 'slice', name: 'slice', re: /\bslice\b/i },
  { id: 'freecharge', name: 'Freecharge', re: /\bfreecharge\b/i },
  { id: 'airtel', name: 'Airtel Thanks', re: /\bairtel (?:thanks|payments?)\b/i },
  { id: 'whatsapp', name: 'WhatsApp Pay', re: /\bwhatsapp\b/i },
  { id: 'kiwi', name: 'Kiwi', re: /\bkiwi\b/i },
  { id: 'simpl', name: 'Simpl', re: /\bsimpl\b/i },
  { id: 'lazypay', name: 'LazyPay', re: /\blazypay\b/i },
];

const num = (s: string) => parseFloat(s.replace(/,/g, ''));

// "Get ₹50 off using Zing UPI": an app we don't know yet is still one specific app, not "any UPI".
const NOT_AN_APP = new Set(['any', 'all', 'the', 'your', 'via', 'using', 'with', 'on', 'through', 'by', 'and', 'or', 'pay', 'payment', 'payments', 'select', 'selected', 'other', 'rupay', 'bank']);
function unknownApp(t: string): string | undefined {
  const m = t.match(/\b(?:using|via|with|through|on)\s+([A-Z][\w.]{1,15})\s+UPI\b/);
  return m && !NOT_AN_APP.has(m[1].toLowerCase()) ? m[1].toLowerCase() : undefined;
}

// "first-ever CRED UPI transaction", "first order", "for new users"
const NEW_USER = /\b(?:first(?:[- ]?ever)?(?:\s+[\w.]+){0,3}?\s+(?:order|transaction|txn|purchase|payment|time)s?|1st\s+(?:order|transaction|txn|purchase)|new (?:users?|customers?))\b/i;
// Coins / points aren't cash: their value depends on where you redeem them.
const POINTS = /\b(?:supercoins?|jewels|reward points?|points|coins)\b/i;
const MIN_ORDER =
  /(?:\bmov\b(?:\s*of)?|min(?:imum)?\.?\s*(?:purchase|order|txn|transaction|cart|spend|booking)?\s*(?:value|amount)?\s*(?:of)?|on (?:a )?(?:min(?:imum)?\.?\s*)?(?:purchase|order|spend|transaction)s?\s*(?:value\s*)?(?:of|above|over)|\babove|\bover|spend(?:ing)?|cart value of|orders? (?:of|above|over|worth))\s*₹\s*([\d,]+)/i;

/**
 * Parse one human offer sentence, e.g.
 *  "10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card Transactions. Min purchase value ₹5,000"
 *  "Flat ₹100 off on ICICI Debit Cards"
 *  "5% Unlimited Cashback on Flipkart Axis Bank Credit Card"
 */
export function parseOfferText(text: string, site: string, source: Offer['source'] = 'page'): Offer | null {
  const t = text.replace(/\s+/g, ' ').replace(/\bRs\.?\s*(?=\d)/gi, '₹').replace(/\bINR\s*(?=\d)/g, '₹').trim();
  if (t.length < 8 || t.length > 400) return null;

  const cobrand = COBRANDS.find((c) => c.re.test(t));
  const bank = cobrand?.bank ?? BANKS.find((b) => b.re.test(t))?.id;
  const upi = /\bupi\b/i.test(t);
  const rupay = /\brupay\b/i.test(t) && /credit/i.test(t);
  const app = PAY_APPS.find((a) => a.re.test(t))?.id ?? (upi ? unknownApp(t) : undefined);
  if (!bank && !upi && !app && !rupay) return null;

  const credit = /credit/i.test(t);
  const debit = /debit/i.test(t);
  const cardType: CardType = credit && !debit ? 'credit' : debit && !credit ? 'debit' : 'any';

  const pct = t.match(/(up\s*to\s*|upto\s*)?(\d+(?:\.\d+)?)\s*%/i);
  const flat =
    t.match(/(?:flat|extra|get|save|instant discount of|discount of)?\s*(up\s*to\s*|upto\s*)?₹\s*([\d,]+(?:\.\d+)?)\s*(?:off|instant|discount|cashback|savings?|back)/i) ??
    t.match(/^()₹\s*([\d,]+)\s/);
  const cap = t.match(/(?:up\s*to|upto|max(?:imum)?(?: discount| cashback)?(?: of)?)\s*₹\s*([\d,]+)/i);
  const min = t.match(MIN_ORDER);
  const cashback = /cash\s*back|%\s*back\b|\bback as\b/i.test(t);
  const emi = /\bemi\b/i.test(t);
  const emiOnly = emi && !/(?:emi|non[- ]emi)\s*(?:&|and|or|\/)\s*(?:non[- ]emi|emi)/i.test(t) && !/full swipe/i.test(t);

  let kind: Offer['kind'];
  let value: number;
  let upTo = false;
  if (pct) {
    kind = 'percent';
    value = num(pct[2]);
    upTo = !!pct[1];
  } else if (flat) {
    kind = 'flat';
    value = num(flat[2]);
    upTo = !!flat[1]; // "up to ₹300 cashback": could be ₹10
  } else if (/no[- ]cost emi/i.test(t)) {
    kind = 'emi';
    value = 0;
  } else {
    return null;
  }
  if (!value && kind !== 'emi') return null;
  if (kind === 'percent' && value > 80) return null;

  const offer: Offer = {
    site,
    bank: bank ?? (app ? 'wallet' : rupay ? 'rupay' : 'upi'),
    cardType: bank ? cardType : 'any',
    kind,
    value,
    text: t,
    source,
  };
  if (cobrand) offer.card = cobrand.id;
  if (!bank && app) offer.app = app;
  if (cashback) offer.cashback = true;
  if (POINTS.test(t)) offer.points = true;
  if (upTo) offer.upTo = true;
  if (NEW_USER.test(t)) offer.newUser = true;
  if (pct && cap) offer.cap = num(cap[1]);
  if (min) offer.minOrder = num(min[1]);
  if (kind === 'emi' || emiOnly) offer.emiOnly = true;
  return offer;
}

const OFFER_HINT = /(bank|credit card|debit card|cashback|instant discount|\bupi\b|\bemi\b)/i;

/** Collect bank / card offers mentioned anywhere on a product page. */
export function harvestOffers(html: string, site: string, blobs: unknown[] = extractJsonBlobs(html)): Offer[] {
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
  for (const blob of blobs) visit(blob, 0);

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
    const key = [o.site, o.bank, o.card, o.app, o.cardType, o.value, o.cap, o.minOrder, o.emiOnly, o.newUser].join('|');
    const prev = seen.get(key);
    if (!prev || (!prev.cashback && o.cashback)) seen.set(key, o);
  }
  return [...seen.values()];
}
