import type { StorageMode } from '@tagma/server/projects/contract/wire/project';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const ProjectsRepo = Repo.define(
  'projects',
  ({ single, keyed, mutation }) => ({
    list: single({
      loader: async ({ signal }, door) => (await door.perform('list_projects', {}, {}, { signal })).projects,
    }),

    groups: single({
      loader: async ({ signal }, door) => (await door.perform('list_groups', {}, {}, { signal })).groups,
    }),

    add: mutation({
      mutator: async (
        input: {
          name: string;
          rootPath: string;
          storage?: StorageMode;
          catalogs?: readonly string[];
          contributed?: Readonly<Record<string, unknown>>;
        },
        { signal },
        door,
      ) => {
        const { project, returned } = await door.perform('add_project', input, {}, { signal });
        return { project, returned };
      },
    }),

    folder: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<string>, door) => {
        const { rootPath, carries, git } = await door.perform('read_folder', { rootPath: key }, {}, { signal });
        return { rootPath, carries, git };
      },
    }),

    remove: mutation({
      mutator: async (projectId: number, { signal }, door) =>
        (await door.perform('remove_project', { ref: String(projectId) }, {}, { signal })).project,
    }),

    rename: mutation({
      mutator: async (input: { projectId: number; name: string }, { signal }, door) =>
        (await door.perform('update_project', { ref: String(input.projectId), name: input.name }, {}, { signal })).project,
    }),

    makeGroup: mutation({
      mutator: async (input: { name: string; projects: readonly number[] }, { signal }, door) =>
        await door.perform('make_group', { name: input.name, projects: input.projects.map(String) }, {}, { signal }),
    }),

    joinGroup: mutation({
      mutator: async (input: { groupId: number; projectId: number }, { signal }, door) =>
        (await door.perform('join_group', { group: String(input.groupId), project: String(input.projectId) }, {}, { signal })).group,
    }),

    leaveGroup: mutation({
      mutator: async (projectId: number, { signal }, door) =>
        (await door.perform('leave_group', { project: String(projectId) }, {}, { signal })).group,
    }),

    renameGroup: mutation({
      mutator: async (input: { groupId: number; name: string }, { signal }, door) =>
        (await door.perform('rename_group', { group: String(input.groupId), name: input.name }, {}, { signal })).group,
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

export type ProjectsRepo = InstanceOf<typeof ProjectsRepo>;
