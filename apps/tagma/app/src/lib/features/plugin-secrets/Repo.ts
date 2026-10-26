import type { PluginSecretSet } from '@tagma/server/plugin-secrets/contract/wire/rows';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door, type Lens } from '$lib/wire/Door.js';

const lens = (projectId: number): Lens => ({ project: String(projectId) });

export type SecretTarget = { readonly projectId: number; readonly plugin: string; readonly name: string };

export const SecretsRepo = Repo.define(
  'plugin-secrets',
  ({ keyed, mutation }) => ({
    plugins: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) => {
        const sets: PluginSecretSet[] = [];
        let cursor: string | undefined;
        do {
          const page = await door.perform('read_plugin_secrets', cursor === undefined ? {} : { cursor }, lens(key), { signal });
          sets.push(...page.plugins);
          cursor = page.next ?? undefined;
        } while (cursor !== undefined);
        return sets;
      },
    }),

    set: mutation({
      mutator: async (input: SecretTarget & { readonly value: string }, { signal }, door) =>
        (
          await door.perform('set_plugin_secret', { plugin: input.plugin, name: input.name, value: input.value }, lens(input.projectId), {
            signal,
          })
        ).secret,
    }),

    remove: mutation({
      mutator: async (input: SecretTarget, { signal }, door) =>
        (await door.perform('remove_plugin_secret', { plugin: input.plugin, name: input.name }, lens(input.projectId), { signal })).secret,
    }),
  }),
  { tier: 'app', door: Door },
);
