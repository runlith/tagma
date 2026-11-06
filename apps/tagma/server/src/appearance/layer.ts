import { Effect, Layer, PubSub, Stream } from 'effect';
import type { PluginContribution, PluginRef } from '../plugins/contract/service/points.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { THEMES, Themes } from './contract/service/themes.js';
import type { ThemeCatalog } from './contract/wire/feeds.js';
import { type ThemeEntries, themeIdOf } from './contract/wire/format.js';

type Offered = { readonly plugin: PluginRef; readonly themes: ThemeEntries };

export const makeThemes = Effect.gen(function* () {
  const points = yield* PluginPoints;
  const moved = yield* Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown);
  const offered = new Map<string, Offered>();
  const bump = () => {
    PubSub.publishUnsafe(moved, undefined);
  };

  const register = ({ plugin, value }: PluginContribution<ThemeEntries>) =>
    Effect.sync(() => {
      if (Object.keys(value).length === 0) return () => undefined;
      const standing: Offered = { plugin, themes: value };
      offered.set(plugin.id, standing);
      bump();
      return () => {
        if (offered.get(plugin.id) !== standing) return;
        offered.delete(plugin.id);
        bump();
      };
    });

  const catalogOf = (): ThemeCatalog => ({
    themes: [...offered.values()]
      .flatMap(({ plugin, themes }) =>
        Object.entries(themes).map(([id, theme]) => ({ id: themeIdOf(plugin.id, id), plugin: plugin.id, pluginTitle: plugin.title, theme })),
      )
      .sort((left, right) => (left.id < right.id ? -1 : 1)),
  });

  yield* Effect.acquireRelease(points.declare(THEMES, register), (withdraw) => Effect.sync(withdraw));

  return Themes.of({
    catalog: Stream.unwrap(
      Effect.map(PubSub.subscribe(moved), (moves) =>
        Stream.concat(Stream.succeed(undefined), Stream.fromSubscription(moves)).pipe(
          Stream.map(catalogOf),
          Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
        ),
      ),
    ),
  });
});

export const themesLayer: Layer.Layer<Themes, never, PluginPoints> = Layer.effect(Themes, makeThemes);
