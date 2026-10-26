import { totalmem } from 'node:os';
import { Effect, Exit, Fiber, Pull, Queue, Result, Scope, Semaphore, Stream } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import {
  GitBatchUnsupported,
  GitEndingUnreadable,
  GitUnavailable,
  spawnGit,
  type GitObject,
  type GitObjectAt,
  type GitOptions,
  type Git,
} from './Git.js';

const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const HEADER = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (blob|tree|commit|tag) (\d+)$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ReadFailure = PlatformError | GitEndingUnreadable;

export const objectsAt = Effect.fn('Git.readObjects')(function* (
  git: Git['Service'],
  dir: string,
  oids: readonly string[],
  options: GitOptions = {},
): Effect.fn.Return<readonly GitObjectAt[], never> {
  if (oids.length === 0) return [];
  const configured = {
    ...options,
    env: { ...options.env, GIT_NO_REPLACE_OBJECTS: '1' },
    extendEnv: options.env === undefined ? true : options.extendEnv,
  };
  let answers: readonly GitObjectAt[];
  if (git.objects !== undefined) answers = yield* git.objects(dir, oids, configured);
  else {
    const command = ['-C', dir, 'cat-file', '--batch'];
    const ended = yield* Effect.result(
      git.run(command, { ...configured, capture: undefined, stdin: oids.map((oid) => `${oid}\n`).join(''), stdoutBytes: true }),
    );
    if (ended._tag === 'Failure') return oids.map(() => Result.fail(ended.failure));
    if (ended.success.status === 129)
      answers = oids.map(() => Result.fail(new GitBatchUnsupported({ command, reason: ended.success.stderr })));
    else if (ended.success.overflow || ended.success.stdoutBytes === undefined)
      return oids.map(() => Result.fail(new GitEndingUnreadable({ command, reason: 'git did not return complete object bytes' })));
    else {
      const bytes = ended.success.stdoutBytes;
      answers = yield* Effect.scoped(
        Effect.gen(function* () {
          const reader = makeObjectReader({ pull: yield* Stream.toPull(Stream.make(bytes)), command });
          return yield* Effect.forEach(oids, (oid) => Effect.result(reader.read(oid, options.capture)));
        }),
      );
    }
  }
  return yield* Effect.forEach(
    answers,
    (answer, at) => {
      if (answer._tag !== 'Failure' || answer.failure._tag !== 'GitBatchUnsupported') return Effect.succeed(answer);
      return Effect.result(
        Effect.gen(function* () {
          const oid = oids[at]!;
          const command = ['-C', dir, 'cat-file', '-t', oid];
          const type = yield* git.run(command, { ...configured, capture: undefined, stdin: undefined, stdoutBytes: false });
          if (type.status !== 0 || type.overflow)
            return yield* new GitEndingUnreadable({ command, reason: type.stderr || 'git did not identify the object' });
          const kind = type.stdout.trim();
          if (!['blob', 'tree', 'commit', 'tag'].includes(kind))
            return yield* new GitEndingUnreadable({ command, reason: 'git returned an invalid object type' });
          const body = yield* git.run(['-C', dir, 'cat-file', kind, oid], { ...configured, stdin: undefined, stdoutBytes: true });
          if (body.status !== 0 || body.stdoutBytes === undefined)
            return yield* new GitEndingUnreadable({ command, reason: body.stderr || 'git did not return object bytes' });
          return { type: kind, bytes: body.stdoutBytes, overflow: body.overflow, size: body.stdoutBytes.length + (body.overflow ? 1 : 0) };
        }),
      );
    },
    { concurrency: 2 },
  );
});

const makeObjectReader = ({
  pull,
  command,
}: {
  readonly pull: Pull.Pull<readonly Uint8Array[], PlatformError>;
  readonly command: readonly string[];
}) => {
  let chunks: readonly Uint8Array[] = [];
  let at = 0;
  let offset = 0;

  const available = Effect.gen(function* () {
    while (at >= chunks.length || offset >= (chunks[at]?.length ?? 0)) {
      at += 1;
      offset = 0;
      if (at >= chunks.length) {
        chunks = yield* pull.pipe(
          Pull.catchDone(() => Effect.fail(new GitEndingUnreadable({ command, reason: 'cat-file ended inside its answer' }))),
        );
        at = 0;
      }
    }
    return (chunks[at] as Uint8Array).subarray(offset);
  });

  const line = Effect.gen(function* () {
    let text = '';
    for (;;) {
      const bytes = yield* available;
      const end = bytes.indexOf(10);
      const size = end === -1 ? bytes.length : end;
      if (text.length + size > 128) {
        return yield* new GitEndingUnreadable({ command, reason: 'cat-file returned an oversized object header' });
      }
      text += decoder.decode(bytes.subarray(0, size));
      offset += size + (end === -1 ? 0 : 1);
      if (end !== -1) return text;
    }
  });

  const take = Effect.fnUntraced(function* (size: number, capture: number) {
    const kept = new Uint8Array(Math.min(size, capture));
    let seen = 0;
    while (seen < size) {
      const chunk = yield* available;
      const length = Math.min(chunk.length, size - seen);
      if (seen < kept.length) kept.set(chunk.subarray(0, Math.min(length, kept.length - seen)), seen);
      seen += length;
      offset += length;
    }
    return kept;
  });

  const read = Effect.fnUntraced(function* (oid: string, capture?: number): Effect.fn.Return<GitObject | null, ReadFailure> {
    const header = yield* line;
    if (header === `${oid} missing`) return null;
    const matched = HEADER.exec(header);
    const size = Number(matched?.[3]);
    if (matched === null || matched[1] !== oid || !Number.isSafeInteger(size) || size < 0) {
      return yield* new GitEndingUnreadable({ command, reason: `cat-file returned an invalid object header: ${header}` });
    }
    const body = yield* take(size, capture === undefined ? size : Math.max(0, capture));
    const delimiter = yield* take(1, 1);
    if (delimiter[0] !== 10) {
      return yield* new GitEndingUnreadable({ command, reason: 'cat-file returned an invalid object delimiter' });
    }
    return { type: matched[2] as string, size, bytes: body, overflow: capture !== undefined && size > capture };
  });

  return { read };
};

type ObjectReader = ReturnType<typeof makeObjectReader>;

type Running = {
  readonly scope: Scope.Closeable;
  readonly input: Queue.Queue<Uint8Array>;
  readonly reader: ObjectReader;
  readonly writer: Fiber.Fiber<void, PlatformError>;
  readonly process: ChildProcessSpawner.ChildProcessHandle;
};

type Session = { readonly lock: Semaphore.Semaphore; running?: Running; unsupported?: GitBatchUnsupported; store?: string };

export const makeObjectSessions = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Effect.scope;
  const sessions = new Map<string, Session>();
  const cache = new Map<string, GitObject>();
  const budget = Math.floor(totalmem() / 1024);
  let cachedBytes = 0;

  const read = Effect.fn('Git.objects')(
    function* (dir: string, oids: readonly string[], options?: GitOptions): Effect.fn.Return<readonly GitObjectAt[]> {
      yield* Effect.annotateCurrentSpan({ 'git.root': dir, 'git.objects': oids.length, 'git.objects.read': 0, 'git.blobs.read': 0 });
      if (oids.length === 0) return [];
      const env = Object.entries(options?.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
      const key = JSON.stringify([dir, options?.cwd, options?.extendEnv, env]);
      let session = sessions.get(key);
      if (session === undefined) {
        session = { lock: Semaphore.makeUnsafe(1) };
        sessions.set(key, session);
      }
      const held = session;
      const configured = {
        ...options,
        env: { ...options?.env, GIT_NO_REPLACE_OBJECTS: '1' },
        extendEnv: options?.env === undefined ? true : options.extendEnv,
      };
      const found = oids.map((oid) => (held.store === undefined ? undefined : cached(`${held.store}\0${oid}`, options?.capture)));
      const missing = oids.flatMap((oid, at) => (found[at] === undefined ? [oid] : []));
      if (missing.length === 0) return found.map((one) => Result.succeed(one!));
      const reads = yield* held.lock.withPermit(readIn(held, dir, missing, configured));
      let next = 0;
      return found.map((one) => (one === undefined ? reads[next++]! : Result.succeed(one)));
    },
    Effect.tap(() => Effect.annotateCurrentSpan({ 'git.cache.bytes': cachedBytes, 'git.cache.budget': budget })),
  );

  const readIn = Effect.fnUntraced(
    function* (session: Session, dir: string, oids: readonly string[], options?: GitOptions): Effect.fn.Return<readonly GitObjectAt[]> {
      const command = ['-C', dir, 'cat-file', '--batch'];
      const answers: GitObjectAt[] = [];
      if (session.store === undefined) {
        const store = yield* Effect.result(
          spawnGit(['-C', dir, 'rev-parse', '--path-format=absolute', '--git-path', 'objects'], {
            ...options,
            capture: undefined,
            stdin: undefined,
            stdoutBytes: false,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        );
        if (store._tag === 'Failure') return oids.map(() => Result.fail(store.failure));
        if (store.success.status !== 0 || store.success.stdout.trim() === '')
          return oids.map(() =>
            Result.fail(
              new GitEndingUnreadable({
                command,
                reason: store.success.stderr.trim() || 'git did not name its object store',
              }),
            ),
          );
        session.store = store.success.stdout.endsWith('\n') ? store.success.stdout.slice(0, -1) : store.success.stdout;
      }
      const pending: { oid: string; at: number }[] = [];
      for (const [at, oid] of oids.entries()) {
        if (!OID.test(oid)) {
          answers[at] = Result.fail(new GitEndingUnreadable({ command, reason: `${oid} is not a full object id` }));
          continue;
        }
        const object = cached(`${session.store}\0${oid}`, options?.capture);
        if (object !== undefined) answers[at] = Result.succeed(object);
        else pending.push({ oid, at });
      }
      let next = 0;
      let read = 0;
      let blobs = 0;
      while (next < pending.length) {
        const started = yield* Effect.result(
          session.unsupported === undefined ? running(session, command, options) : Effect.fail(session.unsupported),
        );
        if (started._tag === 'Failure') {
          yield* retire(session);
          for (; next < pending.length; next += 1) answers[pending[next]!.at] = Result.fail(started.failure);
          break;
        }
        const active = started.success;
        yield* Queue.offer(
          active.input,
          encoder.encode(
            pending
              .slice(next)
              .map((one) => `${one.oid}\n`)
              .join(''),
          ),
        );
        while (next < pending.length) {
          const one = pending[next++]!;
          read += 1;
          const answer = yield* Effect.result(receive(active, one.oid, options?.capture));
          answers[one.at] = answer;
          if (answer._tag === 'Failure') {
            yield* retire(session);
            break;
          }
          if (answer.success !== null) {
            if (answer.success.type === 'blob') blobs += 1;
            remember(`${session.store}\0${one.oid}`, answer.success);
          }
        }
      }
      yield* Effect.annotateCurrentSpan({ 'git.objects.read': read, 'git.blobs.read': blobs });
      return answers;
    },
    (effect, session) => Effect.onInterrupt(effect, () => retire(session)),
  );

  const cached = (key: string, capture: number | undefined): GitObject | undefined => {
    const object = cache.get(key);
    if (object === undefined || object.bytes.length < Math.min(object.size, capture ?? object.size)) return undefined;
    cache.delete(key);
    cache.set(key, object);
    return { ...object, bytes: object.bytes.slice(0, capture), overflow: capture !== undefined && object.size > capture };
  };

  const remember = (key: string, object: GitObject): void => {
    const size = object.bytes.length + key.length * 2;
    if (size > budget) return;
    const previous = cache.get(key);
    if (previous !== undefined && previous.bytes.length >= object.bytes.length) return;
    if (previous !== undefined) {
      cache.delete(key);
      cachedBytes -= previous.bytes.length + key.length * 2;
    }
    while (cachedBytes + size > budget) {
      const [oldKey, old] = cache.entries().next().value!;
      cache.delete(oldKey);
      cachedBytes -= old.bytes.length + oldKey.length * 2;
    }
    cache.set(key, { ...object, bytes: object.bytes.slice() });
    cachedBytes += size;
  };

  const retire = (session: Session): Effect.Effect<void> =>
    Effect.suspend(() => {
      const active = session.running;
      session.running = undefined;
      return active === undefined ? Effect.void : Scope.close(active.scope, Exit.void);
    });

  const ask = Effect.fnUntraced(function* (active: Running, oid: string, capture?: number) {
    yield* Queue.offer(active.input, encoder.encode(`${oid}\n`));
    return yield* receive(active, oid, capture);
  });

  const receive = (active: Running, oid: string, capture?: number): Effect.Effect<GitObject | null, ReadFailure> =>
    Effect.raceFirst(
      active.reader.read(oid, capture),
      Effect.flatMap(Fiber.join(active.writer), () =>
        Effect.fail(new GitEndingUnreadable({ command: ['cat-file', '--batch'], reason: 'cat-file input closed' })),
      ),
    );

  const running = Effect.fnUntraced(function* (session: Session, command: readonly string[], options?: GitOptions) {
    if (session.running !== undefined && (yield* session.running.process.isRunning)) return session.running;
    yield* retire(session);
    const active = yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const child = yield* Scope.fork(scope);
        const started = yield* Effect.exit(
          restore(
            Effect.gen(function* () {
              yield* Effect.makeSpanScoped('Git.objectSession', { attributes: { 'git.root': command[1] } });
              const process = yield* ChildProcess.make('git', command, {
                cwd: options?.cwd,
                env: options?.env,
                extendEnv: options?.extendEnv,
                stdin: 'pipe',
                forceKillAfter: '1 second',
              }).pipe(Effect.mapError((failure) => new GitUnavailable({ command, reason: failure.message })));
              const input = yield* Queue.unbounded<Uint8Array>();
              const writer = yield* Effect.forkScoped(Stream.run(Stream.fromQueue(input), process.stdin));
              yield* Effect.forkScoped(Stream.runDrain(process.stderr));
              const reader = makeObjectReader({ pull: yield* Stream.toPull(process.stdout), command });
              return { scope: child, process, input, writer, reader } satisfies Running;
            }).pipe(Scope.provide(child), Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
          ),
        );
        if (Exit.isFailure(started)) {
          yield* Scope.close(child, started);
          return yield* started;
        }
        session.running = started.value;
        return started.value;
      }),
    );
    const probed = yield* Effect.result(ask(active, '0'.repeat(40)));
    if (probed._tag === 'Failure') {
      const ended = yield* Effect.result(active.process.exitCode.pipe(Effect.timeoutOption('1 second')));
      if (ended._tag === 'Success' && ended.success._tag === 'Some' && ended.success.value === 129) {
        const failure = new GitBatchUnsupported({ command, reason: 'git refused the raw batch protocol probe' });
        session.unsupported = failure;
        yield* retire(session);
        return yield* failure;
      }
      yield* retire(session);
      return yield* Effect.fail(probed.failure);
    }
    return active;
  });

  return read;
});
