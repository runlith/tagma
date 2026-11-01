import type { AuthorshipSide } from '@tagma/server/change-record/contract/wire/authorship';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import type { Door } from '$lib/wire/Door.js';

export type AuthorshipKey = {
  readonly projectId: number;
  readonly rootId: RootId;
  readonly path: string;
  readonly context: number;
  readonly commit?: string;
  readonly base?: string;
  readonly side?: AuthorshipSide;
};

export type OpenRun = { readonly at: number; readonly lines: number };

export type OpenedAuthorship = AuthorshipKey & { readonly open: readonly OpenRun[] };

export type HistoryKey = {
  readonly projectId: number;
  readonly rootId: RootId;
  readonly path?: string;
  readonly limit: number;
  readonly cursor?: string;
};

export type CommitKey = {
  readonly projectId: number;
  readonly rootId: RootId;
  readonly commit: string;
  readonly thread?: string;
  readonly cursor?: string;
};

export type PushAim = {
  readonly rootId: RootId;
  readonly publish?: { readonly remote: string; readonly branch: string };
};

const atCommit = (
  commit: string | undefined,
  base?: string,
  side?: AuthorshipSide,
): { readonly commit?: string; readonly base?: string; readonly side?: AuthorshipSide } => ({
  commit,
  base,
  side,
});

export const pictureAddress = (door: Door, projectId: number, rootId: RootId, path: string, at: string): string =>
  door.address((routes) => routes.checkouts.picture({ params: { rootId }, query: { project: String(projectId), path, at } }));

export type PathsInRoot = { readonly rootId: RootId; readonly paths: readonly string[] };

export const CheckoutRepo = Repo.define(
  'checkout',
  ({ keyed, mutation }) => ({
    authorship: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<AuthorshipKey>, door) =>
        door
          .performIn(
            key.projectId,
            'read_authorship',
            { rootId: key.rootId, path: key.path, context: key.context, ...atCommit(key.commit, key.base, key.side) },
            { signal },
          )
          .then((read) => read.authorship),
    }),

    openRuns: mutation({
      mutator: (input: OpenedAuthorship, { signal }, door) =>
        door
          .performIn(
            input.projectId,
            'read_authorship',
            {
              rootId: input.rootId,
              path: input.path,
              context: input.context,
              open: input.open,
              ...atCommit(input.commit, input.base, input.side),
            },
            { signal },
          )
          .then((read) => read.authorship),
    }),

    history: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<HistoryKey>, door) =>
        door
          .performIn(
            key.projectId,
            'read_checkout_history',
            {
              root: key.rootId,
              ...(key.cursor !== undefined ? { cursor: key.cursor } : key.path === undefined ? {} : { path: key.path }),
              limit: key.limit,
            },
            { signal },
          )
          .then((read) => read.history),
    }),

    commitReading: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<CommitKey>, door) =>
        door
          .performIn(
            key.projectId,
            'read_commit',
            {
              root: key.rootId,
              commit: key.commit,
              thread: key.thread,
              cursor: key.cursor,
            },
            { signal },
          )
          .then((read) => read.commit),
    }),

    located: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<readonly string[]>, door) =>
        door.perform('locate_commits', { commits: key }, { signal }),
    }),

    stage: mutation({
      mutator: (input: PathsInRoot, { signal }, door) =>
        door.perform('stage_checkout', { rootId: input.rootId, paths: input.paths }, { signal }),
    }),

    unstage: mutation({
      mutator: (input: PathsInRoot, { signal }, door) =>
        door.perform('unstage_checkout', { rootId: input.rootId, paths: input.paths }, { signal }),
    }),

    discard: mutation({
      mutator: (input: PathsInRoot, { signal }, door) =>
        door.perform('discard_checkout', { rootId: input.rootId, paths: input.paths }, { signal }),
    }),

    commit: mutation({
      mutator: (
        input: { readonly rootId: RootId; readonly message: string; readonly amend?: boolean; readonly withoutFormat?: boolean },
        { signal },
        door,
      ) =>
        door.perform(
          'commit_checkout',
          {
            rootId: input.rootId,
            message: input.message,
            amend: input.amend === true ? true : undefined,
            withoutFormat: input.withoutFormat === true ? true : undefined,
          },
          { signal },
        ),
    }),

    abort: mutation({
      mutator: (input: { readonly rootId: RootId }, { signal }, door) =>
        door.perform('abort_checkout', { rootId: input.rootId }, { signal }),
    }),

    push: mutation({
      mutator: (input: PushAim, { signal }, door) =>
        door.perform(
          'push_checkout',
          {
            rootId: input.rootId,
            remote: input.publish?.remote,
            branch: input.publish?.branch,
            setUpstream: input.publish === undefined ? undefined : true,
          },
          { signal },
        ),
    }),

    fetch: mutation({
      mutator: (input: { readonly rootId: RootId }, { signal }, door) =>
        door.perform('fetch_checkout', { rootId: input.rootId }, { signal }),
    }),

    pull: mutation({
      mutator: (input: { readonly rootId: RootId }, { signal }, door) =>
        door.perform('pull_checkout', { rootId: input.rootId }, { signal }),
    }),

    sync: mutation({
      mutator: (_input: undefined, { signal }, door) => door.perform('sync_graph', {}, { signal }),
    }),
  }),
  { tier: 'graph', door: GraphDoor },
);

export type CheckoutRepo = InstanceOf<typeof CheckoutRepo>;
