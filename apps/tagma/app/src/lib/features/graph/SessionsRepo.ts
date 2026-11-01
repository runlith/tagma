import type { InstanceOf } from '@runlith/layer/key';
import { Repo } from '@runlith/query/repo';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';

export const SessionsRepo = Repo.define(
  'sessions',
  ({ single }) => ({
    list: single({
      loader: async ({ signal }, door) => {
        const first = await door.perform('list_sessions', { limit: 200 }, { signal });
        const rows = [...first.sessions];
        let cursor = first.next;
        while (cursor !== null) {
          const page = await door.perform('list_sessions', { limit: 200, cursor }, { signal });
          rows.push(...page.sessions);
          cursor = page.next;
        }
        return rows;
      },
    }),
  }),
  { tier: 'graph', door: GraphDoor },
);

export type SessionsRepo = InstanceOf<typeof SessionsRepo>;
