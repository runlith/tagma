import type { PluginRow } from '@tagma/server/plugins/contract/wire/rows';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door, type Lens } from '$lib/wire/Door.js';

const lens = (projectId: number): Lens => ({ project: String(projectId) });

const PAGE = 8;

export type PluginTarget = { readonly projectId: number; readonly id: string };

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

    install: mutation({
      mutator: async (input: { readonly projectId: number; readonly source: string }, { signal }, door) =>
        (await door.perform('install_plugin', { source: input.source }, lens(input.projectId), { signal })).plugin,
    }),

    enable: mutation({
      mutator: async (input: PluginTarget & { readonly enabled: boolean }, { signal }, door) =>
        (await door.perform('enable_plugin', { id: input.id, enabled: input.enabled }, lens(input.projectId), { signal })).plugin,
    }),

    uninstall: mutation({
      mutator: async (input: PluginTarget, { signal }, door) =>
        (await door.perform('uninstall_plugin', { id: input.id }, lens(input.projectId), { signal })).plugin,
    }),
  }),
  { tier: 'app', door: Door },
);
