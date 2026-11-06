import { Effect, Layer, PubSub, Stream } from 'effect';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { THEMES, Themes } from './contract/service/themes.js';
import type { ThemeCatalog } from './contract/wire/feeds.js';
import { themeIdOf } from './contract/wire/format.js';

export const makeThemes = Effect.gen(function* () {
  const held = yield* (yield* PluginPoints).hold(THEMES);
  const moved = yield* Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown);
  yield* Effect.acquireRelease(
    Effect.sync(() => held.changed(() => PubSub.publishUnsafe(moved, undefined))),
    (stop) => Effect.sync(stop),
  );

  const catalogOf = (): ThemeCatalog => ({
    themes: [...held.all().values()]
      .flatMap(({ plugin, value }) =>
        Object.entries(value).map(([id, theme]) => ({ id: themeIdOf(plugin.id, id), plugin: plugin.id, pluginTitle: plugin.title, theme })),
      )
      .sort((left, right) => (left.id < right.id ? -1 : 1)),
  });

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
