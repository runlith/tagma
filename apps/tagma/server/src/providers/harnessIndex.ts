import { join } from 'node:path';
import { Data, Effect, FileSystem, Schema } from 'effect';
import type { Loaded } from './adapters/judge.js';

const HARNESS_INDEX = 'provider-harnesses.json';

const Entry = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  harnesses: Schema.Array(Schema.String),
});
type HarnessPackage = typeof Entry.Type;
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Entry)));

class IndexUnreadable extends Data.TaggedError('IndexUnreadable')<{ readonly path: string; readonly reason: string }> {
  override get message(): string {
    return `${this.path} could not be read: ${this.reason}`;
  }
}

export const indexHarnesses = Effect.fn('providers.indexHarnesses')(function* (data: string, loaded: readonly Loaded[]) {
  const files = yield* FileSystem.FileSystem;
  const rows = loaded.flatMap(({ state, providers, directory }): HarnessPackage[] => {
    if (state.origin !== 'plugin' || state.state !== 'loaded' || directory === undefined) return [];
    const harnesses = providers.flatMap((provider) =>
      provider.kind === 'harness' && (provider.terminal !== undefined || provider.acp !== undefined) ? [provider.id] : [],
    );
    return harnesses.length === 0 ? [] : [{ id: state.id, directory, harnesses }];
  });
  const path = join(data, HARNESS_INDEX);
  if (rows.length === 0) return yield* files.remove(path, { force: true });
  const staged = `${path}.${process.pid}.tmp`;
  yield* files.makeDirectory(data, { recursive: true });
  yield* files.writeFileString(staged, JSON.stringify(rows));
  yield* files.rename(staged, path);
});

export const harnessPackages = Effect.fn('providers.harnessPackages')(function* (data: string) {
  const files = yield* FileSystem.FileSystem;
  const path = join(data, HARNESS_INDEX);
  const index = yield* files.readFileString(path).pipe(
    Effect.flatMap(decode),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([])),
    Effect.mapError((cause) => new IndexUnreadable({ path, reason: cause.message })),
  );
  const standing: HarnessPackage[] = [];
  for (const entry of index) {
    const stands = yield* files
      .exists(entry.directory)
      .pipe(Effect.mapError((cause) => new IndexUnreadable({ path, reason: cause.message })));
    if (stands) standing.push(entry);
  }
  return standing;
});

export const harnessPackage = (data: string, harness: string) =>
  Effect.map(harnessPackages(data), (packages) => packages.find((entry) => entry.harnesses.includes(harness)) ?? null);
