import { describe, expect, test } from 'bun:test';
import { detect, RENAMES } from './effectNames.js';

describe('detect', () => {
  test('every row names its v3 spelling on a line that uses it', () => {
    const samples: Record<string, string> = {
      'Effect.fork': 'const fiber = yield* Effect.fork(work);',
      'Effect.catchAll': 'work.pipe(Effect.catchAll(() => Effect.void))',
      'Effect.either': 'const outcome = yield* Effect.either(work);',
      'Effect.merge': 'const outcome = yield* Effect.merge(work);',
      'Effect.zipRight': 'first.pipe(Effect.zipRight(second))',
      'Effect.tapErrorCause': 'work.pipe(Effect.tapErrorCause(log))',
      'Effect.timeoutFail': 'work.pipe(Effect.timeoutFail({ duration, onTimeout }))',
      'Effect.yieldNow()': 'yield* Effect.yieldNow();',
      'Effect.gen(this, …)': 'return Effect.gen(this, function* () {',
      'Fiber.poll': 'const exit = yield* Fiber.poll(fiber);',
      '.unsafeInterrupt()': 'fiber.unsafeInterrupt();',
      'Stream.runIntoSink': 'yield* Stream.runIntoSink(stream, sink);',
      'Stream.mapConcat': 'stream.pipe(Stream.mapConcat((row) => row.items))',
      'Stream.unwrapScoped': 'Stream.unwrapScoped(acquire)',
      'Schema.TaggedErrorClass': 'class Refused extends Schema.TaggedErrorClass<Refused>()("Refused", {}) {}',
      'Schema.optionalWith': 'field: Schema.optionalWith(Schema.String, { default: () => "" })',
      'Schema.Literal(a, b)': "kind: Schema.Literal('a', 'b'),",
      'Schema.Union(A, B)': 'const Shape = Schema.Union(A, B);',
      'Context.Tag': 'class Clock extends Context.Tag("Clock")<Clock, Shape>() {}',
      'Predicate.isRecord': 'if (Predicate.isRecord(value)) return value.code;',
      'Scope.CloseableScope': 'const scope: Scope.CloseableScope = yield* Scope.make();',
      'Duration.DurationInput': 'const wait = (input: Duration.DurationInput) => input;',
      'Duration.decode': 'const ms = Duration.toMillis(Duration.decode(input));',
      'Effect.Effect.Success': 'type Out = Effect.Effect.Success<typeof work>;',
      Mutex: "import { Mutex } from 'effect/Mutex';",
      'FileSystem.OpenFileOptions': 'const options: FileSystem.OpenFileOptions = { flag: "r" };',
      'ChildProcess.ChildProcess': 'const spawner = yield* ChildProcess.ChildProcess;',
      "catchTag('TimeoutException')": "work.pipe(Effect.catchTag('TimeoutException', () => Effect.void))",
      "import { Effect } from 'effect/Effect'": "import { Effect } from 'effect/Effect';",
      'Effect.makeSemaphore': 'const mutex = yield* Effect.makeSemaphore(1);',
      "from 'effect/unstable/…'": "import { HttpRouter } from 'effect/unstable/http';",
      Encoding: 'const id = Encoding.randomHex(16);',
      'FileSystem.Size': 'size: FileSystem.Size(4096),',
      'RpcSerialization.msgPack': 'Layer.provide(RpcSerialization.layerMsgPack)',
      'Schema.isLengthBetween': 'name: Schema.String.check(Schema.isLengthBetween(1, 64)),',
      'Flag.string': "const name = Flag.string('name');",
      'annotate({ parseOptions })': "}).annotate({ parseOptions: { onExcessProperty: 'error' } });",
      'socket.run': 'yield* socket.run((chunk) => handle(chunk));',
    };
    const uncovered = RENAMES.filter((row) => !(row.v3 in samples)).map((row) => row.v3);
    expect(uncovered).toEqual([]);
    for (const [v3, line] of Object.entries(samples)) {
      const found = detect('sample.ts', line).map((finding) => finding.v3);
      expect(found, line).toContain(v3);
    }
  });

  test('the v4 spellings, and lines that merely resemble a v3 name, are silent', () => {
    const clean = [
      'const fiber = yield* Effect.forkChild(work);',
      'const fiber = yield* Effect.forkScoped(work);',
      'work.pipe(Effect.catch(() => Effect.void))',
      'const outcome = yield* Effect.result(work);',
      'first.pipe(Effect.andThen(second))',
      'work.pipe(Effect.tapCause(log))',
      'work.pipe(Effect.timeoutOrElse({ duration, orElse }))',
      'yield* Effect.yieldNow;',
      'return Effect.gen({ self: this }, function* () {',
      'const value = yield* Fiber.join(fiber);',
      'const exit = yield* Fiber.await(fiber);',
      'yield* Deferred.await(settled);',
      'yield* latch.await;',
      'return Schema.Union(branches as unknown as KindBranch<C, F>[]);',
      'const Shape = Schema.Union([A, B], { mode: "oneOf" });',
      'yield* Fiber.interrupt(fiber);',
      'yield* Stream.run(stream, sink);',
      'Stream.unwrap(acquire)',
      'class Refused extends Schema.TaggedError<Refused>()("Refused", {}) {}',
      "kind: Schema.Literals(['a', 'b']),",
      "kind: Schema.Literal('a'),",
      'const Shape = Schema.Union([A, B]);',
      'const Shape = Schema.Union(',
      'class Clock extends Context.Service<Clock, Shape>()("Clock") {}',
      'if (Predicate.isObject(value)) return value.code;',
      'const scope: Scope.Closeable = yield* Scope.make();',
      'const wait = (input: Duration.Input) => input;',
      'type Out = Effect.Success<typeof work>;',
      "import { Effect, Layer } from 'effect';",
      "import * as Effect from 'effect/Effect';",
      "import type { PlatformError } from 'effect/PlatformError';",
      "import { ChildProcess, ChildProcessSpawner } from 'effect/process';",
      'const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;',
      "work.pipe(Effect.catchTag('TimeoutError', () => Effect.void))",
      'await runtime.dispose();',
      'const mutex = yield* Semaphore.make(1);',
      "import { HttpApiBuilder } from 'effect/http-api';",
      "import * as Hex from 'effect/encoding/Hex';",
      'export type MouseEncoding = typeof MouseEncoding.Type;',
      'size: ByteSize.bytes(4096),',
      'Layer.provide(RpcSerialization.layerJson)',
      'name: Schema.String.check(Schema.isBetweenLength(1, 64)),',
      "const name = Flag.String('name');",
      'const decoded = decode(input, { onExcessProperty: "error" });',
      'const pull = yield* Socket.readerBytes(socket);',
    ];
    for (const line of clean) expect(detect('sample.ts', line), line).toEqual([]);
  });

  test('a finding carries the path, the one-based line and the v4 spelling', () => {
    const text = "import { Effect } from 'effect';\n\nconst fiber = yield* Effect.fork(work);\n";
    const fork = RENAMES.find((row) => row.v3 === 'Effect.fork');
    expect(fork).toBeDefined();
    expect(detect('src/work.ts', text)).toEqual([{ path: 'src/work.ts', line: 3, v3: 'Effect.fork', v4: fork?.v4 ?? '' }]);
  });
});
