import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Deferred, Effect, FileSystem, Layer, Ref, Stream } from 'effect';
import { Film } from './contract/service/film.js';
import { ArtifactStore, ShelfPlace } from './contract/service/shelf.js';
import { Videos } from './contract/service/videos.js';
import type { Video } from './contract/wire/artifacts.js';
import { TIMELINE_ELEMENT } from './contract/wire/timeline.js';
import { ARTIFACT_PAIRS } from './operations.js';
import { versionedShelf } from './shelf.js';
import { makeVideos } from './videos.js';

const REMOVE = ARTIFACT_PAIRS.remove_artifact.body;
const LIST = ARTIFACT_PAIRS.list_artifacts.body;

const PAGE = `<!doctype html><title>Motion</title><script type="application/json" id="${TIMELINE_ELEMENT}">{"v":1,"duration":1,"fps":30,"width":320,"height":180}</script>`;

class Reels extends Context.Service<Reels, { readonly shot: Ref.Ref<number>; readonly gate: (scale: number) => Deferred.Deferred<void> }>()(
  'testing/Reels',
) {}

const reels = Layer.effect(
  Reels,
  Effect.gen(function* () {
    const gates = new Map([
      [1, yield* Deferred.make<void>()],
      [2, yield* Deferred.make<void>()],
    ]);
    return { shot: yield* Ref.make(0), gate: (scale: number) => gates.get(scale)! };
  }),
);

const film = Layer.effect(
  Film,
  Effect.gen(function* () {
    const { shot, gate } = yield* Reels;
    const files = yield* FileSystem.FileSystem;
    return Film.of({
      shoot: (reel) =>
        Stream.make(0).pipe(
          Stream.concat(
            Stream.fromEffect(
              Effect.gen(function* () {
                yield* Ref.update(shot, (count) => count + 1);
                yield* Effect.orDie(files.writeFileString(reel.file, 'half'));
                return 1;
              }),
            ),
          ),
          Stream.concat(
            Stream.fromEffect(
              Effect.gen(function* () {
                yield* Deferred.await(gate(reel.scale));
                yield* Effect.orDie(files.writeFileString(reel.file, 'the whole video'));
                return 30;
              }),
            ),
          ),
        ),
    });
  }),
);

const place = Layer.effect(
  ShelfPlace,
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix: 'videos-' })),
    (root) => ({
      root,
      origin: 'http://localhost:5634',
    }),
  ),
);

const store = Layer.effect(
  ArtifactStore,
  Effect.flatMap(ShelfPlace, (at) => versionedShelf(join(at.root, 'artifacts'), at.origin)),
);

const world = Layer.effect(Videos, makeVideos).pipe(
  Layer.provideMerge(film),
  Layer.provideMerge(store),
  Layer.provideMerge(reels),
  Layer.provideMerge(place),
  Layer.provideMerge(BunFileSystem.layer),
);

const until = (page: string, seen: (videos: readonly Video[]) => boolean) =>
  Effect.flatMap(Videos, (videos) => Stream.runHead(videos.follow(page).pipe(Stream.filter(seen))));

layer(world, { excludeTestServices: true })('video exports', (it) => {
  it.effect('two asks of one export share one job, the finished video answers without drawing, and a cancelled job leaves no file', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const { root } = yield* ShelfPlace;
      const { shot, gate } = yield* Reels;
      const videos = yield* Videos;
      yield* files.writeFileString(join(root, 'motion.html'), PAGE);
      const { record } = yield* (yield* ArtifactStore).publish({ path: join(root, 'motion.html'), thread: 'thread' });
      const version = join(root, 'artifacts', record.id, record.version);

      const [first, second] = yield* Effect.all(
        [videos.export({ page: record.id, scale: 1 }), videos.export({ page: record.id, scale: 1 })],
        {
          concurrency: 'unbounded',
        },
      );
      expect(second.video.job).toBe(first.video.job);
      yield* Deferred.succeed(gate(1), undefined);
      yield* until(record.id, (made) => made.some((video) => video.state === 'ready'));
      const finished = yield* videos.export({ page: record.id, scale: 1 });
      expect(finished).toMatchObject({ video: { state: 'ready', frames: 30, bytes: 15 }, path: join(version, 'video-30-1x.mp4') });
      expect(yield* Ref.get(shot)).toBe(1);

      const doubled = yield* videos.export({ page: record.id, scale: 2 });
      yield* until(record.id, (made) => made.some((video) => video.scale === 2 && video.frames === 1));
      yield* videos.cancel(doubled.video.job);
      yield* until(record.id, (made) => !made.some((video) => video.scale === 2));
      expect((yield* files.readDirectory(version)).filter((name) => name.startsWith('video-'))).toEqual(['video-30-1x.mp4']);
      expect((yield* Effect.flip(videos.cancel(doubled.video.job))).code).toBe('video-unknown');
    }),
  );

  it.effect('remove_artifact drops the page with its versions and videos, stops its exports and leaves a consistent shelf', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const { root, origin } = yield* ShelfPlace;
      const { gate } = yield* Reels;
      const videos = yield* Videos;
      const store = yield* ArtifactStore;
      const as = { actor: { kind: 'operator' }, files: null } as const;
      yield* files.writeFileString(join(root, 'doomed.html'), PAGE);
      yield* files.writeFileString(join(root, 'kept.html'), '<title>Kept</title>');
      const doomed = (yield* store.publish({ path: join(root, 'doomed.html'), thread: 'thread' })).record;
      yield* store.publish({ path: join(root, 'doomed.html'), thread: 'thread' });
      const kept = (yield* store.publish({ path: join(root, 'kept.html'), thread: 'thread' })).record;
      yield* Deferred.succeed(gate(1), undefined);
      yield* videos.export({ page: doomed.id, scale: 1 });
      yield* until(doomed.id, (made) => made.some((video) => video.state === 'ready'));
      const going = yield* videos.export({ page: doomed.id, scale: 2 });
      yield* until(doomed.id, (made) => made.some((video) => video.scale === 2 && video.frames > 0));

      const removed = yield* REMOVE.execute({ page: doomed.id }, undefined, as);
      expect(removed).toEqual({ status: 'removed', page: doomed.id, versions: 2, videos: 1 });
      expect((yield* Effect.flip(videos.cancel(going.video.job))).code).toBe('video-unknown');
      expect(yield* files.exists(join(root, 'artifacts', doomed.id))).toBe(false);
      expect(yield* store.page(doomed.id)).toBeNull();
      const listed = yield* LIST.execute({}, undefined, as);
      if (listed.status !== 'listed') return yield* Effect.die('list_artifacts answered outside its listed shape');
      const ids = listed.artifacts.map((row) => row.id);
      expect(ids).toContain(kept.id);
      expect(ids).not.toContain(doomed.id);
      const reopened = yield* versionedShelf(join(root, 'artifacts'), origin);
      const rows = yield* reopened.list({ limit: 10 });
      expect(rows.rows.map((row) => row.record.id)).toEqual(ids);
      expect(rows.total).toBe(listed.total);
      expect((yield* Effect.flip(REMOVE.execute({ page: doomed.id }, undefined, as))).code).toBe('artifact-unknown');
    }),
  );
});
