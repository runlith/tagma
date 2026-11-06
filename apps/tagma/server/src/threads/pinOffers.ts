import { Effect } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { PinOffers } from './contract/service/pins.js';
import { ThreadInputRefused } from './contract/service/failure.js';
import { type PinContributions, PINS_FACE } from './contract/wire/pins.js';

const PINS = new ContributionPoint<never, PinContributions>('threads/pins', PINS_FACE);

export const makePinnableViews = Effect.gen(function* () {
  const held = yield* (yield* PluginPoints).hold(PINS);
  const require = (plugin: string, view: string): Effect.Effect<void, ThreadInputRefused<'view-not-pinnable'>> =>
    held.of(plugin)?.value.some((pin) => pin.view === view) === true
      ? Effect.void
      : Effect.fail(
          new ThreadInputRefused('view-not-pinnable', `The plugin ${plugin} does not offer its view ${view} for pinning.`, [
            `name the view in contributes.pins of the plugin ${plugin}`,
            'read_plugins answers what each plugin contributes',
          ]),
        );
  return PinOffers.of({ require });
});
