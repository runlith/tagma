import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Page } from '@tagma/server/browser/contract/wire/page';
import { type Completion, hrefOf, originOf, searchOf, shownOf, targetOf } from './address.js';
import type { ServedAddress } from './served.js';

export type Suggestion =
  | {
      readonly kind: 'go';
      readonly url: string;
      readonly title: string | null;
      readonly icon: string | null;
      readonly label: string | null;
    }
  | { readonly kind: 'search'; readonly url: string; readonly query: string }
  | { readonly kind: 'served'; readonly url: string; readonly label: string; readonly icon: string | null }
  | { readonly kind: 'open'; readonly url: string; readonly title: string; readonly icon: string | null; readonly page: PageId }
  | { readonly kind: 'recent'; readonly url: string; readonly title: string; readonly icon: string | null };

type Listed = Extract<Suggestion, { readonly kind: 'served' | 'open' | 'recent' }>;

export type SuggestionSources = {
  readonly served: readonly ServedAddress[];
  readonly open: readonly Page[];
  readonly closed: readonly Page[];
  readonly current: PageId | null;
};

export type Listing = {
  readonly rows: readonly Listed[];
  readonly icons: ReadonlyMap<string, string>;
};

export const SECTIONS: Readonly<Record<Listed['kind'], string>> = { served: 'Running here', open: 'Open pages', recent: 'Recent' };

const LIMIT = 8;

const IDLE_RECENT = 4;

const visited = (url: string): boolean => url !== '' && url !== 'about:blank';

const titleOf = (page: Page): string => (page.title.trim() === '' ? shownOf(page.url) : page.title);

const wordsOf = (row: Listed): readonly string[] => (row.kind === 'served' ? [shownOf(row.url), row.label] : [shownOf(row.url), row.title]);

export const keyOf = (row: Suggestion): string => `${row.kind}:${row.kind === 'open' ? row.page : row.url}`;

export const spotted = (text: string, query: string): readonly number[] => {
  const at = query === '' ? -1 : text.toLowerCase().indexOf(query.toLowerCase());
  return at < 0 ? [] : Array.from({ length: query.length }, (_, step) => at + step);
};

export function listingOf(from: SuggestionSources): Listing {
  const icons = new Map<string, string>();
  for (const page of [...from.open, ...from.closed]) {
    const origin = originOf(page.url);
    if (origin !== null && page.favicon !== null && !icons.has(origin)) icons.set(origin, page.favicon);
  }
  const iconOf = (url: string): string | null => {
    const origin = originOf(url);
    return origin === null ? null : (icons.get(origin) ?? null);
  };

  const rows: Listed[] = [];
  const served = new Set<string>();
  for (const address of from.served) {
    if (served.has(address.url)) continue;
    served.add(address.url);
    rows.push({ kind: 'served', url: address.url, label: address.label, icon: iconOf(address.url) });
  }
  for (const page of from.open) {
    if (page.id === from.current || !visited(page.url)) continue;
    rows.push({ kind: 'open', url: page.url, title: titleOf(page), icon: page.favicon ?? iconOf(page.url), page: page.id });
  }
  const shut = new Set(from.open.map((page) => page.url));
  for (const page of from.closed) {
    if (!visited(page.url) || shut.has(page.url)) continue;
    shut.add(page.url);
    rows.push({ kind: 'recent', url: page.url, title: titleOf(page), icon: page.favicon ?? iconOf(page.url) });
  }
  return { rows, icons };
}

export function suggestions(typed: string, completed: Completion | null, listing: Listing): readonly Suggestion[] {
  const text = typed.trim();
  if (text === '') {
    const recent = listing.rows.filter((row) => row.kind === 'recent').slice(0, IDLE_RECENT);
    return [...listing.rows.filter((row) => row.kind !== 'recent'), ...recent];
  }
  const top = topOf(text, completed, listing);
  const lower = text.toLowerCase();
  const seen = new Set([hrefOf(top.url)]);
  const rows: Suggestion[] = [top];
  for (const row of listing.rows) {
    if (rows.length >= LIMIT) break;
    if (row.kind !== 'open' && seen.has(hrefOf(row.url))) continue;
    if (!wordsOf(row).some((word) => word.toLowerCase().includes(lower))) continue;
    seen.add(hrefOf(row.url));
    rows.push(row);
  }
  return rows;
}

function topOf(text: string, completed: Completion | null, listing: Listing): Suggestion {
  const target = completed === null ? (targetOf(text) ?? searchOf(text)) : ({ kind: 'go', url: completed.url } as const);
  if (target.kind === 'search') return target;
  const href = hrefOf(target.url);
  const known = listing.rows.find((row) => hrefOf(row.url) === href);
  const origin = originOf(target.url);
  return {
    kind: 'go',
    url: target.url,
    title: known === undefined || known.kind === 'served' ? null : known.title,
    icon: known?.icon ?? (origin === null ? null : (listing.icons.get(origin) ?? null)),
    label: known?.kind === 'served' ? known.label : null,
  };
}
