import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Ref, Result } from 'effect';
import { join } from 'node:path';
import { fixtureHome } from './roots.js';
import { FixtureScope } from './scope.js';

const home = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'fixture-scope-' });
  const sentinel = join(directory, 'a-peer-was-here.txt');
  yield* fileSystem.writeFileString(sentinel, 'a peer owns this file');
  return { root: join(directory, 'run'), sentinel };
});

const standing = (path: string) => Effect.flatMap(FileSystem.FileSystem, (fileSystem) => fileSystem.exists(path));

const hostAnswering = (answer: (real: FileSystem.FileSystem) => Partial<FileSystem.FileSystem>): Layer.Layer<FileSystem.FileSystem> =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (real): FileSystem.FileSystem => ({ ...real, ...answer(real) })),
  ).pipe(Layer.provide(BunFileSystem.layer));

const heldCreation = (target: string, reached: Deferred.Deferred<void>, gate: Deferred.Deferred<void>) =>
  hostAnswering((real) => ({
    makeDirectory: (path, options) =>
      path === target
        ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(gate)), Effect.andThen(real.makeDirectory(path, options)))
        : real.makeDirectory(path, options),
  }));

const failedWith = <A, E>(exit: Exit.Exit<A, E>): E | undefined => {
  if (Exit.isSuccess(exit)) return undefined;
  const failure = Cause.findError(exit.cause);
  return Result.isSuccess(failure) ? failure.success : undefined;
};

const stop = (child: Bun.Subprocess): Effect.Effect<void> =>
  Effect.promise(async () => {
    child.kill('SIGKILL');
    await child.exited;
  });

const owned = (command: readonly string[], stdout: 'ignore' | 'pipe') =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.spawn([...command], { stdio: ['ignore', stdout, 'ignore'] })),
    stop,
  );

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const end = (pid: number): void => {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
};

const announcedPid = async (stream: ReadableStream<Uint8Array>): Promise<number> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let said = '';
  while (!said.includes('\n')) {
    const { done, value } = await reader.read();
    if (done) break;
    said += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  const pid = Number(said.trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`the child announced no pid: ${JSON.stringify(said)}`);
  return pid;
};

layer(BunFileSystem.layer)('fixture lifetime', (it) => {
  it.effect('releases what construction had already allocated when construction then fails', () =>
    Effect.gen(function* () {
      const { root, sentinel } = yield* home();
      const inner = yield* Ref.make('');

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          yield* Ref.set(inner, yield* fixture.directory('workspace/inner'));
          return yield* Effect.fail('startup failed after allocating');
        }),
      );

      expect(Exit.isFailure(outcome.outcome)).toBe(true);
      expect(outcome.release.state).toBe('released');
      expect(yield* standing(yield* Ref.get(inner))).toBe(false);
      expect(yield* standing(root)).toBe(false);
      expect(yield* standing(sentinel)).toBe(true);
    }),
  );

  it.effect('retains the release beside a body that died', () =>
    Effect.gen(function* () {
      const { root } = yield* home();

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.andThen(fixture.directory('work'), Effect.die(new Error('the body crashed after allocating'))),
      );

      expect(Exit.hasDies(outcome.outcome)).toBe(true);
      expect(failedWith(outcome.outcome)).toBeUndefined();
      expect(outcome.release.state).toBe('released');
      expect(yield* standing(root)).toBe(false);
    }),
  );

  it.effect('releases the root when the body itself cannot be built', () =>
    Effect.gen(function* () {
      const { root } = yield* home();

      const outcome = yield* FixtureScope.use(root, (): Effect.Effect<never> => {
        throw new Error('the fixture body could not be built');
      });

      expect(Exit.hasDies(outcome.outcome)).toBe(true);
      expect(outcome.release.state).toBe('released');
      expect(yield* standing(root)).toBe(false);
    }),
  );

  it.effect('stops every producer, keeps each failure, and quarantines the paths under an unconfirmed one', () =>
    Effect.gen(function* () {
      const { root, sentinel } = yield* home();

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          yield* fixture.directory('one');
          yield* fixture.producer('watcher', Effect.fail('the watcher would not stop'));
          yield* fixture.producer('server', Effect.die(new Error('the server crashed while stopping')));
          yield* fixture.producer('pool', Effect.interrupt);
        }),
      );

      expect(outcome.release.failures.map((failure) => failure.name).sort()).toEqual(['pool', 'server', 'watcher']);
      const reasons = Object.fromEntries(outcome.release.failures.map((failure) => [failure.name, failure.reason]));
      expect(reasons.watcher).toBe('the watcher would not stop');
      expect(reasons.server).toContain('crashed while stopping');
      expect(reasons.pool).toContain('interrupted');
      expect(outcome.release.state).toBe('unknown');
      expect([...outcome.release.remaining].sort()).toEqual([join(root, 'one'), root].sort());
      expect(yield* standing(root)).toBe(true);
      expect(yield* standing(sentinel)).toBe(true);
    }),
  );

  it.effect('keeps its paths until the producer confirms it stopped', () =>
    Effect.gen(function* () {
      const { root } = yield* home();
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const closing = yield* Effect.forkChild(
        FixtureScope.use(root, (fixture) =>
          fixture.producer('runner', Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(stopped))),
        ),
      );
      yield* Deferred.await(started);
      expect(yield* standing(root)).toBe(true);
      yield* Deferred.succeed(stopped, undefined);
      const outcome = yield* Fiber.join(closing);
      expect(outcome.release).toEqual({ state: 'released', failures: [], remaining: [] });
      expect(yield* standing(root)).toBe(false);
    }),
  );

  it.effect('answers every later close with the one retained result and stops each producer once', () =>
    Effect.gen(function* () {
      const { root } = yield* home();
      const stops = yield* Ref.make(0);

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const gate = yield* Deferred.make<void>();
          yield* fixture.producer(
            'watcher',
            Ref.update(stops, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(gate)),
              Effect.andThen(Effect.fail('the watcher would not stop')),
            ),
          );

          const first = yield* Effect.forkChild(fixture.close());
          yield* Deferred.await(started);
          const overlapping = yield* Effect.forkChild(fixture.close());
          yield* Deferred.succeed(gate, undefined);
          return [yield* Fiber.join(first), yield* Fiber.join(overlapping)] as const;
        }),
      );

      const answered = Exit.isSuccess(outcome.outcome) ? outcome.outcome.value : [];
      expect(answered.map((report) => report.state)).toEqual(['unknown', 'unknown']);
      expect(answered.map((report) => report.failures.map((failure) => failure.name))).toEqual([['watcher'], ['watcher']]);
      expect(outcome.release.state).toBe('unknown');
      expect(yield* Ref.get(stops)).toBe(1);
    }),
  );

  it.effect('finishes an admitted acquisition before the close removes anything', () =>
    Effect.gen(function* () {
      const { root } = yield* home();
      const late = join(root, 'late');
      const reached = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const asked = yield* Ref.make<readonly string[]>([]);
      const note = (word: string) => Ref.update(asked, (words) => [...words, word]);

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          const acquiring = yield* Effect.forkChild(fixture.directory('late'));
          yield* Deferred.await(reached);
          const closing = yield* Effect.forkChild(fixture.close());
          yield* Deferred.succeed(gate, undefined);
          return [yield* Fiber.join(acquiring), yield* Fiber.join(closing)] as const;
        }),
      ).pipe(
        Effect.provide(
          hostAnswering((real) => ({
            makeDirectory: (path, options) =>
              path === late
                ? Deferred.succeed(reached, undefined).pipe(
                    Effect.andThen(Deferred.await(gate)),
                    Effect.andThen(real.makeDirectory(path, options)),
                    Effect.tap(() => note('made')),
                  )
                : real.makeDirectory(path, options),
            remove: (path, options) => note('removed').pipe(Effect.andThen(real.remove(path, options))),
          })),
        ),
      );

      const [made, report] = Exit.isSuccess(outcome.outcome) ? outcome.outcome.value : [];
      expect(made).toBe(late);
      expect((yield* Ref.get(asked))[0]).toBe('made');
      expect(report?.state).toBe('released');
      expect(yield* standing(late)).toBe(false);
      expect(yield* standing(root)).toBe(false);
    }),
  );

  it.effect('still releases everything it owned when the whole use is interrupted from outside', () =>
    Effect.gen(function* () {
      const { root, sentinel } = yield* home();
      const working = yield* Deferred.make<void>();
      const delivered = yield* Ref.make('nothing reached the caller');

      const using = yield* Effect.forkChild(
        FixtureScope.use(root, (fixture) =>
          Effect.gen(function* () {
            yield* fixture.directory('work');
            yield* Deferred.succeed(working, undefined);
            return yield* Effect.never;
          }),
        ).pipe(Effect.tap((answer) => Ref.set(delivered, `an outcome reached the caller: ${answer.release.state}`))),
      );
      yield* Deferred.await(working);
      yield* Fiber.interrupt(using);
      const ended = yield* Fiber.await(using);

      expect(Exit.hasInterrupts(ended)).toBe(true);
      expect(yield* Ref.get(delivered)).toBe('nothing reached the caller');
      expect(yield* standing(join(root, 'work'))).toBe(false);
      expect(yield* standing(root)).toBe(false);
      expect(yield* standing(sentinel)).toBe(true);
    }),
  );

  it.effect('cancels an acquisition still waiting for the fixture, and lets the close through', () =>
    Effect.gen(function* () {
      const { root } = yield* home();
      const first = join(root, 'first');
      const queued = join(root, 'queued');
      const reached = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          const holding = yield* Effect.forkChild(fixture.directory('first'));
          yield* Deferred.await(reached);
          const waiting = yield* Effect.forkChild(fixture.directory('queued'));
          yield* Fiber.interrupt(waiting);
          const closing = yield* Effect.forkChild(fixture.close());
          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(holding);
          return yield* Fiber.join(closing);
        }),
      ).pipe(Effect.provide(heldCreation(first, reached, gate)));

      const report = Exit.isSuccess(outcome.outcome) ? outcome.outcome.value : undefined;
      expect(report?.state).toBe('released');
      expect(yield* standing(queued)).toBe(false);
      expect(yield* standing(first)).toBe(false);
      expect(yield* standing(root)).toBe(false);
    }),
  );

  it.effect('holds the close until a creation the host cannot take back has actually landed', () =>
    Effect.gen(function* () {
      const { root } = yield* home();
      const late = join(root, 'late');
      const issued = yield* Deferred.make<void>();
      const lands = yield* Deferred.make<void>();
      const asked = yield* Ref.make<readonly string[]>([]);
      const note = (word: string) => Ref.update(asked, (words) => [...words, word]);

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          const acquiring = yield* Effect.forkChild(fixture.directory('late'));
          yield* Deferred.await(issued);
          yield* Effect.sync(() => acquiring.interruptUnsafe());
          const closing = yield* Effect.forkChild(fixture.close(), { startImmediately: true });
          yield* Deferred.succeed(lands, undefined);
          yield* Fiber.await(acquiring);
          return yield* Fiber.join(closing);
        }),
      ).pipe(
        Effect.provide(
          hostAnswering((real) => ({
            makeDirectory: (path, options) =>
              path === late
                ? Deferred.succeed(issued, undefined).pipe(
                    Effect.andThen(Deferred.await(lands)),
                    Effect.andThen(real.makeDirectory(path, options)),
                    Effect.tap(() => note('made')),
                  )
                : real.makeDirectory(path, options),
            remove: (path, options) => note('removed').pipe(Effect.andThen(real.remove(path, options))),
          })),
        ),
      );

      const report = Exit.isSuccess(outcome.outcome) ? outcome.outcome.value : undefined;
      expect((yield* Ref.get(asked))[0]).toBe('made');
      expect(report?.state).toBe('released');
      expect(yield* standing(late)).toBe(false);
      expect(yield* standing(root)).toBe(false);
    }),
  );

  it.effect('releases a scope-acquired fixture when that scope ends, and answers the same report after', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { root, sentinel } = yield* home();

      const [fixture, made] = yield* Effect.scoped(
        Effect.gen(function* () {
          const held = yield* FixtureScope.acquire(root);
          return [held, yield* held.directory('work')] as const;
        }),
      );

      expect(yield* standing(made)).toBe(false);
      expect(yield* standing(root)).toBe(false);
      expect(yield* standing(sentinel)).toBe(true);

      const peer = join(root, 'a-peer-file');
      yield* fileSystem.makeDirectory(root, { recursive: true });
      yield* fileSystem.writeFileString(peer, 'a peer took the freed path');
      const report = yield* fixture.close();

      expect(report.state).toBe('released');
      expect(report.failures).toEqual([]);
      expect(yield* standing(peer)).toBe(true);
    }),
  );

  it.effect('leaves the end of the scope nothing to remove after an explicit close', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { root } = yield* home();
      const peer = join(root, 'a-peer-file');

      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const held = yield* FixtureScope.acquire(root);
          yield* held.directory('work');
          const answered = yield* held.close();
          yield* fileSystem.makeDirectory(root, { recursive: true });
          yield* fileSystem.writeFileString(peer, 'a peer took the freed path');
          return answered;
        }),
      );

      expect(report.state).toBe('released');
      expect(yield* standing(peer)).toBe(true);
    }),
  );

  it.effect('refuses to acquire a root that already stands and leaves what is inside it untouched', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { root } = yield* home();
      const peer = join(root, 'a-peer-file');
      yield* fileSystem.makeDirectory(root, { recursive: true });
      yield* fileSystem.writeFileString(peer, 'a peer made this root');

      const refused = yield* Effect.scoped(Effect.result(FixtureScope.acquire(root)));

      expect(Result.isFailure(refused) && refused.failure._tag).toBe('FixtureRootConflict');
      expect(yield* standing(peer)).toBe(true);
    }),
  );

  it.effect('releases a root whose acquisition was interrupted while the host was making it', () =>
    Effect.gen(function* () {
      const { root, sentinel } = yield* home();
      const issued = yield* Deferred.make<void>();
      const lands = yield* Deferred.make<void>();

      const acquiring = yield* Effect.forkChild(
        Effect.scoped(Effect.flatMap(FixtureScope.acquire(root), (held) => held.directory('work'))).pipe(
          Effect.provide(
            hostAnswering((real) => ({
              makeDirectory: (path, options) =>
                path === root
                  ? Deferred.succeed(issued, undefined).pipe(
                      Effect.andThen(Deferred.await(lands)),
                      Effect.andThen(real.makeDirectory(path, options)),
                    )
                  : real.makeDirectory(path, options),
            })),
          ),
        ),
      );
      yield* Deferred.await(issued);
      yield* Effect.sync(() => acquiring.interruptUnsafe());
      yield* Deferred.succeed(lands, undefined);
      const ended = yield* Fiber.await(acquiring);

      expect(Exit.hasInterrupts(ended)).toBe(true);
      expect(yield* standing(root)).toBe(false);
      expect(yield* standing(sentinel)).toBe(true);
    }),
  );

  it.effect('refuses a directory and a producer taken after closing began', () =>
    Effect.gen(function* () {
      const { root } = yield* home();

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          yield* fixture.close();
          return [yield* Effect.result(fixture.directory('late')), yield* Effect.result(fixture.producer('late', Effect.void))] as const;
        }),
      );

      const [directory, producer] = Exit.isSuccess(outcome.outcome) ? outcome.outcome.value : [];
      expect(directory !== undefined && Result.isFailure(directory) && directory.failure._tag).toBe('FixtureRefused');
      expect(producer !== undefined && Result.isFailure(producer) && producer.failure._tag).toBe('FixtureRefused');
      expect(yield* standing(join(root, 'late'))).toBe(false);
      expect(yield* standing(root)).toBe(false);
    }),
  );

  it.effect('refuses a root that already stands and leaves what is inside it untouched', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { root } = yield* home();
      const peer = join(root, 'a-peer-file');
      yield* fileSystem.makeDirectory(root, { recursive: true });
      yield* fileSystem.writeFileString(peer, 'a peer made this root');

      const refused = yield* Effect.result(FixtureScope.use(root, () => Effect.void));

      expect(Result.isFailure(refused) && refused.failure._tag).toBe('FixtureRootConflict');
      expect(yield* standing(peer)).toBe(true);
    }),
  );

  it.effect('keeps a path the host would not measure as uncertainty rather than absence', () =>
    Effect.gen(function* () {
      if (process.getuid?.() === 0) return;
      const fileSystem = yield* FileSystem.FileSystem;
      const { root } = yield* home();
      const blocked = join(root, 'blocked');

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          yield* fixture.directory('blocked');
          yield* fixture.directory('blocked/inner');
          yield* fileSystem.chmod(blocked, 0o000);
        }),
      ).pipe(Effect.ensuring(Effect.orDie(fileSystem.chmod(blocked, 0o700))));

      expect(outcome.release.state).toBe('unknown');
      expect(outcome.release.failures.map((failure) => failure.path)).toContain(join(blocked, 'inner'));
      expect(outcome.release.remaining).toContain(root);
      expect(outcome.release.remaining).not.toContain(join(blocked, 'inner'));
    }),
  );

  it.effect('reports released when its own producer is confirmed stopped', () =>
    Effect.gen(function* () {
      const { root, sentinel } = yield* home();

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        Effect.gen(function* () {
          const child = yield* owned(['tail', '-f', '/dev/null'], 'ignore');
          yield* fixture.directory('work');
          yield* fixture.producer('child', stop(child));
        }),
      );

      expect(outcome.release.state).toBe('released');
      expect(outcome.release.failures).toEqual([]);
      expect(yield* standing(root)).toBe(false);
      expect(yield* standing(sentinel)).toBe(true);
    }),
  );

  it.effect('leaves cleanup unknown when a grandchild holding the stdout pipe outlives the stop', () =>
    Effect.gen(function* () {
      const { root, sentinel } = yield* home();
      const parent = yield* owned(['sh', '-c', 'tail -f /dev/null & echo $!; wait'], 'pipe');
      const grandchild = yield* Effect.promise(() => announcedPid(parent.stdout as ReadableStream<Uint8Array>));
      yield* Effect.addFinalizer(() => Effect.sync(() => end(grandchild)));

      const outcome = yield* FixtureScope.use(root, (fixture) =>
        fixture.producer(
          'runner',
          Effect.promise(async () => {
            parent.kill('SIGTERM');
            await parent.exited;
          }).pipe(
            Effect.flatMap(() =>
              alive(grandchild) ? Effect.fail(`a descendant of the runner still holds its stdout pipe (pid ${grandchild})`) : Effect.void,
            ),
          ),
        ),
      );

      expect(outcome.release.state).toBe('unknown');
      expect(outcome.release.failures.map((failure) => failure.name)).toEqual(['runner']);
      expect(outcome.release.failures[0]?.reason).toContain('stdout pipe');
      expect(outcome.release.remaining).toEqual([root]);
      expect(yield* standing(sentinel)).toBe(true);
    }),
  );

  it.effect('refuses a child name that would climb out of the fixture', () =>
    Effect.gen(function* () {
      const { root } = yield* home();

      const outcome = yield* FixtureScope.use(root, (fixture) => fixture.directory('../escaped'));

      expect(failedWith(outcome.outcome)?._tag).toBe('FixtureNameInvalid');
    }),
  );
});
