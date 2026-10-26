import { Effect, Layer } from 'effect';
import { HEARD_LATE_MS, makeWatchClient, type WatchClient, type WatchPlace } from '@runlith/watch/client';
import { FileWatcher, WatchRefused } from '../platform/contract/service/watch.js';

const refused = (failure: { readonly message: string }): WatchRefused => new WatchRefused({ message: failure.message });

const watcherOf = (client: WatchClient, leaving: Effect.Effect<boolean>) =>
  FileWatcher.of({
    subscribe: (at, options, hearing) =>
      client.subscribe(at, options, hearing).pipe(
        Effect.map((subscription) => ({
          close: Effect.flatMap(leaving, (handing) => (handing ? subscription.leave : subscription.close)),
        })),
        Effect.mapError(refused),
      ),
    mark: (at, file, ignore, lasting) => Effect.mapError(client.mark(at, file, ignore, lasting), refused),
    settle: (at, ignore) => Effect.mapError(client.settle(at, ignore), refused),
    changedSince: (at, position, ignore) => Effect.mapError(client.changedSince(at, position, ignore), refused),
    marking: client.marking,
    heardLateMs: HEARD_LATE_MS,
  });

export const makeFileWatcher = (place: WatchPlace) =>
  Effect.map(makeWatchClient(place), (client) => watcherOf(client, Effect.succeed(false)));

export const fileWatcherLayer = (place: WatchPlace, leaving: Effect.Effect<boolean>): Layer.Layer<FileWatcher> =>
  Layer.effect(
    FileWatcher,
    Effect.gen(function* () {
      const client = yield* makeWatchClient(place);
      if (place.lifetime !== 'with-client') {
        yield* Effect.addFinalizer(() => Effect.flatMap(leaving, (handing) => (handing ? Effect.void : client.shutdown)));
      }
      return watcherOf(client, leaving);
    }),
  );
