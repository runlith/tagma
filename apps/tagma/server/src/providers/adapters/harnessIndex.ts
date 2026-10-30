import { Effect, FileSystem, Schema } from 'effect';
import { join } from 'node:path';
import type { Loaded } from './judge.js';
import { readInstalls, RecordUnreadable } from './record.js';

export const HARNESS_INDEX_FILE = 'harnesses.json';

const Entry = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  harnesses: Schema.Array(Schema.String),
});
export type HarnessPackage = typeof Entry.Type;
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Entry)));

export const indexHarnesses = Effect.fn('MachineAdapters.indexHarnesses')(function* (machine: string, loaded: readonly Loaded[]) {
  const files = yield* FileSystem.FileSystem;
  const installed = yield* readInstalls(machine);
  const byId = new Map(loaded.filter((row) => row.state.origin === 'machine').map((row) => [row.state.id, row]));
  const rows = installed.flatMap((install) => {
    const declared = byId.get(install.id);
    if (!install.enabled || declared?.state.state !== 'loaded') return [];
    const harnesses = declared.providers.flatMap((provider) =>
      provider.kind === 'harness' && (provider.terminal !== undefined || provider.acp !== undefined) ? [provider.id] : [],
    );
    return harnesses.length === 0 ? [] : [{ id: install.id, directory: install.directory, harnesses }];
  });
  const path = join(machine, HARNESS_INDEX_FILE);
  if (rows.length === 0) return yield* files.remove(path, { force: true });
  const staged = `${path}.${process.pid}.tmp`;
  yield* files.makeDirectory(machine, { recursive: true });
  yield* files.writeFileString(staged, JSON.stringify(rows));
  yield* files.rename(staged, path);
});

export const harnessPackages = Effect.fn('MachineAdapters.harnessPackages')(function* (machine: string) {
  const files = yield* FileSystem.FileSystem;
  const path = join(machine, HARNESS_INDEX_FILE);
  const index = yield* files.readFileString(path).pipe(
    Effect.flatMap(decode),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([])),
    Effect.mapError((cause) => new RecordUnreadable({ path, reason: cause.message })),
  );
  const installed = new Map((yield* readInstalls(machine)).map((entry) => [entry.id, entry]));
  return index.flatMap((entry): HarnessPackage[] => {
    const current = installed.get(entry.id);
    return current?.enabled === true && current.directory === entry.directory
      ? [{ ...entry, directory: join(machine, entry.directory) }]
      : [];
  });
});

export const harnessPackage = (machine: string, harness: string) =>
  Effect.map(harnessPackages(machine), (packages) => packages.find((entry) => entry.harnesses.includes(harness)) ?? null);
