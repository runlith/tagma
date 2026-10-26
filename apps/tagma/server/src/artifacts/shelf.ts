import { join as joinPath, resolve } from 'node:path';
import { Effect, Exit, PubSub, Semaphore, Stream } from 'effect';
import { eventReason, workerGone } from '@runlith/utils/worker';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ArtifactStore } from './contract/service/shelf.js';
import { ARTIFACT_ID, type ShelfState, type ThreadPages, VIDEO_FILE } from './contract/wire/artifacts.js';
import type { ShelfAsk, ShelfJob, ShelfJobs, ShelfMessage, ShelfReply, ShelfRequest } from './protocol.js';

type Following = { readonly id: number; readonly moved: PubSub.PubSub<Exit.Exit<ThreadPages>>; users: number };

type Watching = { readonly moved: PubSub.PubSub<Exit.Exit<ShelfState>>; users: number };

const VERSION = /^\d{8}T\d{9}Z(?:-\d+)?$/u;

export const versionedShelf = Effect.fn('ArtifactStore.make')(function* (root: string, origin: string) {
  let worker: Worker | undefined;
  let ready = false;
  let closed = false;
  let asked = 0;
  let drained: (() => void) | undefined;
  const waiting = new Map<number, { readonly ask: ShelfAsk; readonly answer: (reply: ShelfReply) => void }>();
  const following = new Map<string, Following>();
  const watching = new Map<string, Watching>();
  const changes = yield* Semaphore.make(1);
  let followed = 0;

  const idle = () => {
    if (waiting.size !== 0) return;
    worker?.unref();
    drained?.();
  };

  const lost = (thread: Worker, reason: string) => {
    if (worker !== thread) return;
    worker = undefined;
    ready = false;
    thread.terminate();
    const gone = workerGone('artifact shelf worker', reason);
    const pending = [...waiting.entries()];
    waiting.clear();
    const active = [...following.values()];
    following.clear();
    const watched = [...watching.values()];
    watching.clear();
    for (const group of active) Effect.runFork(PubSub.publish(group.moved, Exit.die(gone)));
    for (const group of watched) Effect.runFork(PubSub.publish(group.moved, Exit.die(gone)));
    for (const [id, one] of pending) one.answer({ id, kind: 'failed', reason: gone.message });
    idle();
  };

  const send = (thread: Worker, ask: ShelfAsk) => {
    try {
      thread.postMessage(ask);
    } catch (failure) {
      lost(thread, String(failure));
    }
  };

  const started = () => {
    if (worker !== undefined) return worker;
    const thread = new Worker(new URL('./shelf.worker.ts', import.meta.url), { type: 'module' });
    worker = thread;
    thread.addEventListener('message', (event: MessageEvent<ShelfMessage>) => {
      if (worker !== thread) return;
      const reply = event.data;
      if (reply.kind === 'ready') {
        ready = true;
        for (const pending of [...waiting.values()]) {
          if (worker !== thread) return;
          send(thread, pending.ask);
        }
        return;
      }
      if (reply.kind === 'failed') {
        lost(thread, reply.reason);
        return;
      }
      const pending = waiting.get(reply.id);
      waiting.delete(reply.id);
      pending?.answer(reply);
      idle();
    });
    thread.addEventListener('error', (event: ErrorEvent) => lost(thread, eventReason(event, 'the shelf worker failed')));
    thread.addEventListener('messageerror', () => lost(thread, 'the shelf worker answer could not be read'));
    thread.addEventListener('close', () => lost(thread, 'the shelf worker closed before answering'));
    thread.unref();
    return thread;
  };

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      const active = [...following.values()];
      following.clear();
      for (const group of active) yield* PubSub.shutdown(group.moved);
      const watched = [...watching.values()];
      watching.clear();
      for (const group of watched) yield* PubSub.shutdown(group.moved);
      yield* Effect.callback<void>((resume) => {
        drained = () => {
          worker?.terminate();
          worker = undefined;
          resume(Effect.void);
        };
        idle();
      });
    }),
  );

  const ask = <K extends ShelfJob>(kind: K, input: ShelfJobs[K]['input']): Effect.Effect<ShelfJobs[K]['output'], ShelfJobs[K]['error']> =>
    Effect.callback<ShelfJobs[K]['output'], ShelfJobs[K]['error']>((resume) => {
      if (closed) {
        resume(Effect.die(workerGone('artifact shelf worker', 'the shelf scope closed')));
        return;
      }
      let thread: Worker;
      try {
        thread = started();
      } catch (failure) {
        resume(Effect.die(workerGone('artifact shelf worker', String(failure))));
        return;
      }
      const id = ++asked;
      const question: ShelfAsk = { id, root, origin, request: { kind, input } as ShelfRequest };
      waiting.set(id, {
        ask: question,
        answer: (reply) => {
          if (reply.kind === 'done') resume(Effect.succeed(reply.value as ShelfJobs[K]['output']));
          else if (reply.kind === 'refused')
            resume(Effect.fail(new GateRefusal(reply.refusal.code, reply.refusal.reason, reply.refusal.unblock) as ShelfJobs[K]['error']));
          else resume(Effect.die(new Error(reply.reason)));
        },
      });
      thread.ref();
      if (ready) send(thread, question);
    }).pipe(Effect.uninterruptible);

  const join = Effect.fn('ArtifactStore.follow')(function* (key: string, threads: readonly string[], limit: number) {
    const shared = following.get(key);
    if (shared !== undefined) {
      shared.users += 1;
      return shared;
    }
    const moved = yield* PubSub.sliding<Exit.Exit<ThreadPages>>({ capacity: 1, replay: 1 });
    const id = ++followed;
    const group: Following = { id, moved, users: 1 };
    following.set(key, group);
    const initial = yield* Effect.exit(ask('follow', { id, threads, limit }));
    if (Exit.isFailure(initial)) {
      if (following.get(key) === group) following.delete(key);
      yield* PubSub.shutdown(moved);
      return yield* Effect.failCause(initial.cause);
    }
    yield* PubSub.publish(moved, initial);
    return group;
  }, changes.withPermit);

  const leave = Effect.fn('ArtifactStore.unfollow')(function* (key: string, group: Following) {
    group.users -= 1;
    if (group.users > 0) return;
    yield* Effect.ensuring(
      Effect.gen(function* () {
        if (following.get(key) !== group) return;
        following.delete(key);
        yield* ask('unfollow', group.id);
      }),
      PubSub.shutdown(group.moved),
    );
  }, changes.withPermit);

  const watch = Effect.fn('ArtifactStore.followPage')(function* (id: string) {
    const shared = watching.get(id);
    if (shared !== undefined) {
      shared.users += 1;
      return shared;
    }
    const moved = yield* PubSub.sliding<Exit.Exit<ShelfState>>({ capacity: 1, replay: 1 });
    const group: Watching = { moved, users: 1 };
    watching.set(id, group);
    const initial = yield* Effect.exit(ask('state', id));
    if (Exit.isFailure(initial)) {
      if (watching.get(id) === group) watching.delete(id);
      yield* PubSub.shutdown(moved);
      return yield* Effect.failCause(initial.cause);
    }
    yield* PubSub.publish(moved, initial);
    return group;
  }, changes.withPermit);

  const unwatch = Effect.fn('ArtifactStore.unfollowPage')(function* (id: string, group: Watching) {
    group.users -= 1;
    if (group.users > 0) return;
    if (watching.get(id) === group) watching.delete(id);
    yield* PubSub.shutdown(group.moved);
  }, changes.withPermit);

  return ArtifactStore.of({
    publish: Effect.fn('ArtifactStore.publish')(
      function* (input) {
        const published = yield* ask('publish', { ...input, path: resolve(input.path) });
        const groups = new Map([...following.values()].map((group) => [group.id, group]));
        for (const update of published.updates) {
          const group = groups.get(update.id);
          if (group !== undefined) yield* PubSub.publish(group.moved, Exit.succeed(update.value));
        }
        const watched = watching.get(published.record.id);
        if (watched !== undefined) yield* PubSub.publish(watched.moved, Exit.succeed({ current: published.record, kept: published.kept }));
        if (published.maintenance !== null) {
          yield* ask('maintain', null).pipe(
            Effect.withSpan('artifacts.compact', { attributes: published.maintenance }),
            Effect.matchCauseEffect({
              onFailure: (cause) =>
                Effect.logWarning(
                  'the page was published, but order compaction did not finish; the next read or open restores the index',
                  cause,
                ),
              onSuccess: (failure) =>
                failure === null
                  ? Effect.void
                  : Effect.logWarning(
                      failure.recovered
                        ? 'artifact order compaction failed after the page was published; the index was rebuilt in its place'
                        : 'artifact order compaction failed after the page was published, and so did the rebuild; the next read or open rebuilds it',
                      failure.failure,
                    ),
            }),
          );
        }
        return { record: published.record, timelineProblem: published.timelineProblem };
      },
      changes.withPermit,
      Effect.uninterruptible,
    ),
    draft: Effect.fn('ArtifactStore.draft')((path) => ask('draft', resolve(path))),
    list: Effect.fn('ArtifactStore.list')((request) => ask('list', request)),
    page: Effect.fn('ArtifactStore.page')((id, version) => ask('page', { id, version })),
    versions: Effect.fn('ArtifactStore.versions')((id) => ask('versions', id)),
    pages: Effect.fn('ArtifactStore.pages')((threads, limit) => ask('pages', { threads, limit })),
    videos: Effect.fn('ArtifactStore.videos')((id) => ask('videos', id)),
    videoFile: (id, version, name) =>
      ARTIFACT_ID.test(id) && VERSION.test(version) && VIDEO_FILE.test(name) ? joinPath(root, id, version, name) : null,
    follow: (threads, limit) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const team = [...new Set(threads)];
          const key = JSON.stringify([team, limit]);
          const group = yield* Effect.acquireRelease(join(key, team, limit), (group) => leave(key, group));
          return Stream.fromPubSub(group.moved).pipe(Stream.mapEffect((frame) => frame));
        }),
      ),
    followPage: (id) =>
      Stream.unwrap(
        Effect.map(
          Effect.acquireRelease(watch(id), (group) => unwatch(id, group)),
          (group) => Stream.fromPubSub(group.moved).pipe(Stream.mapEffect((frame) => frame)),
        ),
      ),
  });
});
