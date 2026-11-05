import { Effect } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import { type PluginRegister, PluginPointRefused } from '../plugins/contract/service/points.js';
import { VIEWS } from '../views/contract/service/points.js';
import { PinOffers } from './contract/service/pins.js';
import { ThreadInputRefused } from './contract/service/failure.js';
import { type PinContributions, pinContributionsSchema } from './contract/wire/pins.js';

export const PINS = new ContributionPoint<never, PinContributions>('threads/pins', { name: 'pins', schema: pinContributionsSchema });

export type PinnableViews = PinOffers['Service'] & { readonly register: PluginRegister<PinContributions> };

export const makePinnableViews = (): PinnableViews => {
  const offered = new Map<string, ReadonlySet<string>>();

  const register: PluginRegister<PinContributions> = ({ plugin, value, sibling }) =>
    Effect.suspend(() => {
      if (value.length === 0) return Effect.succeed(() => undefined);
      const declared = new Set((sibling(VIEWS) ?? []).map((view) => view.id));
      const unseen = value.filter((pin) => !declared.has(pin.view)).map((pin) => pin.view);
      if (unseen.length > 0) {
        return Effect.fail(
          new PluginPointRefused({ point: PINS.plugin.name, reason: `contributes.views declares no view ${unseen.join(', ')}` }),
        );
      }
      const views: ReadonlySet<string> = new Set(value.map((pin) => pin.view));
      offered.set(plugin.id, views);
      return Effect.succeed(() => {
        if (offered.get(plugin.id) === views) offered.delete(plugin.id);
      });
    });

  const require = (plugin: string, view: string): Effect.Effect<void, ThreadInputRefused<'view-not-pinnable'>> => {
    return offered.get(plugin)?.has(view) === true
      ? Effect.void
      : Effect.fail(
          new ThreadInputRefused('view-not-pinnable', `The plugin ${plugin} does not offer its view ${view} for pinning.`, [
            `name the view in contributes.pins of the plugin ${plugin}`,
            'read_plugins answers what each plugin contributes',
          ]),
        );
  };
  return { ...PinOffers.of({ require }), register };
};
