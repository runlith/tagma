import { Schema } from 'effect';
import type { ViewGraph } from '../contract/wire/graph.js';

export const CompiledIndex = Schema.Struct({
  modules: Schema.Record(Schema.String, Schema.String),
  icons: Schema.Record(Schema.String, Schema.String),
});
export type CompiledIndex = typeof CompiledIndex.Type;

export const INDEX_FILE = 'index.json';

export type CompileAsk = {
  readonly id: number;
  readonly kind: 'views';
  readonly root: string;
  readonly graph: ViewGraph;
  readonly entries: readonly string[];
  readonly icons: readonly string[];
  readonly out: string;
  readonly publicPath: string;
};

export type CompileAnswer =
  | { readonly id: number; readonly ok: true; readonly index: CompiledIndex }
  | { readonly id: number; readonly ok: false; readonly file: string | null; readonly message: string };
