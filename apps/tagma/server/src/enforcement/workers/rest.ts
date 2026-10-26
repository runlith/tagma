import { Option, Schema } from 'effect';
import { type Rested, restedOf, restore } from './treeMemo.js';

type RestStore = { readonly get: (key: string) => unknown; readonly set: (key: string, value: unknown) => void };

const rested = Schema.Struct({
  entries: Schema.Array(Schema.Tuple([Schema.String, Schema.Array(Schema.String), Schema.Array(Schema.String), Schema.Boolean])),
  trees: Schema.Array(Schema.Tuple([Schema.String, Schema.Array(Schema.String)])),
  listings: Schema.Array(
    Schema.Struct({
      tree: Schema.String,
      parts: Schema.String,
      entry: Schema.Finite,
      bytes: Schema.Finite,
      paths: Schema.Array(Schema.String),
      objects: Schema.Array(Schema.String),
      sizes: Schema.Array(Schema.Finite),
    }),
  ),
}) satisfies Schema.Codec<Rested>;

const keyOf = (root: string): string => `rest:${root}`;

export const woken = (store: RestStore, root: string): void => {
  const held = Schema.decodeUnknownOption(rested)(store.get(keyOf(root)));
  if (Option.isSome(held)) restore(root, held.value);
};

export const rest = (store: RestStore, root: string): void => {
  store.set(keyOf(root), restedOf(root));
};
