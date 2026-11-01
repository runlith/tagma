import type { InstanceOf } from '@runlith/layer/key';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const AdaptersRepo = Repo.define(
  'adapters',
  ({ mutation }) => ({
    install: mutation({
      mutator: async (source: string, { signal }, door) => (await door.perform('install_adapter', { source }, {}, { signal })).adapter,
    }),

    update: mutation({
      mutator: async (id: string, { signal }, door) => (await door.perform('update_adapter', { id }, {}, { signal })).adapter,
    }),

    disable: mutation({
      mutator: async (id: string, { signal }, door) => (await door.perform('disable_adapter', { id }, {}, { signal })).adapter,
    }),

    enable: mutation({
      mutator: async (id: string, { signal }, door) => (await door.perform('enable_adapter', { id }, {}, { signal })).adapter,
    }),

    remove: mutation({
      mutator: async (id: string, { signal }, door) => (await door.perform('remove_adapter', { id }, {}, { signal })).id,
    }),
  }),
  { tier: 'app', door: Door },
);

export type AdaptersRepo = InstanceOf<typeof AdaptersRepo>;
