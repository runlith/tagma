import type { RepositoryBinding } from '@tagma/server/workspace/contract/wire/repositories';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { RequestKey } from '@tagma/server/platform/contract/wire/ids';
import type { RenameRemote, WorktreeMode } from '@tagma/server/worktrees/contract/wire/creation';
import type { MergeAfter, MergeMode } from '@tagma/server/worktrees/contract/wire/mergeTypes';
import { Repo } from '@runlith/query/repo';
import { ThreadId } from '@tagma/server/platform/contract/wire/thread';
import { Door } from '$lib/wire/Door.js';

function at(projectId: number): { project: string } {
  return { project: String(projectId) };
}

type Bare<Answer> = Answer extends unknown ? Omit<Answer, 'status'> : never;

const bare = <Answer extends { readonly status: string }>({ status: _status, ...rest }: Answer): Bare<Answer> => rest as Bare<Answer>;

export const WorktreesRepo = Repo.define(
  'worktrees',
  ({ mutation }) => ({
    stores: mutation({
      mutator: (input: { projectId: number; path?: string }, { signal }, door) =>
        door.perform('read_repositories', input.path === undefined ? {} : { path: input.path }, at(input.projectId), { signal }),
    }),

    prepare: mutation({
      mutator: (input: { projectId: number; operationId: string; repository: RepositoryBinding; mode: WorktreeMode }, { signal }, door) =>
        door
          .perform(
            'prepare_worktree',
            { operationId: RequestKey.make(input.operationId), repository: input.repository, mode: input.mode },
            at(input.projectId),
            { signal },
          )
          .then(bare),
    }),

    create: mutation({
      mutator: (input: { projectId: number; operationId: string }, { signal }, door) =>
        door
          .perform('create_worktree', { operationId: RequestKey.make(input.operationId) }, at(input.projectId), { signal })
          .then((answer) => answer.operation),
    }),

    check: mutation({
      mutator: (input: { projectId: number; rootId: RootId }, { signal }, door) =>
        door.perform('check_worktree_merge', { rootId: input.rootId }, at(input.projectId), { signal }).then((answer) => answer.merge),
    }),

    merge: mutation({
      mutator: (
        input: {
          projectId: number;
          rootId: RootId;
          mode: MergeMode;
          after: MergeAfter;
          whenBaseFree: boolean;
          message?: string;
        },
        { signal },
        door,
      ) =>
        door
          .perform(
            'merge_worktree',
            {
              rootId: input.rootId,
              mode: input.mode,
              after: input.after,
              whenBaseFree: input.whenBaseFree,
              message: input.message,
            },
            at(input.projectId),
            { signal },
          )
          .then(bare),
    }),

    cancelMerge: mutation({
      mutator: (input: { projectId: number; rootId: RootId }, { signal }, door) =>
        door.perform('cancel_worktree_merge', { rootId: input.rootId }, at(input.projectId), { signal }).then(bare),
    }),

    pullRequest: mutation({
      mutator: (input: { projectId: number; rootId: RootId }, { signal }, door) =>
        door.perform('open_worktree_pr', { rootId: input.rootId }, at(input.projectId), { signal }).then(bare),
    }),

    rename: mutation({
      mutator: (input: { projectId: number; rootId: RootId; name: string; remote: RenameRemote }, { signal }, door) =>
        door
          .perform('rename_worktree', { rootId: input.rootId, name: input.name, remote: input.remote }, at(input.projectId), { signal })
          .then(bare),
    }),

    remove: mutation({
      mutator: (input: { projectId: number; rootId: RootId }, { signal }, door) =>
        door.perform('delete_worktree', { rootId: input.rootId }, at(input.projectId), { signal }).then(bare),
    }),

    update: mutation({
      mutator: (input: { projectId: number; rootId: RootId }, { signal }, door) =>
        door.perform('update_worktree', { rootId: input.rootId }, at(input.projectId), { signal }),
    }),

    cleanup: mutation({
      mutator: (input: { projectId: number; idleAfterDays: number; limit: number; cursor?: string }, { signal }, door) =>
        door
          .perform(
            'list_worktree_cleanup',
            {
              idleAfterDays: input.idleAfterDays,
              limit: input.limit,
              cursor: input.cursor,
            },
            at(input.projectId),
            { signal },
          )
          .then((answer) => answer.cleanup),
    }),

    clean: mutation({
      mutator: (input: { projectId: number; rootIds: readonly RootId[]; idleAfterDays: number }, { signal }, door) =>
        door
          .perform(
            'clean_up_worktrees',
            {
              rootIds: input.rootIds,
              idleAfterDays: input.idleAfterDays,
            },
            at(input.projectId),
            { signal },
          )
          .then(bare),
    }),

    move: mutation({
      mutator: (input: { projectId: number; threadId: string; worktree: string; home?: number }, { signal }, door) =>
        door.perform(
          'move_thread',
          { threadId: ThreadId.make(input.threadId), worktree: input.worktree, ...(input.home === undefined ? {} : { home: input.home }) },
          at(input.projectId),
          { signal },
        ),
    }),
  }),
  { tier: 'app', door: Door },
);
