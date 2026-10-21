import { existsSync, readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import sites from '../config/sites.json';
import type { SiteConfig } from '../src/core/types.ts';

export const site = (id: string) => (sites.sites as SiteConfig[]).find((s) => s.id === id)!;

export function fixture(name: string): string {
  const file = ['html', 'json'].map((e) => `tests/fixtures/${name}.${e}`).find(existsSync);
  if (!file) throw new Error(`missing fixture ${name}`);
  return readFileSync(file, 'utf8');
}

export const parseHtml = (html: string) => parseHTML(html).document as unknown as Document;
