import { Schema } from 'effect';
import type { ViewGraph } from '../contract/wire/graph.js';
import type { WindowUtilities } from '../contract/wire/utilities.js';

export const CompiledIndex = Schema.Struct({
  modules: Schema.Record(Schema.String, Schema.String),
  icons: Schema.Record(Schema.String, Schema.String),
});
export type CompiledIndex = typeof CompiledIndex.Type;

export const INDEX_FILE = 'index.json';

type ViewsAsk = {
  readonly id: number;
  readonly kind: 'views';
  readonly root: string;
  readonly graph: ViewGraph;
  readonly entries: readonly string[];
  readonly icons: readonly string[];
  readonly out: string;
  readonly publicPath: string;
};

type SheetAsk = {
  readonly id: number;
  readonly kind: 'sheet';
  readonly utilities: WindowUtilities;
  readonly candidates: readonly string[];
  readonly out: string;
};

export type CompileAsk = ViewsAsk | SheetAsk;

type Refused = { readonly id: number; readonly ok: false; readonly file: string | null; readonly message: string };

export type CompileAnswer =
  | { readonly id: number; readonly ok: true; readonly kind: 'views'; readonly index: CompiledIndex }
  | { readonly id: number; readonly ok: true; readonly kind: 'sheet' }
  | Refused;
