import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer } from 'effect';
import { lazyLayer } from '../platform/contract/service/manifest.js';
import { navigation } from '../navigation/navigation.js';
import { CARRIED_TYPESCRIPT, presentCarried } from '../installation/closure/carried.js';
import { ripgrepBinary } from './ripgrepBinary.js';

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const platform = Layer.merge(BunFileSystem.layer, BunChildProcessSpawner.layer.pipe(Layer.provide(host)));

const SEARCH_CEILING_MS = 120_000;

const KEPT_ANSWERS = 16;

const launcher = lazyLayer(
  () => import('@runlith/navigation-ts/launcher'),
  ({ ENGINE, launcherLayer }) => launcherLayer({ runtime: process.execPath, entry: ENGINE, compiler: presentCarried(CARRIED_TYPESCRIPT) }),
);

const kit = lazyLayer(
  () => import('@runlith/navigation/navigation'),
  ({ Navigation, SearchUnavailable, makeNavigation }) =>
    Layer.effect(
      Navigation,
      makeNavigation({
        binary: Effect.mapError(ripgrepBinary.path(), (refused) => new SearchUnavailable({ detail: refused.reason })),
        platform: process.platform,
        ceilingMs: SEARCH_CEILING_MS,
        keep: '10 minutes',
        held: KEPT_ANSWERS,
      }),
    ),
);

export const navigationServing = kit.pipe(
  Layer.provideMerge(navigation.lifetimes.serving),
  Layer.provide(launcher),
  Layer.provide(platform),
);
