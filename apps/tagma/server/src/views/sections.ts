import { Effect } from 'effect';
import { type PluginContribution, type PluginPoint, PluginPointRefused } from '../plugins/contract/service/points.js';
import { SectionEntries, ViewEntries } from './contract/wire/points.js';

export type SectionPointName = 'surfaces' | 'panes';

export const makeSections = (input: { readonly name: SectionPointName; readonly changed: () => void }) => {
  const { name, changed } = input;
  const held = new Map<string, SectionEntries>();
  const point: PluginPoint<SectionEntries> = {
    name,
    owner: 'views',
    schema: SectionEntries,
    register: Effect.fnUntraced(function* ({ plugin, value, sibling }: PluginContribution<SectionEntries>) {
      if (value.length === 0) return () => undefined;
      const views = new Set((sibling('views', ViewEntries) ?? []).map((view) => view.id));
      const unseen = value.filter((entry) => !views.has(entry.view)).map((entry) => entry.view);
      if (unseen.length > 0)
        return yield* new PluginPointRefused({ point: name, reason: `contributes.views declares no view ${unseen.join(', ')}` });
      held.set(plugin.id, value);
      changed();
      return () => {
        if (held.get(plugin.id) !== value) return;
        held.delete(plugin.id);
        changed();
      };
    }),
  };
  return { point, of: (plugin: string): SectionEntries => held.get(plugin) ?? [] };
};
