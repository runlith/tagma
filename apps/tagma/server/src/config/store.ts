import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import type { Git } from '@runlith/git/Git';
import { storeAt } from '@runlith/git/repository';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { actingGit, readingFailed } from '../platform/git/ownGit.js';
import { Place } from './protocol.js';

export const Outcome = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('evaluated'), value: Schema.Unknown }),
  Schema.Struct({ _tag: Schema.Literal('refused'), ...Place.fields }),
]);
export type Outcome = typeof Outcome.Type;

export const Entry = Schema.Struct({
  profile: Schema.String,
  loaded: Schema.Record(Schema.String, Schema.String),
  missed: Schema.Array(Schema.String),
  outcome: Outcome,
});
export type Entry = typeof Entry.Type;

const Stored = Schema.fromJsonString(Schema.Struct({ entries: Schema.Array(Entry) }));

const KEPT = 16;

const sameRead = (a: Entry, b: Entry): boolean =>
  a.profile === b.profile &&
  a.missed.join('\0') === b.missed.join('\0') &&
  Object.keys(a.loaded).length === Object.keys(b.loaded).length &&
  Object.entries(a.loaded).every(([path, blob]) => b.loaded[path] === blob);

export const storeFileIn = (commonDir: string): string => join(commonDir, 'tagma', 'config.json');

export const storeFile = Effect.fn('Configs.storeFile')(function* (git: Git['Service'], root: string) {
  const store = yield* storeAt(actingGit(git, 'config-store'), root).pipe(
    Effect.mapError((failure) => readingFailed('config-store', failure)),
  );
  return storeFileIn(store.commonDir);
});

export const storedEntries = Effect.fn('Configs.stored')(function* (file: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files.readFileString(file).pipe(
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    Effect.mapError(
      (failure) =>
        new GateRefusal(
          'config-unstored',
          `the evaluated tagma.config.ts of this repository could not be read from ${file}: ${failure.message}`,
          [`make ${file} readable to Tagma, or remove it so the next read evaluates the config again`],
        ),
    ),
  );
  if (text === null) return [];
  return yield* Schema.decodeUnknownEffect(Stored)(text).pipe(
    Effect.map((stored) => stored.entries),
    Effect.catchTag('SchemaError', () => Effect.succeed([])),
  );
});

export const keptEntry = Effect.fn('Configs.keep')(function* (file: string, entry: Entry) {
  const files = yield* FileSystem.FileSystem;
  const standing = yield* storedEntries(file);
  const entries = [entry, ...standing.filter((one) => !sameRead(one, entry))].slice(0, KEPT);
  const written = `${file}.${crypto.randomUUID()}`;
  yield* files.makeDirectory(join(file, '..'), { recursive: true }).pipe(
    Effect.andThen(files.writeFileString(written, `${JSON.stringify({ entries })}\n`)),
    Effect.andThen(files.rename(written, file)),
    Effect.mapError(
      (failure) =>
        new GateRefusal('config-unstored', `the evaluated tagma.config.ts could not be kept in ${file}: ${failure.message}`, [
          `make the directory of ${file} writable to Tagma`,
        ]),
    ),
  );
});
