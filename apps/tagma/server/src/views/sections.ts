import { Effect } from 'effect';
import { type TagmaAppContribution, type TagmaAppPoint, TagmaAppPointRefused } from '../tagma-apps/contract/service/points.js';
import { SectionEntries, ViewEntries } from './contract/wire/points.js';

export type SectionPointName = 'surfaces' | 'panes';

export const makeSections = (input: { readonly name: SectionPointName; readonly changed: () => void }) => {
  const { name, changed } = input;
  const held = new Map<string, SectionEntries>();
  const point: TagmaAppPoint<SectionEntries> = {
    name,
    owner: 'views',
    schema: SectionEntries,
    register: Effect.fnUntraced(function* ({ app, value, sibling }: TagmaAppContribution<SectionEntries>) {
      if (value.length === 0) return () => undefined;
      const views = new Set((sibling('views', ViewEntries) ?? []).map((view) => view.id));
      const unseen = value.filter((entry) => !views.has(entry.view)).map((entry) => entry.view);
      if (unseen.length > 0)
        return yield* new TagmaAppPointRefused({ point: name, reason: `contributes.views declares no view ${unseen.join(', ')}` });
      held.set(app.id, value);
      changed();
      return () => {
        if (held.get(app.id) !== value) return;
        held.delete(app.id);
        changed();
      };
    }),
  };
  return { point, of: (app: string): SectionEntries => held.get(app) ?? [] };
};
