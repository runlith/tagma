import { Effect, PubSub, Stream } from 'effect';
import { EnabledPlugins, type PluginLoaded } from '../contract/service/plugins.js';

export const enabledPlugins = Effect.fnUntraced(function* (initial: readonly PluginLoaded[] = []) {
  const held = new Map<number, readonly PluginLoaded[]>();
  const moves = yield* Effect.acquireRelease(PubSub.unbounded<number | null>(), PubSub.shutdown);
  const service = EnabledPlugins.of({
    of: (projectId) => Effect.sync(() => held.get(projectId) ?? initial),
    changes: Stream.fromPubSub(moves),
  });
  const set = (projectId: number, plugins: readonly PluginLoaded[]) =>
    Effect.andThen(
      Effect.sync(() => held.set(projectId, plugins)),
      PubSub.publish(moves, projectId),
    );
  return { service, set };
});
