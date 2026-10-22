import { createContext, useContext } from 'react';
import { translate, type Lang, type T } from './strings.ts';

export { LANGS, defaultLang, translate, type Key, type Lang, type T, type Vars } from './strings.ts';

export const LangContext = createContext<Lang>('en');

export function useT(): T {
  const lang = useContext(LangContext);
  return (key, vars) => translate(lang, key, vars);
}
