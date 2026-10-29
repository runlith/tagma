import { Effect, FileSystem } from 'effect';
import { chunkOf } from './payload.js';
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
