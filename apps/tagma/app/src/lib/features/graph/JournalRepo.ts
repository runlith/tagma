import type { JournalSelection } from '@tagma/server/graph/contract/wire/journal';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';

export type JournalWindow = {
  readonly scopeName?: string;
  readonly before?: number;
  readonly since?: number;
  readonly limit?: number;
} & JournalSelection;

export const JournalRepo = Repo.define(
  'journal',
  ({ keyed }) => ({
    batches: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<JournalWindow>, door) =>
        door.performAt(
          'read_journal',
          {
            before: key.before,
            since: key.since,
            limit: key.limit,
            tags: key.tags === undefined || key.tags.length === 0 ? undefined : key.tags,
            sessions: key.sessions === undefined || key.sessions.length === 0 ? undefined : key.sessions,
            ops: key.ops === undefined || key.ops.length === 0 ? undefined : key.ops,
          },
          key.scopeName,
          { signal },
        ),
    }),

    vocabulary: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<string | undefined>, door) =>
        door.performAt('read_journal_vocabulary', {}, key, { signal }),
    }),
  }),
  { tier: 'graph', door: GraphDoor },
);
