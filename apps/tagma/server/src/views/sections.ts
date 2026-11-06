import { Effect } from 'effect';
import type { PluginFaced } from '../platform/contract/service/contribution.js';
import type { PluginContribution } from '../plugins/contract/service/points.js';
import type { SectionEntries } from './contract/wire/points.js';

export type Sections = ReturnType<typeof makeSections>;

export const makeSections = (input: { readonly point: PluginFaced<SectionEntries>; readonly changed: () => void }) => {
  const { point, changed } = input;
  const held = new Map<string, SectionEntries>();
  const register = ({ plugin, value }: PluginContribution<SectionEntries>) =>
    Effect.sync(() => {
      if (value.length === 0) return () => undefined;
      held.set(plugin.id, value);
      changed();
      return () => {
        if (held.get(plugin.id) !== value) return;
        held.delete(plugin.id);
        changed();
      };
    });
  return { point, register, of: (plugin: string): SectionEntries => held.get(plugin) ?? [] };
};
