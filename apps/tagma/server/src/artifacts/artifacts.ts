import { artifacts as declaration } from './contract/wire/module.js';
import { Context, Effect, Layer } from 'effect';
import { artifactsVerbs } from './cli.js';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { artifactsCapability } from './contract/wire/capability.js';
import { ArtifactStore, ShelfPlace } from './contract/service/shelf.js';
import { Videos } from './contract/service/videos.js';
import type { ArtifactsLive } from './contract/service/live.js';
import { PAGE_FEED, THREAD_PAGES_FEED } from './contract/wire/feed.js';

const live: ArtifactsLive = liveOf([THREAD_PAGES_FEED, PAGE_FEED] as const, async (door) =>
  (await import('./channel.js')).pagesChannel(Context.get(door, ArtifactStore), Context.get(door, Videos)),
);

export const artifacts = manifest({
  ...declaration,
  capabilities: [artifactsCapability],
  verbs: artifactsVerbs,
  bodies: async () => Object.values((await import('./operations.js')).ARTIFACT_PAIRS),
  live,
  lifetimes: {
    installation: lazyLayer(
      async () => ({ ...(await import('./shelf.js')), ...(await import('./videos.js')) }),
      ({ versionedShelf, makeVideos }) => {
        const store = Layer.effect(
          ArtifactStore,
          Effect.flatMap(ShelfPlace, (place) => versionedShelf(place.root, place.origin)),
        );
        return Layer.merge(store, Layer.effect(Videos, makeVideos).pipe(Layer.provide(store)));
      },
    ),
  },
});
