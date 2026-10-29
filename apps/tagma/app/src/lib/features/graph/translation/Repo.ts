import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import type { OperationInput } from '@tagma/server/composition/catalog';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';

export type TranslationKey = { readonly block: string; readonly language?: string };

export const TranslationsRepo = Repo.define(
  'translations',
  ({ keyed, mutation }) => ({
    read: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<TranslationKey>, door) =>
        door.perform('read_block_translation', { block: key.block, language: key.language }, { signal }),
    }),

    translate: mutation({
      mutator: (input: OperationInput<'translate_block'>, { signal }, door) => door.perform('translate_block', input, { signal }),
    }),

    stop: mutation({
      mutator: (input: OperationInput<'stop_block_translation'>, { signal }, door) =>
        door.perform('stop_block_translation', input, { signal }),
    }),
  }),
  { tier: 'graph', door: GraphDoor },
);
