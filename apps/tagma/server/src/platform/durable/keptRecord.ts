import { dirname } from 'node:path';
import { Effect, FileSystem, Schema, Semaphore } from 'effect';

export const makeKeptRecord = Effect.fnUntraced(function* <A, I>(schema: Schema.Codec<A, I>, at: string, what: string) {
  const files = yield* FileSystem.FileSystem;
  const document = Schema.fromJsonString(schema, { space: 2 });
  const decode = Schema.decodeUnknownResult(document);
  const encode = Schema.encodeEffect(document);
  const aside = `${at}.unread`;
  const writing = yield* Semaphore.make(1);

  const read = Effect.gen(function* () {
    const text = yield* files.readFileString(at);
    const decoded = decode(text);
    if (decoded._tag === 'Success') return decoded.success;
    yield* files.rename(at, aside);
    yield* Effect.logWarning(`the ${what} did not read, so it was set aside at ${aside}: ${decoded.failure.message}`);
    return null;
  }).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)));

  const write = Effect.fnUntraced(
    function* (value: A) {
      const text = yield* Effect.orDie(encode(value));
      const passing = `${at}.${process.pid}`;
      yield* files.makeDirectory(dirname(at), { recursive: true });
      yield* files.writeFileString(passing, text, { mode: 0o600 });
      yield* files.rename(passing, at);
    },
    (effect) => writing.withPermit(effect),
  );

  return { read, write };
});
