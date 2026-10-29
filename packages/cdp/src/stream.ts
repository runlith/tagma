import { Effect, Exit, Fiber, FileSystem, Scope, Stream } from 'effect';
import { appendHeapChunk, chunkOf } from './payload.js';
import type { Session } from './session.js';

export const streamToFile = Effect.fnUntraced(function* (session: Session, handle: string, file: string, size: number) {
  const files = yield* FileSystem.FileSystem;
  yield* Effect.addFinalizer(() =>
    session.send('IO.close', { handle }).pipe(
      Effect.catchTags({
        SessionEnded: () => Effect.void,
        CommandRefused: (refused) => Effect.logDebug(`cdp: stream ${handle} was not closed: ${refused.message}`),
        PayloadUnreadable: (unreadable) => Effect.logDebug(`cdp: stream ${handle} closed unreadably: ${unreadable.message}`),
        WorkerUnavailable: (gone) => Effect.logDebug(`cdp: stream ${handle} close was not read: ${gone.message}`),
      }),
    ),
  );
  const out = yield* files.open(file, { flag: 'w' });
  let bytes = 0;
  for (;;) {
    const chunk = yield* Effect.flatMap(session.reply('IO.read', { handle, size }), chunkOf);
    if (chunk.bytes.byteLength > 0) yield* out.writeAll(chunk.bytes);
    bytes += chunk.bytes.byteLength;
    if (chunk.eof) return bytes;
  }
}, Effect.scoped);

export const heapToFile = Effect.fn('cdp.heapToFile')(
  function* (session: Session, file: string) {
    const files = yield* FileSystem.FileSystem;
    yield* files.writeFile(file, new Uint8Array());
    const listening = yield* Scope.fork(yield* Effect.scope);
    const events = yield* Scope.provide(
      session.events((method) => method === 'HeapProfiler.addHeapSnapshotChunk'),
      listening,
    );
    const writing = yield* Stream.runForEach(events, (event) =>
      event.child === undefined ? appendHeapChunk(event.text, file) : Effect.void,
    ).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(listening, Exit.void) : Effect.void)),
      Effect.forkScoped,
    );
    const captured = yield* Effect.exit(session.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }));
    yield* Scope.close(listening, Exit.void);
    const written = yield* Effect.exit(Fiber.join(writing));
    if (Exit.isFailure(captured)) return yield* Effect.failCause(captured.cause);
    if (Exit.isFailure(written)) return yield* Effect.failCause(written.cause);
  },
  Effect.uninterruptible,
  Effect.scoped,
);
