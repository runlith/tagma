import type { HistoryCommit } from '@tagma/server/workspace/contract/wire/history';
import type { ConversationHit } from '@tagma/server/threads/contract/wire/conversation';
import type { SearchHit } from '@tagma/server/graph/contract/wire/reads';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const PALETTE_PAGE = 20;

export type Page<Row, Extra = null> = {
  readonly rows: readonly Row[];
  readonly total: number | null;
  readonly atLeast: number | null;
  readonly next: string | null;
  readonly approximate: boolean;
  readonly extra: Extra;
};

export type ThreadsCoverage = { readonly complete: boolean; readonly unindexed: number };

export type ThreadsAsk = {
  readonly projectId: number;
  readonly query: string;
  readonly reach: 'project' | 'all';
  readonly projectName: string;
  readonly cursor: string | null;
};

export type BlocksAsk = {
  readonly projectId: number;
  readonly query: string;
  readonly tag: string | null;
  readonly status: string | null;
  readonly cursor: string | null;
};

export type CommitsAsk = { readonly projectId: number; readonly grep: string; readonly cursor: string | null };

const at = (projectId: number): { project: string } => ({ project: String(projectId) });

export const PaletteRepo = Repo.define(
  'palette',
  ({ keyed }) => ({
    threads: keyed({
      gcTime: 0,
      refetchOnWindowFocus: false,
      loader: async ({ key, signal }: KeyedLoaderContext<ThreadsAsk>, door): Promise<Page<ConversationHit, ThreadsCoverage>> => {
        const found = await door.perform(
          'search_threads',
          {
            query: key.query,
            projects: key.reach === 'all' ? 'all' : [key.projectName],
            limit: PALETTE_PAGE,
            cursor: key.cursor ?? undefined,
          },
          at(key.projectId),
          { signal },
        );
        return {
          rows: found.matches,
          total: found.total,
          atLeast: found.atLeast ?? null,
          next: found.cursor,
          approximate: found.approximate === true,
          extra: found.coverage,
        };
      },
    }),

    blocks: keyed({
      gcTime: 0,
      refetchOnWindowFocus: false,
      loader: async ({ key, signal }: KeyedLoaderContext<BlocksAsk>, door): Promise<Page<SearchHit>> => {
        const found = await door.perform(
          'search_blocks',
          {
            query: key.query,
            tag: key.tag ?? undefined,
            status: key.status ?? undefined,
            cursor: key.cursor ?? undefined,
            limit: PALETTE_PAGE,
          },
          at(key.projectId),
          { signal },
        );
        return {
          rows: found.blocks,
          total: found.total,
          atLeast: null,
          next: found.next,
          approximate: found.approximate === true,
          extra: null,
        };
      },
    }),

    commits: keyed({
      gcTime: 0,
      refetchOnWindowFocus: false,
      loader: async ({ key, signal }: KeyedLoaderContext<CommitsAsk>, door): Promise<Page<HistoryCommit>> => {
        const { history } = await door.perform(
          'read_checkout_history',
          { grep: key.grep, limit: PALETTE_PAGE, cursor: key.cursor ?? undefined },
          at(key.projectId),
          { signal },
        );
        return { rows: history.commits, total: history.total, atLeast: null, next: history.next, approximate: false, extra: null };
      },
    }),
  }),
  { tier: 'app', door: Door },
);

export type PaletteRepo = InstanceOf<typeof PaletteRepo>;
