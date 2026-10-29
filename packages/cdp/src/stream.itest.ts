import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, FileSystem, Queue, Stream } from 'effect';
import { connect, type Session } from './session.js';
import { heapToFile } from './stream.js';

it.live('a heap snapshot drains every queued chunk through the payload writer before returning', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const dir = yield* files.makeTempDirectoryScoped();
    const file = `${dir}/page.heapsnapshot`;
    const incoming = yield* Queue.unbounded<string>();
    const chunks = ['{"strings":["', 'a'.repeat(160_000), '\\nUnicode: \\u0416 and \\"quote\\"', '"]}'];
    const connection = yield* connect({
      incoming: Stream.fromQueue(incoming),
      send: Effect.fnUntraced(function* (text) {
        const command = JSON.parse(text) as { readonly id: number };
        for (const chunk of chunks)
          yield* Queue.offer(incoming, JSON.stringify({ method: 'HeapProfiler.addHeapSnapshotChunk', params: { chunk } }));
        yield* Queue.offer(incoming, JSON.stringify({ id: command.id, result: {} }));
      }),
    });
    yield* heapToFile(connection.root, file);
    expect(yield* files.readFileString(file)).toBe(chunks.join(''));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a failed heap chunk waits for the renderer command before returning its failure', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const dir = yield* files.makeTempDirectoryScoped();
    const incoming = yield* Queue.unbounded<string>();
    const release = yield* Deferred.make<void>();
    const writerSettled = yield* Deferred.make<void>();
    const returned = yield* Deferred.make<void>();
    const connection = yield* connect({
      incoming: Stream.fromQueue(incoming),
      send: Effect.fnUntraced(function* (text) {
        const command = JSON.parse(text) as { readonly id: number };
        yield* Queue.offer(incoming, JSON.stringify({ method: 'HeapProfiler.addHeapSnapshotChunk', params: { chunk: 1 } }));
        yield* Deferred.await(release);
        yield* Queue.offer(incoming, JSON.stringify({ id: command.id, result: {} }));
      }),
    });
    const session: Session = {
      ...connection.root,
      events: (wanted) =>
        Effect.map(connection.root.events(wanted), (stream) => stream.pipe(Stream.ensuring(Deferred.succeed(writerSettled, undefined)))),
    };
    const capturing = yield* Effect.forkChild(
      Effect.result(heapToFile(session, `${dir}/page.heapsnapshot`)).pipe(Effect.tap(() => Deferred.succeed(returned, undefined))),
    );
    yield* Deferred.await(writerSettled);
    yield* Effect.yieldNow;
    expect(Deferred.isDoneUnsafe(returned)).toBe(false);
    yield* Deferred.succeed(release, undefined);
    expect(yield* Fiber.join(capturing)).toMatchObject({ _tag: 'Failure', failure: { _tag: 'PayloadUnreadable' } });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
