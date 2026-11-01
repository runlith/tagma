import { Effect } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import { type TagmaAppRegister, TagmaAppPointRefused } from '../tagma-apps/contract/service/points.js';
import { VIEWS } from '../views/contract/service/points.js';
import { PinOffers } from './contract/service/pins.js';
import { ThreadInputRefused } from './contract/service/failure.js';
import { type PinContributions, pinContributionsSchema } from './contract/wire/pins.js';

export const PINS = new ContributionPoint<never, PinContributions>('threads/pins', { name: 'pins', schema: pinContributionsSchema });

export type PinnableViews = PinOffers['Service'] & { readonly register: TagmaAppRegister<PinContributions> };

export const makePinnableViews = (): PinnableViews => {
  const offered = new Map<string, ReadonlySet<string>>();

  const register: TagmaAppRegister<PinContributions> = ({ app, value, sibling }) =>
    Effect.suspend(() => {
      if (value.length === 0) return Effect.succeed(() => undefined);
      const declared = new Set((sibling(VIEWS) ?? []).map((view) => view.id));
      const unseen = value.filter((pin) => !declared.has(pin.view)).map((pin) => pin.view);
      if (unseen.length > 0) {
        return Effect.fail(
          new TagmaAppPointRefused({ point: PINS.app.name, reason: `contributes.views declares no view ${unseen.join(', ')}` }),
        );
      }
      const views: ReadonlySet<string> = new Set(value.map((pin) => pin.view));
      offered.set(app.id, views);
      return Effect.succeed(() => {
        if (offered.get(app.id) === views) offered.delete(app.id);
      });
    });

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
  return { ...PinOffers.of({ require }), register };
};
