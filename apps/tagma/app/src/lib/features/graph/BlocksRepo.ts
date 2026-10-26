import { type BatchOp, batchDocument } from '@tagma/server/graph/contract/wire/batch';
import type { Delivery } from '@tagma/server/graph/contract/wire/tags/law';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import type { OperationInput } from '@tagma/server/composition/catalog';
import { GraphDoor, type GraphLens } from '$lib/features/workspace/GraphDoor.js';

export type BlockReadKey = { readonly name: string; readonly depth: number };

export type BlockDiffRange = {
  readonly name: string;
  readonly from?: number;
  readonly since?: string;
  readonly to?: number;
  readonly lens?: GraphLens;
};

type CreateBlock = OperationInput<'create_block'>;

export type BlockChanges = {
  title?: string;
  body?: string;
  status?: string;
  parentId?: string;
  ord?: number;
  fields?: Readonly<Record<string, unknown>>;
};

export const BlocksRepo = Repo.define(
  'blocks',
  ({ single, keyed, mutation }) => ({
    tree: single({
      loader: async ({ signal }, door) => (await door.perform('read_tree', {}, { signal })).blocks,
    }),

    block: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<BlockReadKey>, door) => {
        const { reads, unreachable, copyFailures } = await door.perform(
          'read_block',
          { blockIds: [key.name], depth: key.depth },
          { signal },
        );
        const read = reads[0];
        if (read === undefined) throw new Error(`read_block answered no row for ${key.name}`);
        return { ...read, unreachable, copyFailures };
      },
    }),

    titles: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<readonly string[]>, door) =>
        door.perform('read_titles', { names: key }, { signal }),
    }),

    edges: single({
      loader: async ({ signal }, door) => (await door.perform('read_edges', {}, { signal })).edges,
    }),

    refs: single({
      loader: async ({ signal }, door) => (await door.perform('read_refs', {}, { signal })).refs,
    }),

    diff: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<BlockDiffRange>, door) =>
        door.performThere(
          key.lens ?? door.lens(),
          'read_block_diff',
          {
            blockId: key.name,
            ...(key.since === undefined ? { from: key.from ?? 0 } : { since: key.since }),
            to: key.to,
          },
          { signal },
        ),
    }),

    create: mutation({
      mutator: async (input: CreateBlock, { signal }, door) => (await door.perform('create_block', input, { signal })).block,
    }),

    update: mutation({
      mutator: async (input: { name: string; changes: BlockChanges }, { signal }, door) =>
        (await door.perform('update_block', { blockId: input.name, ...input.changes }, { signal })).block,
    }),

    claim: mutation({
      mutator: (name: string, { signal }, door) => door.perform('claim_block', { blockId: name }, { signal }),
    }),

    release: mutation({
      mutator: (name: string, { signal }, door) => door.perform('release_block', { blockId: name }, { signal }),
    }),

    done: mutation({
      mutator: (input: { name: string }, { signal }, door) => door.perform('finish_block', { blockId: input.name }, { signal }),
    }),

    close: mutation({
      mutator: (name: string, { signal }, door) => door.perform('close_block', { blockId: name }, { signal }),
    }),

    accept: mutation({
      mutator: (input: { name: string; reason?: string }, { signal }, door) =>
        door.perform('accept_amendment', { blockId: input.name, reason: input.reason }, { signal }),
    }),

    reject: mutation({
      mutator: (input: { name: string; reason: string }, { signal }, door) =>
        door.perform('reject_amendment', { blockId: input.name, reason: input.reason }, { signal }),
    }),

    uphold: mutation({
      mutator: (input: { name: string; reason: string; by: readonly string[] }, { signal }, door) =>
        door.perform('uphold_amendment', { blockId: input.name, reason: input.reason, by: input.by }, { signal }),
    }),

    setLawEnabled: mutation({
      mutator: (input: { name: string; enabled: boolean }, { signal }, door) =>
        door.perform('set_rule_enabled', { blockId: input.name, enabled: input.enabled }, { signal }),
    }),

    setLawDelivery: mutation({
      mutator: (input: { name: string; delivery: Delivery | null }, { signal }, door) =>
        door.perform('set_rule_delivery', { blockId: input.name, delivery: input.delivery }, { signal }),
    }),

    unlink: mutation({
      mutator: (input: { from: string; kind: string; to: string }, { signal }, door) =>
        door.perform('unlink_blocks', { fromId: input.from, kind: input.kind, toId: input.to }, { signal }),
    }),

    trash: mutation({
      mutator: (name: string, { signal }, door) => door.perform('delete_block', { blockId: name }, { signal }),
    }),

    restore: mutation({
      mutator: (name: string, { signal }, door) => door.perform('restore_block', { blockId: name }, { signal }),
    }),

    applyBatch: mutation({
      mutator: (ops: BatchOp[], { signal }, door) => door.perform('apply_batch', batchDocument(ops), { signal }),
    }),
  }),
  { tier: 'graph', door: GraphDoor },
);
