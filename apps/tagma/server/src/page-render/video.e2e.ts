import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import { ArtifactStore, ShelfPlace } from '../artifacts/contract/service/shelf.js';
import { Videos } from '../artifacts/contract/service/videos.js';
import type { Video } from '../artifacts/contract/wire/artifacts.js';
import { TIMELINE_FRAGMENT } from '../artifacts/contract/wire/fragment.js';
import { TIMELINE_ELEMENT } from '../artifacts/contract/wire/timeline.js';
import { ARTIFACT_PAIRS } from '../artifacts/operations.js';
import { makeVideos, versionedShelf } from '../artifacts/testing/doubles.js';
import { managedFixture } from '../managed-browser/testing/host.js';
import { renderLayer } from './layer.js';

const EXPORT = ARTIFACT_PAIRS.export_artifact_video.body;
const CANCEL = ARTIFACT_PAIRS.cancel_artifact_video.body;

const SECOND = `<!doctype html><html><head><title>Second</title><script type="application/json" id="${TIMELINE_ELEMENT}">{"v":1,"duration":1,"fps":30,"width":320,"height":180}</script></head><body><div id="stage"><div id="face" style="width:100%;height:100%;font:80px sans-serif;color:#fff"></div></div><script>window.render = (t) => { const k = Math.round(t * 30); const face = document.getElementById('face'); face.style.background = 'rgb(' + (k * 8) % 256 + ', 40, 90)'; face.textContent = String(k); };</script>${TIMELINE_FRAGMENT}</body></html>`;

const shelf = Layer.effect(
  ShelfPlace,
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix: 'page-video-' })),
    (root) => ({
      root,
      origin: 'http://localhost:5634',
    }),
  ),
);

const store = Layer.effect(
  ArtifactStore,
  Effect.flatMap(ShelfPlace, (place) => versionedShelf(join(place.root, 'artifacts'), place.origin)),
);

const world = Layer.effect(Videos, makeVideos).pipe(
  Layer.provideMerge(store),
  Layer.provideMerge(renderLayer),
  Layer.provideMerge(shelf),
  Layer.provideMerge(managedFixture()),
  Layer.provideMerge(BunFileSystem.layer),
);

const until = (page: string, seen: (videos: readonly Video[]) => boolean) =>
  Effect.flatMap(Videos, (videos) => Stream.runHead(videos.follow(page).pipe(Stream.filter(seen))));

layer(world, { excludeTestServices: true })('export_artifact_video', (it) => {
  it.effect(
    'exports a timeline page as an MP4 of every frame, answers it again without drawing, and a cancelled export leaves no file',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const { root } = yield* ShelfPlace;
        const path = join(root, 'second.html');
        yield* files.writeFileString(path, SECOND);
        const { record } = yield* (yield* ArtifactStore).publish({ path, thread: 'thread' });

        const started = yield* EXPORT.execute({ page: record.id }, undefined, { actor: { kind: 'operator' }, files: null });
        expect(started.status).toBe('exporting');
        yield* until(record.id, (videos) => videos.some((video) => video.state === 'ready'));
        const again = yield* EXPORT.execute({ page: record.id }, undefined, { actor: { kind: 'operator' }, files: null });
        if (again.status !== 'exported') return yield* Effect.die(`the finished video was not answered: ${JSON.stringify(again)}`);
        expect(again.video).toMatchObject({ state: 'ready', frames: 30, total: 30 });
        const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(again.path) });
        const track = (yield* Effect.promise(() => input.getPrimaryVideoTrack()))!;
        expect(track.codec).toBe('avc');
        expect((yield* Effect.promise(() => track.computePacketStats())).packetCount).toBe(30);
        expect(yield* Effect.promise(() => input.computeDuration())).toBeCloseTo(1, 6);

        const doubled = yield* EXPORT.execute({ page: record.id, scale: 2 }, undefined, { actor: { kind: 'operator' }, files: null });
        yield* until(record.id, (videos) => videos.some((video) => video.scale === 2 && video.frames > 0));
        yield* CANCEL.execute({ job: doubled.video.job }, undefined, { actor: { kind: 'operator' }, files: null });
        yield* until(record.id, (videos) => !videos.some((video) => video.scale === 2));
        const kept = yield* files.readDirectory(join(root, 'artifacts', record.id, record.version));
        expect(kept.filter((name) => name.startsWith('video-'))).toEqual(['video-30-1x.mp4']);
      }),
  );
});
