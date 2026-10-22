import { translate, type Lang } from '../strings.ts';
import { rupees } from './money.ts';
import type { Alert, WatchItem } from './watchLogic.ts';

/** Notification text for a watchlist alert, in the user's language. */
export function alertText(a: Alert, item: WatchItem, lang: Lang): { title: string; body: string } {
  const vars = { name: item.title.slice(0, 40), price: rupees(a.price), site: a.site, before: a.before ? rupees(a.before) : '' };
  return { title: translate(lang, `notif.${a.kind}.title`, vars), body: translate(lang, `notif.${a.kind}.body`, vars) };
}
