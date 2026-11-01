import { Effect } from 'effect';
import type { AppFaced } from '../platform/contract/service/contribution.js';
import { type TagmaAppContribution, TagmaAppPointRefused } from '../tagma-apps/contract/service/points.js';
import { VIEWS } from './contract/service/points.js';
import type { SectionEntries } from './contract/wire/points.js';

export const makeSections = (input: { readonly point: AppFaced<SectionEntries>; readonly changed: () => void }) => {
  const { point, changed } = input;
  const held = new Map<string, SectionEntries>();
  const register = Effect.fnUntraced(function* ({ app, value, sibling }: TagmaAppContribution<SectionEntries>) {
    if (value.length === 0) return () => undefined;
    const views = new Set((sibling(VIEWS) ?? []).map((view) => view.id));
    const unseen = value.filter((entry) => !views.has(entry.view)).map((entry) => entry.view);
    if (unseen.length > 0)
      return yield* new TagmaAppPointRefused({ point: point.app.name, reason: `contributes.views declares no view ${unseen.join(', ')}` });
    held.set(app.id, value);
    changed();
    return () => {
      if (held.get(app.id) !== value) return;
      held.delete(app.id);
      changed();
    };
  });
  return { point, register, of: (app: string): SectionEntries => held.get(app) ?? [] };
};
