import { Effect } from 'effect';
import { type TagmaAppContribution, type TagmaAppPoint, TagmaAppPointRefused } from '../tagma-apps/contract/service/points.js';
import { LauncherEntries, ViewEntries } from './contract/wire/points.js';

export const makeLaunchers = (input: { readonly changed: () => void }) => {
  const held = new Map<string, LauncherEntries>();
  const point: TagmaAppPoint<LauncherEntries> = {
    name: 'launchers',
    owner: 'views',
    schema: LauncherEntries,
    register: Effect.fnUntraced(function* ({ app, value, sibling }: TagmaAppContribution<LauncherEntries>) {
      if (value.length === 0) return () => undefined;
      const views = new Set((sibling('views', ViewEntries) ?? []).map((view) => view.id));
      const unseen = value.filter((entry) => !views.has(entry.view)).map((entry) => entry.view);
      if (unseen.length > 0)
        return yield* new TagmaAppPointRefused({ point: 'launchers', reason: `contributes.views declares no view ${unseen.join(', ')}` });
      held.set(app.id, value);
      input.changed();
      return () => {
        if (held.get(app.id) !== value) return;
        held.delete(app.id);
        input.changed();
      };
    }),
  };
  return { point, of: (app: string): LauncherEntries => held.get(app) ?? [] };
};
