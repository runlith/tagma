import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Data, Effect, Schema } from 'effect';

export const RECORD_FILE = 'installed.json';

export const AdapterInstall = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  source: Schema.String.check(Schema.isMinLength(1)),
  version: Schema.String,
  directory: Schema.String.check(Schema.isMinLength(1)),
  enabled: Schema.Boolean,
});
export type AdapterInstall = typeof AdapterInstall.Type;

const Installs = Schema.Array(AdapterInstall);
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Installs));

export class RecordUnreadable extends Data.TaggedError('RecordUnreadable')<{ readonly path: string; readonly reason: string }> {}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const missing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { readonly code: unknown }).code === 'ENOENT';

export const readInstalls = (machine: string): Effect.Effect<readonly AdapterInstall[], RecordUnreadable> => {
  const path = join(machine, RECORD_FILE);
  return Effect.tryPromise({
    try: () => readFile(path, 'utf8').then((text) => text, (error) => (missing(error) ? null : Promise.reject(error))),
    catch: (error) => new RecordUnreadable({ path, reason: reasonOf(error) }),
  }).pipe(
    Effect.flatMap((text) =>
      text === null ? Effect.succeed([]) : decode(text).pipe(Effect.mapError((error) => new RecordUnreadable({ path, reason: error.message }))),
    ),
  );
};

export const writeInstalls = (machine: string, installs: readonly AdapterInstall[]): Effect.Effect<void, RecordUnreadable> => {
  const path = join(machine, RECORD_FILE);
  const staged = `${path}.${process.pid}.tmp`;
  return Effect.tryPromise({
    try: async () => {
      await mkdir(machine, { recursive: true });
      await writeFile(staged, `${JSON.stringify(installs, null, 2)}\n`);
      await rename(staged, path);
    },
    catch: (error) => new RecordUnreadable({ path, reason: reasonOf(error) }),
  });
};
