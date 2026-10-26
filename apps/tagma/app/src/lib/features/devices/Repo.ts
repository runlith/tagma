import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

const DEVICES_SHOWN = 50;
const ACCESS_READ_EVERY_MS = 3_000;

export const DevicesRepo = Repo.define(
  'devices',
  ({ single, mutation }) => ({
    access: single({
      loader: async ({ signal }, door) => {
        const { status: _, ...access } = await door.perform('read_remote_access', {}, {}, { signal });
        return access;
      },
      refetchInterval: ACCESS_READ_EVERY_MS,
    }),

    devices: single({
      loader: async ({ signal }, door) => {
        const { status: _, ...listed } = await door.perform('list_devices', { limit: DEVICES_SHOWN }, {}, { signal });
        return listed;
      },
    }),

    pairing: mutation({
      mutator: async (_: void, { signal }, door) => (await door.perform('create_pairing', {}, {}, { signal })).pairing,
    }),

    revoke: mutation({
      mutator: async (device: string, { signal }, door) => (await door.perform('revoke_device', { device }, {}, { signal })).device,
    }),
  }),
  { tier: 'app', door: Door },
);
