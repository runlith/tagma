import { Effect } from 'effect';
import { type PluginContribution, PluginPointRefused } from '../plugins/contract/service/points.js';
import { LAUNCHERS, VIEWS } from './contract/service/points.js';
import type { LauncherEntries } from './contract/wire/points.js';

export const makeLaunchers = (input: { readonly changed: () => void }) => {
  const held = new Map<string, LauncherEntries>();
  const register = Effect.fnUntraced(function* ({ plugin, value, sibling }: PluginContribution<LauncherEntries>) {
    if (value.length === 0) return () => undefined;
    const views = new Set((sibling(VIEWS) ?? []).map((view) => view.id));
    const unseen = value.filter((entry) => !views.has(entry.view)).map((entry) => entry.view);
    if (unseen.length > 0)
      return yield* new PluginPointRefused({
        point: LAUNCHERS.plugin.name,
        reason: `contributes.views declares no view ${unseen.join(', ')}`,
      });
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
