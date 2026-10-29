import { pictureSize } from '@runlith/cdp/screencast';
import { Cause, Clock, Deferred, Effect, Exit, FileSystem, Option, Path, Scope, Stream } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type Clip, Clips } from '../contract/service/clips.js';
import { Pages } from '../contract/service/pages.js';
import { BrowserPlace, recordingsOf } from '../contract/service/place.js';
import { Recordings } from '../contract/service/recordings.js';
import { ThreadRuns } from '../contract/service/runs.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Recorded } from '../contract/wire/recording.js';
import type { Budget } from '../contract/wire/screencast.js';
import type { Drive } from './drive.js';
import { endsWithRun } from './lifetime.js';
import type { Shot, Shots } from './screencast.js';

const BUDGET: Budget = { width: 1920, height: 1920, scale: 2 };
const KEPT = 10;

type Failed = GateRefusal<'recording-failed'>;

type Running = {
  readonly page: PageId;
  readonly by: string | null;
  readonly fps: number;
  readonly started: number;
  readonly file: string;
  readonly part: string;
  readonly life: Scope.Closeable;
  readonly stopped: Deferred.Deferred<void>;
  stoppedAt: number | null;
  readonly ready: Deferred.Deferred<void, Failed>;
  readonly done: Deferred.Deferred<Recorded, Failed>;
};

type Placed = { readonly picture: string; readonly at: number };

type Ended = { readonly path: string } | { readonly failure: Failed };

const whoOf = (by: string | null): string => (by === null ? 'the operator or an outside caller' : `thread ${by}`);

const recordingFailed = (page: PageId, reason: string) =>
  new GateRefusal('recording-failed', `the recording of page ${page} failed: ${reason}`, ['record_page with action start again']);

export const makeRecordings = Effect.fnUntraced(function* (input: { readonly drive: Drive; readonly shots: Shots }) {
  const { drive, shots } = input;
  const pages = yield* Pages;
  const runs = yield* ThreadRuns;
  const place = yield* BrowserPlace;
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const running = new Map<PageId, Running>();
  const ended = new Map<PageId, Ended>();

  const prune = Effect.fn('Recordings.prune')(function* (dir: string) {
    const names = yield* files.readDirectory(dir);
    const finished = names.filter((name) => name.endsWith('.mp4')).sort();
    const old = new Set(finished.slice(0, Math.max(0, finished.length - KEPT)));
    for (const name of names) if (old.has(name) || name.endsWith('.part')) yield* files.remove(path.join(dir, name), { force: true });
  });

  const record = Effect.fnUntraced(function* (held: Running, clips: Clips['Service']): Effect.fn.Return<Recorded, Failed> {
    const failed = (reason: string) => recordingFailed(held.page, reason);
    const slotOf = (at: number) => Math.max(0, Math.round(((at - held.started) * held.fps) / 1000));
    const state: { clip: Clip | null; pending: Placed | null } = { clip: null, pending: null };
    yield* files
      .makeDirectory(path.dirname(held.file), { recursive: true })
      .pipe(Effect.mapError((failure) => failed(`its directory was not made: ${failure.message}`)));
    if (held.by !== null) yield* Scope.provide(endsWithRun(runs, held.by, stopping(held)), held.life);
    const moves = yield* Scope.provide(pages.moves(held.page), held.life);
    yield* Stream.runHead(Stream.filter(moves, (move) => move.signal === 'closed')).pipe(
      Effect.andThen(stopping(held)),
      Effect.forkIn(held.life),
    );

    const open = Effect.fnUntraced(function* (shot: Shot) {
      const size = pictureSize(shot.data);
      if (size === undefined) return yield* Effect.logWarning(`browser: a frame of page ${held.page} carried no readable picture size`);
      state.clip = yield* Scope.provide(clips.open({ file: held.part, width: size.width, height: size.height, fps: held.fps }), held.life);
      state.pending = { picture: shot.data, at: 0 };
      yield* Deferred.succeed(held.ready, undefined);
    });

    const place = (shot: Shot) =>
      Effect.suspend(() => {
        const { clip, pending } = state;
        if (clip === null || pending === null) return open(shot);
        const at = slotOf(shot.at);
        if (at <= pending.at) {
          state.pending = { picture: shot.data, at: pending.at };
          return Effect.void;
        }
        state.pending = { picture: shot.data, at };
        return clip.frame(pending.picture, pending.at, at - pending.at);
      });

    const watched = yield* shots(held.page, BUDGET, held.stopped).pipe(
      Stream.filter((shot) => held.stoppedAt === null || shot.at <= held.stoppedAt),
      Stream.runForEach((shot) => Effect.uninterruptible(place(shot))),
      Effect.map((): string | null => null),
      Effect.catchTag('GateRefusal', (refused) => Effect.succeed(refused.reason)),
      Effect.mapError((clip) => failed(clip.message)),
    );
    const { clip, pending } = state;
    if (clip === null || pending === null) return yield* failed(watched ?? 'the page showed no frame while it was recorded');
    if (watched !== null) yield* Effect.logInfo(`browser: the recording of page ${held.page} ended with its page: ${watched}`);
    const last = Math.max(pending.at + 1, slotOf(held.stoppedAt ?? (yield* Clock.currentTimeMillis)));
    yield* clip.frame(pending.picture, pending.at, last - pending.at).pipe(
      Effect.andThen(clip.finish),
      Effect.mapError((failure) => failed(failure.message)),
    );
    yield* files.rename(held.part, held.file).pipe(Effect.mapError((failure) => failed(`the video was not kept: ${failure.message}`)));
    const info = yield* files.stat(held.file).pipe(Effect.mapError((failure) => failed(`the video was not kept: ${failure.message}`)));
    return {
      path: held.file,
      bytes: Number(info.size),
      durationMs: Math.round((last * 1000) / held.fps),
      width: clip.width,
      height: clip.height,
      fps: held.fps,
    };
  });

  const settle = Effect.fnUntraced(function* (held: Running, exit: Exit.Exit<Recorded, Failed>) {
    yield* Scope.close(held.life, Exit.void);
    yield* prune(path.dirname(held.file)).pipe(
      Effect.catchTag('PlatformError', (failure) =>
        Effect.logWarning(`browser: old recordings of page ${held.page} were not pruned: ${failure.message}`),
      ),
    );
    if (running.get(held.page) === held) running.delete(held.page);
    const outcome: Ended | undefined = Exit.isSuccess(exit)
      ? { path: exit.value.path }
      : Option.match(Cause.findErrorOption(exit.cause), { onNone: () => undefined, onSome: (failure) => ({ failure }) });
    if (outcome !== undefined) ended.set(held.page, outcome);
    if (Exit.isFailure(exit)) yield* Deferred.failCause(held.ready, exit.cause);
    yield* Deferred.done(held.done, exit);
  });

  const stopping = (held: Running) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => {
      held.stoppedAt ??= now;
      return Deferred.succeed(held.stopped, undefined);
    });

  const begin = Effect.fn('Recordings.begin')(function* (page: PageId, fps: number, thread: string | null, clips: Clips['Service']) {
    const started = yield* Clock.currentTimeMillis;
    const dir = recordingsOf(path, place, page);
    const life = yield* Scope.fork(scope);
    const standing = running.get(page);
    if (standing !== undefined) {
      yield* Scope.close(life, Exit.void);
      return yield* new GateRefusal('recording-running', `page ${page} is already recorded, started by ${whoOf(standing.by)}`, [
        'record_page with action stop ends it',
      ]);
    }
    const held: Running = {
      page,
      by: thread,
      fps,
      started,
      file: path.join(dir, `${started}.mp4`),
      part: path.join(dir, `${started}.mp4.part`),
      life,
      stopped: Deferred.makeUnsafe<void>(),
      stoppedAt: null,
      ready: Deferred.makeUnsafe<void, Failed>(),
      done: Deferred.makeUnsafe<Recorded, Failed>(),
    };
    yield* Effect.uninterruptible(
      Effect.suspend(() => {
        running.set(page, held);
        ended.delete(page);
        return record(held, clips).pipe(
          Effect.onExit((exit) => settle(held, exit)),
          Effect.forkIn(scope),
        );
      }),
    );
    return held;
  });

  return Recordings.of({
    start: Effect.fn('Recordings.start')(function* (page, fps, thread) {
      const clips = yield* Clips;
      const held = yield* drive.drive(page, thread, () => begin(page, fps, thread, clips));
      yield* Deferred.await(held.ready);
      return { page: pages.glance(page, false), path: held.file, fps };
    }),
    stop: Effect.fn('Recordings.stop')(function* (page, thread) {
      const held = running.get(page);
      if (held === undefined) {
        const last = ended.get(page);
        if (last !== undefined && 'failure' in last) {
          ended.delete(page);
          return yield* last.failure;
        }
        return yield* new GateRefusal(
          'no-recording',
          last === undefined
            ? `no recording is running on page ${page}`
            : `no recording is running on page ${page}; the last one ended and is at ${last.path}`,
          ['record_page with action start records one'],
        );
      }
      yield* drive.drive(page, thread, () => Effect.void);
      yield* stopping(held);
      const recorded = yield* Deferred.await(held.done);
      return { page: pages.glance(page, false), ...recorded };
    }),
  });
});
