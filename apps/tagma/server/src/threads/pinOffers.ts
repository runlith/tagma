import { Effect } from 'effect';
import { type TagmaAppPoint, TagmaAppPointRefused } from '../tagma-apps/contract/service/points.js';
import { ViewEntries } from '../views/contract/wire/points.js';
import { PinOffers } from './contract/service/pins.js';
import { ThreadInputRefused } from './contract/service/failure.js';
import { type PinContributions, pinContributionsSchema } from './contract/wire/pins.js';

export type PinnableViews = PinOffers['Service'] & { readonly point: TagmaAppPoint<PinContributions> };

export const makePinnableViews = () => {
  const offered = new Map<string, ReadonlySet<string>>();

  const point: TagmaAppPoint<PinContributions> = {
    name: 'pins',
    owner: 'threads',
    schema: pinContributionsSchema,
    register: ({ app, value, sibling }) =>
      Effect.suspend(() => {
        if (value.length === 0) return Effect.succeed(() => undefined);
        const declared = new Set((sibling('views', ViewEntries) ?? []).map((view) => view.id));
        const unseen = value.filter((pin) => !declared.has(pin.view)).map((pin) => pin.view);
        if (unseen.length > 0) {
          return Effect.fail(
            new TagmaAppPointRefused({ point: 'pins', reason: `contributes.views declares no view ${unseen.join(', ')}` }),
          );
        }
        const views: ReadonlySet<string> = new Set(value.map((pin) => pin.view));
        offered.set(app.id, views);
        return Effect.succeed(() => {
          if (offered.get(app.id) === views) offered.delete(app.id);
        });
      }),
  };

  const require = (app: string, view: string): Effect.Effect<void, ThreadInputRefused<'view-not-pinnable'>> => {
    return offered.get(app)?.has(view) === true
      ? Effect.void
      : Effect.fail(
          new ThreadInputRefused('view-not-pinnable', `The app ${app} does not offer its view ${view} for pinning.`, [
            `name the view in contributes.pins of the app ${app}`,
            'read_apps answers what each app contributes',
          ]),
        );
  };
  return { ...PinOffers.of({ require }), point };
};
