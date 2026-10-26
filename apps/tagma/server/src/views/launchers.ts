import { Effect } from 'effect';
import { type PluginContribution, type PluginPoint, PluginPointRefused } from '../plugins/contract/service/points.js';
import { LauncherEntries, ViewEntries } from './contract/wire/points.js';

export const makeLaunchers = (input: { readonly changed: () => void }) => {
  const held = new Map<string, LauncherEntries>();
  const point: PluginPoint<LauncherEntries> = {
    name: 'launchers',
    owner: 'views',
    schema: LauncherEntries,
    register: Effect.fnUntraced(function* ({ plugin, value, sibling }: PluginContribution<LauncherEntries>) {
      if (value.length === 0) return () => undefined;
      const views = new Set((sibling('views', ViewEntries) ?? []).map((view) => view.id));
      const unseen = value.filter((entry) => !views.has(entry.view)).map((entry) => entry.view);
      if (unseen.length > 0)
        return yield* new PluginPointRefused({ point: 'launchers', reason: `contributes.views declares no view ${unseen.join(', ')}` });
      held.set(plugin.id, value);
      input.changed();
      return () => {
        if (held.get(plugin.id) !== value) return;
        held.delete(plugin.id);
        input.changed();
      };
    }),
  };
  return { point, of: (plugin: string): LauncherEntries => held.get(plugin) ?? [] };
};
