import { Effect } from 'effect';
import { type PluginPoint, PluginPointRefused } from '../plugins/contract/service/points.js';
import { ViewEntries } from '../views/contract/wire/points.js';
import { PinOffers } from './contract/service/pins.js';
import { ThreadInputRefused } from './contract/service/failure.js';
import { type PinContributions, pinContributionsSchema } from './contract/wire/pins.js';

export type PinnableViews = PinOffers['Service'] & { readonly point: PluginPoint<PinContributions> };

export const makePinnableViews = () => {
  const offered = new Map<string, ReadonlySet<string>>();

  const point: PluginPoint<PinContributions> = {
    name: 'pins',
    owner: 'threads',
    schema: pinContributionsSchema,
    register: ({ plugin, value, sibling }) =>
      Effect.suspend(() => {
        if (value.length === 0) return Effect.succeed(() => undefined);
        const declared = new Set((sibling('views', ViewEntries) ?? []).map((view) => view.id));
        const unseen = value.filter((pin) => !declared.has(pin.view)).map((pin) => pin.view);
        if (unseen.length > 0) {
          return Effect.fail(new PluginPointRefused({ point: 'pins', reason: `contributes.views declares no view ${unseen.join(', ')}` }));
        }
        const views: ReadonlySet<string> = new Set(value.map((pin) => pin.view));
        offered.set(plugin.id, views);
        return Effect.succeed(() => {
          if (offered.get(plugin.id) === views) offered.delete(plugin.id);
        });
      }),
  };

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
  return { ...PinOffers.of({ require }), point };
};
