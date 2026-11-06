import { Effect } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import type { PluginRegister } from '../plugins/contract/service/points.js';
import type { PluginListing } from './contract/service/listing.js';
import { LISTING_FACE, type ThreadsListing } from './contract/wire/listing.js';

export const LISTING = new ContributionPoint<never, ThreadsListing>('threads/listing', LISTING_FACE);

type ListedPlugins = PluginListing & { readonly register: PluginRegister<ThreadsListing> };

export const makeListedPlugins = (): ListedPlugins => {
  const held = new Map<string, object>();
  const subscribers = new Set<() => void>();
  let listed: ReadonlySet<string> = new Set();

  const moved = (): void => {
    listed = new Set(held.keys());
    for (const subscriber of subscribers) subscriber();
  };

  const register: PluginRegister<ThreadsListing> = ({ plugin, value }) =>
    Effect.sync(() => {
      if (value.listed !== true) return () => undefined;
      const mine = {};
      held.set(plugin.id, mine);
      moved();
      return () => {
        if (held.get(plugin.id) !== mine) return;
        held.delete(plugin.id);
        moved();
      };
    });

  return {
    listed: () => listed,
    changed: (subscriber) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    register,
  };
};
