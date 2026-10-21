// Turning what shopping apps put in the Share sheet into a clean product name.

const STORES =
  'amazon(?:\\.in)?|flipkart(?:\\.com)?|myntra|nykaa(?: fashion)?|meesho|ajio|tata ?cliq|croma|reliance digital|jiomart|purplle|smytten|vijay sales';

/** Strip store suffixes and SEO filler from a page <title> / og:title. */
export function cleanStoreTitle(t: string): string {
  return t
    .replace(/\s+-\s+Buy\s.*$/i, '') // Flipkart: "X - Buy X Online at Best Price - … | Flipkart.com"
    .replace(new RegExp(`\\s*[:|-]\\s*(${STORES})\\b.*$`, 'i'), '')
    .replace(/^Buy\s+/i, '')
    .replace(/\s*-\s*Price in India.*$/i, '')
    .replace(/\s+(Online )?at (Best|Lowest) Price.*$/i, '')
    .replace(/\s*:\s*[A-Z][\w &]+$/, '') // Amazon's trailing ": Beauty"
    .replace(/\s+\d{6,}$/, '') // Myntra's trailing style id
    .trim();
}

/**
 * Shared text is the app's share message, not just the product name, e.g.
 * "Check this out on Flipkart! Take a look at this GEL-KAYANO 32 Running Shoes For Unisex https://dl.flipkart.com/s/…".
 * Remove the boilerplate so only the product is left (may be empty).
 */
export function cleanSharedText(text: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^\s*(hey|hi|hello|wow|omg)\b[\s!,.]*/i, ' ')
    .replace(/\bcheck\s*(this|it)?\s*out\b/gi, ' ')
    .replace(/\b(take|have)\s+a\s+look\s+at\b|\blook what i found\b|\bi found\b|\bi'?m loving\b/gi, ' ')
    .replace(new RegExp(`\\b(on|at|from|via)\\s+(the\\s+)?(${STORES})(\\s+app)?\\b`, 'gi'), ' ')
    .replace(/\b(for|at|only|just)?\s*(₹|\brs\.?|\binr)\s*[\d,]+(\.\d+)?(\s*only)?/gi, ' ')
    .replace(/\b(buy|shop|order)\s+now\b|\bdownload the app\b/gi, ' ')
    .replace(/\s*[!:]+\s*/g, ' ')
    .replace(/^\s*(this|these)(\s+(amazing|awesome|great|cool|product|item|deal))*\b/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.\-|]+|[\s,.\-|]+$/g, '');
  return cleanStoreTitle(cleaned);
}

/** Page titles that aren't a product: bot checks, home pages, errors. */
export function isProductTitle(t: string | undefined): t is string {
  if (!t || t.length < 8) return false;
  if (/robot check|captcha|access denied|are you a human|page not found|something went wrong|online shopping/i.test(t)) return false;
  return !new RegExp(`^(${STORES})(\\.\\w+)?$`, 'i').test(t.trim());
}
