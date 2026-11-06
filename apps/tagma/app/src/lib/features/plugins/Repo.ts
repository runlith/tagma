import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { PluginPreview, PluginRow } from '@tagma/server/plugins/contract/wire/rows';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door, type Lens } from '$lib/wire/Door.js';

const lens = (projectId: number): Lens => ({ project: String(projectId) });

const PAGE = 8;

const THREADS_SHOWN = 8;

export type PluginTarget = { readonly projectId: number; readonly id: string };

export type PluginReach = { readonly enabled: boolean; readonly scope: SettableScope };

export type EntryTarget = { readonly projectId: number; readonly marketplace: string; readonly entry: string };

export type Found =
  | {
      readonly kind: 'marketplace';
      readonly name: string;
      readonly title: string | null;
      readonly description: string | null;
      readonly entries: number;
    }
  | { readonly kind: 'plugin'; readonly preview: PluginPreview };

export const PluginsRepo = Repo.define(
  'plugins',
  ({ keyed, mutation }) => ({
    plugins: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) => {
        const rows: PluginRow[] = [];
        let cursor: string | undefined;
        do {
          const page = await door.perform('read_plugins', cursor === undefined ? { limit: PAGE } : { limit: PAGE, cursor }, lens(key), {
            signal,
          });
          rows.push(...page.plugins);
          cursor = page.next ?? undefined;
        } while (cursor !== undefined);
        return rows;
      },
    }),

    asks: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<PluginTarget>, door) =>
        door.perform('read_ask_usage', { plugin: key.id }, lens(key.projectId), { signal }),
    }),

    threads: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<PluginTarget>, door) => {
        const answer = await door.perform(
          'list_threads',
          { plugin: key.id, set: 'live', shape: 'facts', limit: THREADS_SHOWN },
          lens(key.projectId),
          { signal },
        );
        return 'threads' in answer ? { threads: answer.threads, total: answer.total } : { threads: [], total: 0 };
      },
    }),

    install: mutation({
      mutator: async (input: { readonly projectId: number; readonly source: string; readonly scope: SettableScope }, { signal }, door) =>
        (await door.perform('install_plugin', { source: input.source, scope: input.scope }, lens(input.projectId), { signal })).plugin,
    }),

    installPrepared: mutation({
      mutator: async (input: { readonly projectId: number; readonly prepared: string; readonly scope: SettableScope }, { signal }, door) =>
        (await door.perform('install_plugin', { prepared: input.prepared, scope: input.scope }, lens(input.projectId), { signal })).plugin,
    }),

    enable: mutation({
      mutator: async (input: PluginTarget & PluginReach, { signal }, door) =>
        (
          await door.perform('enable_plugin', { id: input.id, enabled: input.enabled, scope: input.scope }, lens(input.projectId), {
            signal,
          })
        ).plugin,
    }),

    update: mutation({
      mutator: async (input: PluginTarget, { signal }, door) =>
        (await door.perform('update_plugin', { project: String(input.projectId), id: input.id }, lens(input.projectId), { signal })).plugin,
    }),

    uninstall: mutation({
      mutator: async (input: PluginTarget, { signal }, door) =>
        (await door.perform('uninstall_plugin', { id: input.id }, lens(input.projectId), { signal })).plugin,
    }),

    preview: mutation({
      mutator: async (input: EntryTarget, { signal }, door) =>
        (await door.perform('preview_plugin', { marketplace: input.marketplace, entry: input.entry }, lens(input.projectId), { signal }))
          .preview,
    }),

    inspect: mutation({
      mutator: async (input: { readonly projectId: number; readonly source: string }, { signal }, door): Promise<Found> =>
        (await door.perform('inspect_source', { source: input.source }, lens(input.projectId), { signal })).found,
    }),

    addMarketplace: mutation({
      mutator: async (input: { readonly source: string }, { signal }, door) =>
        (await door.perform('add_marketplace', { source: input.source }, {}, { signal })).marketplace,
    }),

    refreshMarketplace: mutation({
      mutator: async (input: { readonly id: string }, { signal }, door) =>
        (await door.perform('refresh_marketplace', { id: input.id }, {}, { signal })).marketplace,
    }),

    removeMarketplace: mutation({
      mutator: async (input: { readonly id: string }, { signal }, door) =>
        (await door.perform('remove_marketplace', { id: input.id }, {}, { signal })).marketplace,
    }),
  }),
  { tier: 'app', door: Door },
);

export type PluginsRepo = InstanceOf<typeof PluginsRepo>;
