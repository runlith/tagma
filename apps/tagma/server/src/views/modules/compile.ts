import { createHash } from 'node:crypto';
import { graphFiles, svelteFiles } from '@runlith/tagma/plugin/bundling';
import { Schema } from 'effect';
import svelte from 'svelte/package.json' with { type: 'json' };
import { viewBuildSignature } from '../contract/wire/compile.js';
import type { WindowUtilities } from '../contract/wire/utilities.js';

export const CompiledIndex = Schema.Struct({
  modules: Schema.Record(Schema.String, Schema.String),
  icons: Schema.Record(Schema.String, Schema.String),
});
export type CompiledIndex = typeof CompiledIndex.Type;

export const INDEX_FILE = 'index.json';

export const STAGED = '.partial';

export const GONE = '.gone';

export const SOURCE = '.source';

export const hashed = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 24);

const SIGNATURE = viewBuildSignature({
  svelte: svelte.version,
  bun: Bun.version,
  bundling: hashed(`${graphFiles.toString()}\u0000${svelteFiles.toString()}`),
});

export const keyOf = (digest: string, entries: readonly string[]): string => hashed([digest, SIGNATURE, ...entries].join('\u0000'));

export const entriesOf = (views: readonly { readonly entry: string }[]): readonly string[] =>
  [...new Set(views.map((view) => view.entry))].sort();

export const stagedBy = (pid: number, id: number, part: string): string => `${pid}-${id}.${part}${STAGED}`;

export const stagerOf = (name: string): number | null => {
  const pid = name.endsWith(STAGED) ? Number(name.split('-', 1)[0]) : Number.NaN;
  return Number.isInteger(pid) ? pid : null;
};

type ViewsAsk = {
  readonly id: number;
  readonly kind: 'views';
  readonly plugin: string;
  readonly root: string;
  readonly entries: readonly string[];
  readonly place: string;
};

type SheetAsk = {
  readonly id: number;
  readonly kind: 'sheet';
  readonly utilities: WindowUtilities;
  readonly candidates: readonly string[];
  readonly out: string;
};

export type CompileAsk = ViewsAsk | SheetAsk;

export type CompileCancel = { readonly kind: 'cancel'; readonly id: number };

type Refused = {
  readonly id: number;
  readonly ok: false;
  readonly file: string | null;
  readonly message: string;
  readonly moved: boolean;
};

export type CompileAnswer =
  | { readonly id: number; readonly ok: true; readonly kind: 'views'; readonly key: string; readonly index: CompiledIndex }
  | { readonly id: number; readonly ok: true; readonly kind: 'sheet' }
  | Refused;
