import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ActivityLog } from '@runlith/activity/log';
import { ActivityStore, activityStoreLayer } from '@runlith/activity/store';
import { Cause, Effect, FileSystem, Layer } from 'effect';
import { Settings } from '../settings/contract/service/values.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { ACTIVITY_DATABASE, ActivityPlace } from './contract/service/place.js';
import { activityBodiesMaxBytes, activityKeepHours } from './contract/wire/settings.js';

const stored = Layer.unwrap(
  Effect.gen(function* () {
    const place = yield* ActivityPlace;
    const settings = yield* Settings;
    const keepHours = yield* settings.live(activityKeepHours);
    const bodiesMaxBytes = yield* settings.live(activityBodiesMaxBytes);
    const records = yield* ThreadRecords;
    const fileSystem = yield* FileSystem.FileSystem;
    const root = place.dataPath ?? (yield* fileSystem.makeTempDirectoryScoped());
    if (place.dataPath !== null) {
      yield* Effect.forkScoped(
        Effect.andThen(
          place.opened,
          fileSystem
            .remove(join(place.dataPath, 'traces'), { recursive: true, force: true })
            .pipe(
              Effect.tapCause((cause) => Effect.logWarning('[activity] the retired trace bundles were not removed', Cause.pretty(cause))),
            ),
        ),
      );
    }
    return activityStoreLayer({
      database: place.dataPath === null ? ':memory:' : join(root, ACTIVITY_DATABASE),
      bodies: join(root, 'activity'),
      migrations: place.migrations,
      keeping: () => ({ hours: keepHours(), bodiesMaxBytes: bodiesMaxBytes() }),
      upkeepAfter: place.opened,
      projectsOf: (threads) => records.projectsOf(threads),
      processes: (yield* MachineStore).processes,
    });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

export const activityLayer = Layer.effect(
  ActivityLog,
  Effect.gen(function* () {
    return (yield* ActivityStore).log;
  }),
).pipe(Layer.provideMerge(Layer.orDie(stored)));
