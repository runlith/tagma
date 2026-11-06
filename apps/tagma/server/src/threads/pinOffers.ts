import { Effect } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import type { PluginRegister } from '../plugins/contract/service/points.js';
import { PinOffers } from './contract/service/pins.js';
import { ThreadInputRefused } from './contract/service/failure.js';
import { type PinContributions, PINS_FACE } from './contract/wire/pins.js';

export const PINS = new ContributionPoint<never, PinContributions>('threads/pins', PINS_FACE);

export type PinnableViews = PinOffers['Service'] & { readonly register: PluginRegister<PinContributions> };

export const makePinnableViews = (): PinnableViews => {
  const offered = new Map<string, ReadonlySet<string>>();

  const register: PluginRegister<PinContributions> = ({ plugin, value }) =>
    Effect.sync(() => {
      if (value.length === 0) return () => undefined;
      const views: ReadonlySet<string> = new Set(value.map((pin) => pin.view));
      offered.set(plugin.id, views);
      return () => {
        if (offered.get(plugin.id) === views) offered.delete(plugin.id);
      };
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
