import type { BlockAnswer } from '@tagma/server/graph/contract/wire/answers';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door, type Lens } from '$lib/wire/Door.js';

const PALETTE_PAGE_SIZE = 40;

export type SearchInput = {
  readonly query: string;
  readonly projectId?: number;
  readonly branch?: string | null;
  readonly tag?: string;
  readonly status?: string;
  readonly cursor?: string;
};

export type SelectionAim = { readonly projectId: number; readonly branch: string | null };

function lensOf(aim: SelectionAim): Lens {
  return { project: String(aim.projectId), branch: aim.branch ?? undefined };
}

export const SelectionRepo = Repo.define(
  'selection',
  ({ keyed }) => ({
    search: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<SearchInput>, door) => {
        const page = await door.perform(
          'search_blocks',
          {
            query: key.query,
            tag: key.tag,
            status: key.status,
            cursor: key.cursor,
            limit: PALETTE_PAGE_SIZE,
          },
          {
            project: key.projectId === undefined ? undefined : String(key.projectId),
            branch: key.branch === undefined || key.branch === null ? undefined : key.branch,
          },
          { signal },
        );
        return { items: page.blocks, total: page.total, next: page.next, approximate: page.approximate === true };
      },
    }),

    ready: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<SelectionAim>, door) => {
        const rows: BlockAnswer[] = [];
        let cursor: string | null = null;
        do {
          const page: { readonly tasks: readonly BlockAnswer[]; readonly next: string | null } = await door.perform(
            'ready_work',
            cursor === null ? {} : { cursor },
            lensOf(key),
            { signal },
          );
          rows.push(...page.tasks);
          cursor = page.next;
        } while (cursor !== null);
        return rows;
      },
    }),

    trash: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<SelectionAim>, door) =>
        (await door.perform('list_trash', {}, lensOf(key), { signal })).blocks,
    }),
  }),
  { tier: 'app', door: Door },
);

export type SelectionRepo = InstanceOf<typeof SelectionRepo>;
