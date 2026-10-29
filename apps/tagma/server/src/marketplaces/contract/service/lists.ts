import { Context } from 'effect';
import type { PluginComponentKind, PluginManifest } from '../../../plugins/contract/wire/rows.js';
import type { EntryPolicy } from '../wire/rows.js';

export type EntrySource =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'git'; readonly url: string; readonly path?: string; readonly ref?: string; readonly commit?: string }
  | { readonly kind: 'refused'; readonly shown: string; readonly reason: string };

export type ListedEntry = {
  readonly name: string;
  readonly source: EntrySource;
  readonly title: string | null;
  readonly description: string | null;
  readonly version: string | null;
  readonly author: string | null;
  readonly homepage: string | null;
  readonly repository: string | null;
  readonly category: string | null;
  readonly brings: readonly PluginComponentKind[];
  readonly policy: EntryPolicy | null;
  readonly manifest: PluginManifest | null;
};

export type ListedFault = { readonly name: string; readonly reason: string };

export type MarketplaceList = {
  readonly name: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly owner: string | null;
  readonly entries: readonly ListedEntry[];
  readonly faults: readonly ListedFault[];
};

export type ListRefused = { readonly refused: string };

export type ListFormat = {
  readonly id: string;
  readonly file: string;
  readonly read: (text: string) => MarketplaceList | ListRefused;
};

export class ListFormats extends Context.Service<ListFormats, readonly ListFormat[]>()('tagma/marketplaces/ListFormats') {}
