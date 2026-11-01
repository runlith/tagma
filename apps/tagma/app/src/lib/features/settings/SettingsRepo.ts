import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const SettingsRepo = Repo.define(
  'settings',
  ({ keyed, mutation }) => ({
    catalog: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) =>
        (await door.perform('read_settings', {}, { project: String(key) }, { signal })).settings,
    }),

    inventory: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) => {
        const { status: _, ...inventory } = await door.perform('read_workspace_sources', {}, { project: String(key) }, { signal });
        return inventory;
      },
    }),

    config: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) => {
        const { status: _, ...read } = await door.perform('read_config', {}, { project: String(key) }, { signal });
        return read;
      },
    }),

    write: mutation({
      mutator: async (
        input: {
          projectId: number;
          scope: SettableScope;
          key: string;
          value?: unknown;
          declined?: boolean;
        },
        { signal },
        door,
      ) => {
        const { projectId, ...payload } = input;
        const { settings } = await door.perform('write_setting_layer', payload, { project: String(projectId) }, { signal });
        return { projectId, settings };
      },
    }),

    summarizers: mutation({
      mutator: async (input: { projectId: number; layer: SettableScope }, { signal }, door) => {
        const { status: _, ...chain } = await door.perform(
          'read_compaction_summarizers',
          { layer: input.layer },
          { project: String(input.projectId) },
          { signal },
        );
        return chain;
      },
    }),

    reloadSources: mutation({
      mutator: async (projectId: number, { signal }, door) => {
        const { status: _, ...inventory } = await door.perform('reload_workspace_sources', {}, { project: String(projectId) }, { signal });
        return inventory;
      },
    }),
  }),
  { tier: 'app', door: Door },
);

export type SettingsRepo = InstanceOf<typeof SettingsRepo>;

type WrittenCatalog = NonNullable<SettingsRepo['write']['data']>['settings'];

export const writtenCatalog = (settings: SettingsRepo, projectId: number): WrittenCatalog | undefined => {
  const written = settings.write.data;
  return written?.projectId === projectId ? written.settings : undefined;
};
