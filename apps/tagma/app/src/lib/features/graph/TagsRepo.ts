import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const TagsRepo = Repo.define(
  'tags',
  ({ keyed }) => ({
    of: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door): Promise<Vocabulary> => {
        const { catalogs, installed, findings, tags, unreadable, actions, fieldNames, forms, laws, revision } = await door.perform(
          'read_vocabulary',
          {},
          { project: String(key) },
          { signal },
        );
        return { catalogs, installed, findings, tags, unreadable, actions, fieldNames, forms, laws, revision };
      },
    }),
  }),
  { tier: 'app', door: Door },
);
