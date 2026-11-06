import { Effect } from 'effect';
import type { PluginContribution } from '../plugins/contract/service/points.js';
import { LAUNCHERS } from './contract/service/points.js';
import type { LauncherEntries } from './contract/wire/points.js';

export const makeLaunchers = (input: { readonly changed: () => void }) => {
  const held = new Map<string, LauncherEntries>();
  const register = ({ plugin, value }: PluginContribution<LauncherEntries>) =>
    Effect.sync(() => {
      if (value.length === 0) return () => undefined;
      held.set(plugin.id, value);
      input.changed();
      return () => {
        if (held.get(plugin.id) !== value) return;
        held.delete(plugin.id);
        input.changed();
      };
    });
  return { point: LAUNCHERS, register, of: (plugin: string): LauncherEntries => held.get(plugin) ?? [] };
};
