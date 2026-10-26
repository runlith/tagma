import type { StorageMode } from '@tagma/server/projects/contract/wire/project';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const ProjectsRepo = Repo.define(
  'projects',
  ({ single, keyed, mutation }) => ({
    list: single({
      loader: async ({ signal }, door) => (await door.perform('list_projects', {}, {}, { signal })).projects,
    }),

    add: mutation({
      mutator: async (
        input: { name: string; rootPath: string; storage?: StorageMode; catalogs?: readonly string[]; graphRemote?: string },
        { signal },
        door,
      ) => {
        const { project, returned } = await door.perform('add_project', input, {}, { signal });
        return { project, returned };
      },
    }),

    remove: mutation({
      mutator: async (projectId: number, { signal }, door) =>
        (await door.perform('remove_project', { ref: String(projectId) }, {}, { signal })).project,
    }),

    roots: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) =>
        (await door.perform('list_root_blocks', {}, { project: String(key) }, { signal })).blocks,
    }),

    branches: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) =>
        (await door.perform('list_branches', {}, { project: String(key) }, { signal })).branches,
    }),
  }),
  { tier: 'app', door: Door },
);
