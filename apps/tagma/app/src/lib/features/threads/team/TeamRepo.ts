import type { TeamLayer } from '@runlith/agent/collaboration/team';
import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import { ThreadId } from '@tagma/server/platform/contract/wire/thread';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export type TeamPlace =
  | { readonly projectId: number; readonly threadId: string }
  | { readonly projectId: number; readonly threadId: null; readonly layer: SettableScope }
  | { readonly projectId: number; readonly threadId: null; readonly team: TeamLayer };

const readInput = (key: TeamPlace) =>
  key.threadId !== null ? { threadId: ThreadId.make(key.threadId) } : 'team' in key ? { team: key.team } : { layer: key.layer };

const at = (projectId: number) => ({ project: String(projectId) });

export const TeamRepo = Repo.define(
  'team',
  ({ keyed, mutation }) => ({
    read: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<TeamPlace>, door) => {
        const { status: _, ...read } = await door.perform('read_team', readInput(key), at(key.projectId), { signal });
        return read;
      },
    }),

    set: mutation({
      mutator: async (input: { projectId: number; threadId: string; team: TeamLayer | null }, { signal }, door) => {
        const { status: _, ...set } = await door.perform(
          'set_thread_team',
          { threadId: ThreadId.make(input.threadId), team: input.team },
          at(input.projectId),
          { signal },
        );
        return set;
      },
    }),

    promote: mutation({
      mutator: async (input: { projectId: number; threadId: string } | { projectId: number; team: TeamLayer }, { signal }, door) => {
        const { status: _, ...promoted } = await door.perform(
          'promote_thread_team',
          'team' in input ? { team: input.team } : { threadId: ThreadId.make(input.threadId) },
          at(input.projectId),
          { signal },
        );
        return promoted;
      },
    }),
  }),
  { tier: 'app', door: Door },
);

export type TeamRepo = InstanceOf<typeof TeamRepo>;

export type TeamRead = NonNullable<ReturnType<TeamRepo['read']['key']>['data']>;

export type TeamPromoted = NonNullable<TeamRepo['promote']['data']>;
