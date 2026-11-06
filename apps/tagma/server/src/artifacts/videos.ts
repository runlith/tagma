import { createHash } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { Cause, Data, Deferred, Effect, Exit, FiberMap, FileSystem, PubSub, Semaphore, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Film, type Reel, VIDEO_BITS_PER_PIXEL } from './contract/service/film.js';
import { ArtifactStore, type KeptVideo, ShelfPlace } from './contract/service/shelf.js';
import { type Exported, Videos } from './contract/service/videos.js';
import { TIMELINE_DECLARATION } from './contract/wire/fragment.js';
import { type Video, type VideoScale, videoName } from './contract/wire/artifacts.js';
import type { FilmRefusal } from './contract/wire/operations.js';
import { frameCount } from './contract/wire/timeline.js';

type Job = {
  readonly id: string;
  readonly page: string;
  readonly file: string;
  readonly need: number;
  video: Video;
  readonly started: Deferred.Deferred<void, GateRefusal<JobRefusal>>;
};

type JobRefusal = FilmRefusal | 'disk-full';

class DiskUnread extends Data.TaggedError('DiskUnread')<{ readonly message: string }> {}

type Watch = { readonly moved: PubSub.PubSub<readonly Video[]>; ready: readonly Video[]; users: number };

const FAILURES_KEPT = 8;

export const exportSlots = (cores: number) => {
  const exports = Math.max(1, Math.floor(cores / 8));
  return { exports, targets: Math.min(4, Math.max(1, Math.floor(cores / (2 * exports)))) };
};

const jobOf = (page: string, version: string, scale: VideoScale) =>
  createHash('sha256').update(`${page}/${version}/${scale}`).digest('hex').slice(0, 12);

const unknownPage = (page: string, version: string | undefined) =>
  new GateRefusal(
    'artifact-unknown',
    version === undefined ? `the shelf holds no page ${page}` : `the shelf keeps no version ${version} of page ${page}`,
    ['list_artifacts — the pages on the shelf and their current versions'],
  );

export const makeVideos = Effect.gen(function* () {
  const store = yield* ArtifactStore;
  const film = yield* Film;
  const files = yield* FileSystem.FileSystem;
  const { origin } = yield* ShelfPlace;
  const slots = exportSlots(availableParallelism());
  const permits = yield* Semaphore.make(slots.exports);
  const admission = yield* Semaphore.make(1);
  const fibers = yield* FiberMap.make<string>();
  const jobs = new Map<string, Job>();
  const failed = new Map<string, Map<string, Video>>();
  const watching = new Map<string, Watch>();
  let reserved = 0;

  const urlOf = (page: string, version: string, fps: number, scale: VideoScale) =>
    `${origin}/a/${page}/v/${version}/${videoName(fps, scale)}`;

  const kept = (page: string, kept: KeptVideo): Video => ({
    job: jobOf(page, kept.version, kept.scale),
    version: kept.version,
    fps: kept.fps,
    scale: kept.scale,
    state: 'ready',
    frames: kept.frames,
    total: kept.frames,
    url: urlOf(page, kept.version, kept.fps, kept.scale),
    bytes: kept.bytes,
    problem: null,
  });

  const snapshot = (page: string, ready: readonly Video[]): readonly Video[] => [
    ...ready,
    ...[...jobs.values()].filter((job) => job.page === page).map((job) => job.video),
    ...(failed.get(page)?.values() ?? []),
  ];

  const publish = (page: string) => {
    const watch = watching.get(page);
    return watch === undefined ? Effect.void : Effect.asVoid(PubSub.publish(watch.moved, snapshot(page, watch.ready)));
  };

  const discard = (path: string) =>
    files
      .remove(path, { force: true })
      .pipe(Effect.catchTag('PlatformError', (failure) => Effect.logWarning(`videos: ${path} was left on disk: ${failure.message}`)));

  const settle = Effect.fnUntraced(function* (page: string) {
    const watch = watching.get(page);
    if (watch !== undefined) {
      const found = yield* store.videos(page);
      watch.ready = found.kept.map((one) => kept(page, one));
      const writing = new Set([...jobs.values()].map((job) => `${job.file}.part`));
      for (const part of found.parts) if (!writing.has(part)) yield* discard(part);
    }
    yield* publish(page);
  });

  const failure = (job: Job, problem: string) => {
    const page = failed.get(job.page) ?? new Map<string, Video>();
    page.delete(job.id);
    page.set(job.id, { ...job.video, state: 'failed', problem });
    for (const oldest of page.keys()) {
      if (page.size <= FAILURES_KEPT) break;
      page.delete(oldest);
    }
    failed.set(job.page, page);
  };

  const roomFor = Effect.fnUntraced(function* (file: string, bytes: number) {
    const free = yield* Effect.tryPromise({
      try: () => statfs(dirname(file)),
      catch: (cause) => new DiskUnread({ message: String(cause) }),
    }).pipe(
      Effect.map((disk) => disk.bavail * disk.bsize),
      Effect.catchTag('DiskUnread', (unread) =>
        Effect.as(Effect.logWarning(`videos: the free space under ${dirname(file)} was not read: ${unread.message}`), Infinity),
      ),
    );
    if (free - reserved < bytes) {
      return yield* new GateRefusal(
        'disk-full',
        `the video needs about ${Math.ceil(bytes / 1e6)} MB and the disk holding the shelf has ${Math.floor(Math.max(0, free - reserved) / 1e6)} MB free beside the exports under way`,
        ['free space on that disk, then export again', 'or export at scale 1, which needs a quarter of the space'],
      );
    }
  });

  const draw = Effect.fnUntraced(
    function* (job: Job, reel: Reel) {
      yield* roomFor(reel.file, job.need);
      reserved += job.need;
      yield* Effect.addFinalizer(() => Effect.sync(() => (reserved -= job.need)));
      job.video = { ...job.video, state: 'drawing' };
      yield* publish(job.page);
      yield* film.shoot({ ...reel, file: `${reel.file}.part` }).pipe(
        Stream.runForEach((frames) =>
          Effect.andThen(Deferred.succeed(job.started, undefined), () => {
            job.video = { ...job.video, frames };
            return publish(job.page);
          }),
        ),
      );
      yield* Effect.orDie(files.rename(`${reel.file}.part`, reel.file));
    },
    Effect.scoped,
    (effect, job, reel) =>
      Effect.onExit(effect, (exit) =>
        Exit.isSuccess(exit) ? Effect.void : Effect.andThen(discard(`${reel.file}.part`), discard(job.file)),
      ),
  );

  const ended = Effect.fnUntraced(function* (job: Job, exit: Exit.Exit<void, GateRefusal<JobRefusal>>) {
    if (jobs.get(job.id) === job) jobs.delete(job.id);
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      const refusal = Cause.findErrorOption(exit.cause);
      if (refusal._tag === 'None') yield* Effect.logWarning(`videos: export ${job.id} failed`, exit.cause);
      failure(job, refusal._tag === 'Some' ? refusal.value.reason : `the export failed: ${Cause.pretty(exit.cause)}`);
    }
    yield* Deferred.done(job.started, Exit.isSuccess(exit) ? exit : Exit.failCause(exit.cause));
    yield* settle(job.page);
  });

  const watch = Effect.fnUntraced(function* (page: string) {
    const shared = watching.get(page);
    if (shared !== undefined) {
      shared.users += 1;
      return shared;
    }
    const group: Watch = { moved: yield* PubSub.sliding<readonly Video[]>({ capacity: 1, replay: 1 }), ready: [], users: 1 };
    watching.set(page, group);
    yield* settle(page);
    return group;
  });

  const unwatch = Effect.fnUntraced(function* (page: string, group: Watch) {
    group.users -= 1;
    if (group.users > 0) return;
    if (watching.get(page) === group) {
      watching.delete(page);
      failed.delete(page);
    }
    yield* PubSub.shutdown(group.moved);
  });

  return Videos.of({
    export: Effect.fn('Videos.export')(function* ({ page, version, scale }) {
      const found = yield* store.page(page, version);
      if (found === null) return yield* unknownPage(page, version);
      const { timeline } = found.record;
      if (timeline === null) {
        return yield* new GateRefusal('no-timeline', `page ${page} at version ${found.record.version} declares no timeline`, [
          `declare the timeline in the page, as ${TIMELINE_DECLARATION}, and publish it again`,
        ]);
      }
      const at = found.record.version;
      const id = jobOf(page, at, scale);
      const file = store.videoFile(page, at, videoName(timeline.fps, scale));
      if (file === null) return yield* unknownPage(page, version);
      const total = frameCount(timeline);
      const need = (timeline.width * scale * timeline.height * scale * timeline.fps * timeline.duration * VIDEO_BITS_PER_PIXEL * 2) / 8;
      const admitted = yield* admission.withPermit(
        Effect.gen(function* () {
          const going = jobs.get(id);
          if (going !== undefined) return { kind: 'answer' as const, answer: { video: going.video, path: null } satisfies Exported };
          const standing = yield* files.stat(file).pipe(
            Effect.map((info) => Number(info.size)),
            Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
            Effect.orDie,
          );
          if (standing !== null)
            return {
              kind: 'answer' as const,
              answer: {
                video: kept(page, { version: at, fps: timeline.fps, scale, frames: total, bytes: standing }),
                path: file,
              } satisfies Exported,
            };
          yield* roomFor(file, need);
          failed.get(page)?.delete(id);
          const job: Job = {
            id,
            page,
            file,
            need,
            started: yield* Deferred.make<void, GateRefusal<JobRefusal>>(),
            video: {
              job: id,
              version: at,
              fps: timeline.fps,
              scale,
              state: 'queued',
              frames: 0,
              total,
              url: null,
              bytes: null,
              problem: null,
            },
          };
          jobs.set(id, job);
          const now = yield* permits.takeIfAvailable(1);
          const drawing = draw(job, { html: found.html, timeline, scale, targets: slots.targets, file });
          yield* FiberMap.run(
            fibers,
            id,
            (now ? Effect.ensuring(drawing, permits.release(1)) : permits.withPermit(drawing)).pipe(
              Effect.onExit((exit) => ended(job, exit)),
              Effect.withSpan('Videos.draw', { attributes: { frames: total, scale } }),
            ),
          );
          return { kind: 'job' as const, job, now };
        }),
      );
      if (admitted.kind === 'answer') return admitted.answer;
      if (!admitted.now) {
        yield* publish(page);
        return { video: admitted.job.video, path: null };
      }
      yield* Deferred.await(admitted.job.started);
      return { video: admitted.job.video, path: null };
    }),
    cancel: Effect.fn('Videos.cancel')(function* (job) {
      if (!jobs.has(job)) {
        return yield* new GateRefusal('video-unknown', `no video export ${job} is queued or drawing`, [
          'export_artifact_video — answers the job under way or the finished video',
        ]);
      }
      yield* FiberMap.remove(fibers, job);
    }),
    drop: Effect.fn('Videos.drop')(function* (page) {
      for (const job of [...jobs.values()]) if (job.page === page) yield* FiberMap.remove(fibers, job.id);
      failed.delete(page);
      yield* settle(page);
    }),
    follow: (page) =>
      Stream.unwrap(
        Effect.map(
          Effect.acquireRelease(watch(page), (group) => unwatch(page, group)),
          (group) => Stream.fromPubSub(group.moved),
        ),
      ),
  });
});
