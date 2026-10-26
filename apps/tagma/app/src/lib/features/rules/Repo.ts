import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import type { OperationInput } from '@tagma/server/composition/catalog';

export type EngineKey = { readonly rule: string; readonly focus: string | null };

export type MoreKey = { readonly rule: string | null; readonly cursor: string };

const WHOLE = 500;

export const RulesRepo = Repo.define(
  'rules',
  ({ single, keyed, mutation }) => ({
    config: single({
      loader: ({ signal }, door) => door.perform('read_config', {}, { signal }),
    }),

    trial: mutation({
      mutator: (input: { inspection: string; blockId: string }, { signal }, door) =>
        door.perform('check_rules', { over: 'all', inspection: input.inspection, blockId: input.blockId, limit: 1 }, { signal }),
    }),

    enforce: mutation({
      mutator: (input: OperationInput<'enforce_rule'>, { signal }, door) => door.perform('enforce_rule', input, { signal }),
    }),

    rules: single({
      loader: ({ signal }, door) => door.perform('read_enforcement', { limit: WHOLE }, { signal }),
    }),

    engine: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<EngineKey>, door) =>
        door.perform('read_enforcement', { rule: key.rule, limit: WHOLE, focus: key.focus ?? undefined }, { signal }),
    }),

    more: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<MoreKey>, door) =>
        door.perform('read_enforcement', { cursor: key.cursor, limit: WHOLE, rule: key.rule ?? undefined }, { signal }),
    }),
  }),
  { tier: 'graph', door: GraphDoor },
);
