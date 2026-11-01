import { ThreadId } from '@tagma/server/platform/contract/wire/thread';
import { THREAD_WORK_ROWS } from '@tagma/server/graph/contract/wire/threadWork';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';
import type { GraphAim } from '$lib/features/workspace/GraphRung.js';

export type ThreadWorkKey = { readonly projectId: number; readonly threadId: string; readonly cursor: string | null };

export type WorkStart = { readonly name: string; readonly title: string; readonly copy: GraphAim };

export const ThreadWorkRepo = Repo.define(
  'thread-work',
  ({ keyed, mutation }) => ({
    work: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<ThreadWorkKey>, door) => {
        const { status: _, ...work } = await door.perform(
          'read_thread_work',
          { threadId: ThreadId.make(key.threadId), limit: THREAD_WORK_ROWS, cursor: key.cursor ?? undefined },
          { project: String(key.projectId) },
          { signal },
        );
        return work;
      },
    }),
    start: mutation({
      mutator: async (input: WorkStart, { signal }, door) => {
        const { status: _, ...born } = await door.perform(
          'create_thread',
          { title: input.title, work: input.name, worktree: input.copy.branch ?? undefined },
          { project: String(input.copy.projectId), branch: input.copy.branch ?? undefined },
          { signal },
        );
        return born.snapshot.thread.id;
      },
    }),
  }),
  { tier: 'app', door: Door },
);

export type ThreadWorkRepo = InstanceOf<typeof ThreadWorkRepo>;
