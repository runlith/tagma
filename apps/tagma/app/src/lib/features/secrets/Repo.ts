import type { SecretSet } from '@tagma/server/secrets/contract/wire/rows';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door, type Lens } from '$lib/wire/Door.js';

const lens = (projectId: number): Lens => ({ project: String(projectId) });

export type SecretOwnerKey = { readonly projectId: number; readonly owner: string };

export type SecretTarget = SecretOwnerKey & { readonly id: string; readonly name: string };

export const SecretsRepo = Repo.define(
  'secrets',
  ({ keyed, mutation }) => ({
    sets: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<SecretOwnerKey>, door) => {
        const sets: SecretSet[] = [];
        let cursor: string | undefined;
        do {
          const input = cursor === undefined ? { owner: key.owner } : { owner: key.owner, cursor };
          const page = await door.perform('read_secrets', input, lens(key.projectId), { signal });
          sets.push(...page.sets);
          cursor = page.next ?? undefined;
        } while (cursor !== undefined);
        return sets;
      },
    }),

    set: mutation({
      mutator: async (input: SecretTarget & { readonly value: string }, { signal }, door) =>
        (
          await door.perform(
            'set_secret',
            { owner: input.owner, id: input.id, name: input.name, value: input.value },
            lens(input.projectId),
            { signal },
          )
        ).secret,
    }),

    remove: mutation({
      mutator: async (input: SecretTarget, { signal }, door) =>
        (await door.perform('remove_secret', { owner: input.owner, id: input.id, name: input.name }, lens(input.projectId), { signal }))
          .secret,
    }),
  }),
  { tier: 'app', door: Door },
);

export type SecretsRepo = InstanceOf<typeof SecretsRepo>;
