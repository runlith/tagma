import { Effect } from 'effect';
import type { PluginFaced } from '../platform/contract/service/contribution.js';
import { type PluginContribution, PluginPointRefused } from '../plugins/contract/service/points.js';
import { VIEWS } from './contract/service/points.js';
import type { SectionEntries } from './contract/wire/points.js';

export const makeSections = (input: { readonly point: PluginFaced<SectionEntries>; readonly changed: () => void }) => {
  const { point, changed } = input;
  const held = new Map<string, SectionEntries>();
  const register = Effect.fnUntraced(function* ({ plugin, value, sibling }: PluginContribution<SectionEntries>) {
    if (value.length === 0) return () => undefined;
    const views = new Set((sibling(VIEWS) ?? []).map((view) => view.id));
    const unseen = value.filter((entry) => !views.has(entry.view)).map((entry) => entry.view);
    if (unseen.length > 0)
      return yield* new PluginPointRefused({ point: point.plugin.name, reason: `contributes.views declares no view ${unseen.join(', ')}` });
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
