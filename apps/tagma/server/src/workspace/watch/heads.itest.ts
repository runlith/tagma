import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Git, GitUnavailable, gitLayer } from '@runlith/git/Git';
import type { HeadMoved } from '../contract/service/checkouts.js';
import { WatchTickets } from '../../platform/contract/service/watch.js';
import { watchTickets } from '../../platform/watch/tickets.js';
import { watchProcessLayer } from '../../composition/testing/fileWatcher.js';
import { type HeadWatches, makeHeadWatches } from './heads.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const layers = Layer.mergeAll(BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)), watchProcessLayer);
const identity = { GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@tagma', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@tagma' };

const fixture = Effect.fnUntraced(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const git = yield* Git;
  const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'head-watch-' }));
  const run = (args: readonly string[], stdin?: string) =>
    git.run(args, { cwd: root, stdin, env: identity, extendEnv: true }).pipe(
      Effect.map((answer) => {
        expect(answer.status).toBe(0);
        return answer.stdout.trim();
      }),
    );
  yield* run(['init', '-q', '-b', 'main']);
  const tree = yield* run(['mktree'], '');
  const first = yield* run(['commit-tree', tree, '-m', 'first']);
  const second = yield* run(['commit-tree', tree, '-p', first, '-m', 'second']);
  yield* run(['update-ref', 'HEAD', first]);
  return { files, paths, root, git, first, second, run };
});

const work = <E>(job: Effect.Effect<void, E, Scope.Scope | Git | FileSystem.FileSystem | Path.Path>) => Effect.provide(job, layers);

const following = Effect.fnUntraced(function* (watches: HeadWatches, checkout: string) {
  const events = yield* Queue.unbounded<HeadMoved>();
  const fiber = yield* Stream.runForEach(watches.moved(checkout), (event) => Queue.offer(events, event)).pipe(Effect.forkScoped);
  return { events, fiber };
});

const head = (events: Queue.Queue<HeadMoved>, expected: string) =>
  Stream.runHead(Stream.filter(Stream.fromQueue(events), (event) => event.head === expected));

const granting = (tickets: WatchTickets['Service'], ready: Deferred.Deferred<void>, available: () => boolean) =>
  WatchTickets.of({
    grant: Effect.fnUntraced(function* () {
      const release = yield* tickets.grant();
      if (available() && tickets.standing().active === 3) yield* Deferred.succeed(ready, undefined);
      return release;
    }),
    standing: tickets.standing,
  });

it.live(
  'existing HEAD subscribers observe the next real ref movement after watcher capacity returns, and the last release frees the group',
  () =>
    work(
      Effect.gen(function* () {
        const state = yield* fixture();
        const tickets = watchTickets(6);
        const reserved = yield* Effect.forEach([0, 1, 2, 3], () => tickets.grant());
        expect(reserved.every((release) => release !== null)).toBe(true);
        const ready = yield* Deferred.make<void>();
        let available = false;
        yield* Effect.gen(function* () {
          const watches = yield* makeHeadWatches;
          const first = yield* following(watches, state.root);
          yield* head(first.events, state.first);
          expect(tickets.standing().active).toBe(4);
          for (const release of reserved) release!();
          available = true;
          yield* TestClock.adjust(2000);
          yield* Deferred.await(ready);
          const second = yield* following(watches, state.root);
          yield* head(second.events, state.first);
          expect(tickets.standing().active).toBe(3);
          yield* state.run(['update-ref', 'HEAD', state.second]);
          for (const follower of [first, second]) yield* head(follower.events, state.second);
          yield* Fiber.interrupt(first.fiber);
          expect(tickets.standing().active).toBe(3);
          yield* Fiber.interrupt(second.fiber);
          expect(tickets.standing().active).toBe(0);
        }).pipe(
          Effect.provideService(
            WatchTickets,
            granting(tickets, ready, () => available),
          ),
          Effect.provide(TestClock.layer()),
        );
      }),
    ),
);

it.live('a failed HEAD read preserves the healthy watcher and its observation until reading recovers', () =>
  work(
    Effect.gen(function* () {
      const state = yield* fixture();
      const tickets = watchTickets(3);
      const failed = yield* Deferred.make<void>();
      let unreadable = false;
      const git = Git.of({
        run: (args, options) =>
          Effect.suspend(() => {
            if (unreadable && args.some((arg) => arg.startsWith('HEAD^'))) {
              Deferred.doneUnsafe(failed, Effect.void);
              return Effect.fail(new GitUnavailable({ command: args, reason: 'HEAD reading resource unavailable' }));
            }
            return state.git.run(args, options);
          }),
        objects: state.git.objects,
      });
      yield* Effect.gen(function* () {
        const watches = yield* Effect.provideService(makeHeadWatches, Git, git);
        const subscriber = yield* following(watches, state.root);
        yield* head(subscriber.events, state.first);
        unreadable = true;
        yield* state.run(['update-ref', 'HEAD', state.second]);
        yield* Deferred.await(failed);
        expect(tickets.standing().active).toBe(3);
        expect(Queue.takeUnsafe(subscriber.events)).toBeUndefined();
        unreadable = false;
        yield* TestClock.adjust(2000);
        yield* head(subscriber.events, state.second);
        yield* state.run(['update-ref', 'HEAD', state.first]);
        yield* head(subscriber.events, state.first);
        yield* Fiber.interrupt(subscriber.fiber);
        expect(tickets.standing().active).toBe(0);
      }).pipe(Effect.provideService(WatchTickets, tickets), Effect.provide(TestClock.layer()));
    }),
  ),
);

it.live('a linked worktree removed with git worktree remove ends its observation and frees its watchers', () =>
  work(
    Effect.gen(function* () {
      const state = yield* fixture();
      const linked = state.paths.join(state.root, 'linked');
      const tickets = watchTickets(8);
      yield* state.run(['worktree', 'add', '-q', '--detach', linked, state.first]);
      yield* Effect.gen(function* () {
        const watches = yield* makeHeadWatches;
        const subscriber = yield* following(watches, linked);
        yield* head(subscriber.events, state.first);
        yield* state.run(['worktree', 'remove', '--force', linked]);
        yield* Effect.race(
          Fiber.await(subscriber.fiber),
          Effect.forEach(Array.from({ length: 500 }), () => TestClock.adjust(2000).pipe(Effect.andThen(Effect.yieldNow)), {
            discard: true,
          }),
        );
        expect(subscriber.fiber.pollUnsafe()).toBeDefined();
        expect(tickets.standing().active).toBe(0);
      }).pipe(Effect.provideService(WatchTickets, tickets), Effect.provide(TestClock.layer()));
    }),
  ),
);

it.live(
  'recovery of a missing git directory is cancelled with its last subscriber and a new subscriber observes the restored repository',
  () =>
    work(
      Effect.gen(function* () {
        const state = yield* fixture();
        const gitDir = state.paths.join(state.root, '.git');
        const missing = state.paths.join(state.root, 'git-away');
        const scope = yield* Scope.make();
        const tickets = watchTickets(3);
        yield* state.files.rename(gitDir, missing);
        yield* Effect.gen(function* () {
          const watches = yield* Effect.provideService(makeHeadWatches, Scope.Scope, scope);
          const first = yield* following(watches, state.root);
          yield* TestClock.adjust(2000);
          yield* Fiber.interrupt(first.fiber);
          yield* state.files.rename(missing, gitDir);
          yield* TestClock.adjust(60000);
          expect(tickets.standing().active).toBe(0);
          const returned = yield* Stream.runHead(watches.moved(state.root));
          expect(returned._tag === 'Some' && returned.value.head).toBe(state.first);
          expect(tickets.standing().active).toBe(0);
          yield* Scope.close(scope, Exit.void);
        }).pipe(Effect.provideService(WatchTickets, tickets), Effect.provide(TestClock.layer()));
      }),
    ),
);
