import { expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Exit, Fiber, Layer, PubSub, Scope, Stream } from 'effect';
import { SourceChanges, type SourceShift } from './contract/service/changes.js';
import { NextInstallation } from '../installation/contract/service/next.js';
import type { NextFrame } from '../installation/contract/wire/next.js';
import { checkoutBuildsLayer } from './runner.js';
import { spawnedEffect } from '../platform/testing/spawn.js';

const offered = (frame: NextFrame, id: string) => frame.offers.find((offer) => offer.id === id);

it.live('the source publishes one revision to its readers, follows commits and files, and resumes with a fresh snapshot', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'tagma-source-'))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    );
    const git = Effect.fnUntraced(function* (...args: string[]) {
      const ran = yield* spawnedEffect(['git', '-C', root, ...args]);
      if (ran.exitCode !== 0) return yield* Effect.die(ran.stderr.toString());
      return ran.stdout.toString().trim();
    });
    yield* Effect.promise(() => writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { 'tagma:build': 'true' } })));
    yield* git('init', '-q');
    yield* git('add', '.');
    yield* git('commit', '-qm', 'first');
    const head = yield* git('rev-parse', 'HEAD');
    const movements = yield* PubSub.sliding<SourceShift>(1);
    const layer = checkoutBuildsLayer({
      checkout: root,
      log: join(root, 'build.log'),
      worktrees: join(root, 'build'),
      running: { head, dirty: false, tree: null },
    }).pipe(
      Layer.provide(
        Layer.succeed(SourceChanges, {
          watch: () =>
            Stream.unwrap(
              Effect.gen(function* () {
                const queue = yield* PubSub.subscribe(movements);
                return Stream.concat(Stream.succeed({ history: true, watched: true, paths: null }), Stream.fromSubscription(queue));
              }),
            ),
        }),
      ),
    );
    const next = yield* Effect.flatMap(Layer.build(layer), (context) => Effect.succeed(Context.get(context, NextInstallation)));
    const first = yield* Deferred.make<NextFrame>();
    const committed = yield* Deferred.make<NextFrame>();
    const edited = yield* Deferred.make<NextFrame>();
    const listenerScope = yield* Scope.fork(yield* Scope.Scope);
    const follower = yield* Effect.forkIn(
      Stream.runForEach(next.changes, (frame) => {
        if (frame.standing.tone === 'latest') return Deferred.succeed(first, frame);
        if (offered(frame, 'tree')?.label === '+1 file') return Deferred.succeed(edited, frame);
        return Deferred.succeed(committed, frame);
      }),
      listenerScope,
    );
    const initial = yield* Effect.raceFirst(
      Deferred.await(first),
      Fiber.join(follower).pipe(Effect.andThen(Effect.fail(new Error('source feed ended before its snapshot')))),
    );
    const same = yield* Stream.runHead(next.changes);
    expect(same._tag === 'Some' && same.value.revision).toBe(initial.revision);
    expect((yield* next.reading).revision).toBe(initial.revision);
    expect(initial.update).toBeNull();

    yield* git('commit', '--allow-empty', '-qm', 'second');
    yield* PubSub.publish(movements, { history: true, watched: true, paths: null });
    const moved = yield* Deferred.await(committed);
    expect(moved.standing).toMatchObject({ tone: 'behind', behind: '1 commit', behindBy: 1 });
    expect(offered(moved, 'head')?.detail).toBe('second');
    expect(offered(moved, 'tree')?.label).toBe('');
    expect(moved.update).toBe('head');
    expect(moved.revision).toBeGreaterThan(initial.revision);

    yield* Effect.promise(() => writeFile(join(root, 'new.txt'), 'edit'));
    yield* PubSub.publish(movements, { history: false, watched: true, paths: ['new.txt'] });
    const changed = yield* Deferred.await(edited);
    expect(changed.standing.behind).toBe('1 commit');
    expect(changed.update).toBe('tree');
    expect((yield* next.reading).revision).toBe(changed.revision);

    yield* PubSub.publish(movements, { history: true, watched: false, paths: null });
    yield* Stream.runHead(Stream.filter(next.changes, (frame) => !frame.watched));
    yield* Effect.promise(() => writeFile(join(root, 'other.txt'), 'unobserved'));
    expect(offered(yield* next.reading, 'tree')?.label).toBe('+2 files');
    yield* PubSub.publish(movements, { history: true, watched: true, paths: null });
    const restored = yield* Stream.runHead(
      Stream.filter(next.changes, (frame) => frame.watched && offered(frame, 'tree')?.label === '+2 files'),
    );
    expect(restored._tag === 'Some' && restored.value.standing.behind).toBe('1 commit');

    yield* Effect.promise(() => writeFile(join(root, 'package.json'), '{'));
    yield* PubSub.publish(movements, { history: false, watched: true, paths: ['package.json'] });
    const failed = yield* Stream.runHead(Stream.filter(next.changes, (frame) => frame.issue !== null));
    expect(failed._tag === 'Some' && failed.value.issue?.code).toBe('source-unreadable');
    expect(failed._tag === 'Some' && failed.value.update).toBeNull();
    expect(failed._tag === 'Some' && offered(failed.value, 'head')?.disabled).toBe(
      failed._tag === 'Some' ? failed.value.issue?.reason : null,
    );
    const denied = yield* Effect.result(next.install('head', null, null));
    expect(denied._tag === 'Failure' && denied.failure.code).toBe('source-unreadable');

    yield* Effect.promise(() => writeFile(join(root, 'package.json'), JSON.stringify({ name: 'no-build' })));
    yield* PubSub.publish(movements, { history: false, watched: true, paths: ['package.json'] });
    const removed = yield* Stream.runHead(Stream.filter(next.changes, (frame) => frame.issue === null && frame.standing.tone === 'alone'));
    expect(removed._tag === 'Some' && removed.value.offers).toEqual([]);

    yield* Effect.promise(() => writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { 'tagma:build': 'true' } })));
    yield* PubSub.publish(movements, { history: false, watched: true, paths: ['package.json'] });
    const repaired = yield* Stream.runHead(
      Stream.filter(next.changes, (frame) => frame.issue === null && offered(frame, 'tree')?.label === '+2 files'),
    );
    expect(repaired._tag === 'Some' && offered(repaired.value, 'head')?.disabled).toBeNull();
    yield* Scope.close(listenerScope, Exit.void);
    yield* Fiber.await(follower);

    yield* git('add', '.');
    yield* git('commit', '-qm', 'third');
    const renewed = yield* Stream.runHead(next.changes);
    expect(renewed._tag === 'Some' && renewed.value.standing.behindBy).toBe(2);
    expect(renewed._tag === 'Some' && offered(renewed.value, 'tree')?.label).toBe('');
  }),
);
