import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import { RegistryFile, RegistryUnreadable } from '../contract/wire/registry.js';
import { dataPathOf, MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { setting } from '../../settings/store/table.js';
import { projectsWithPolicy } from '../../graph/store/policy.js';
import { groupMember } from '../../projects/store/table.js';

export function registryPathFor(storePath: string): string | null {
  const data = dataPathOf(storePath);
  return data === null ? null : join(data, 'registry.json');
}

const decodeRegistry = Schema.decodeUnknownResult(Schema.fromJsonString(RegistryFile));

const DATE_FIELDS = ['createdAt', 'updatedAt', 'removedAt'] as const;

let dumps = 0;

function frozen(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const field of DATE_FIELDS) {
    if (out[field] instanceof Date) out[field] = (out[field] as Date).toISOString();
  }
  return out;
}

export const dumpMachineRegistry = Effect.fn('registry.dump')(function* (): Effect.fn.Return<void, StoreFailure, MachineStore> {
  const { db, path: storePath } = yield* MachineStore;
  const path = registryPathFor(storePath);
  if (path === null) return;
  const projects = yield* projectsWithPolicy(db);
  const members = yield* db.select().from(groupMember);
  const settings = yield* db.select().from(setting);
  const text = `${JSON.stringify(
    {
      projects: projects.map((row) => frozen(row)),
      members,
      settings: settings.map((row) => frozen(row)),
    },
    null,
    2,
  )}\n`;
  yield* Effect.sync(() => {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
    mkdirSync(dirname(path), { recursive: true });
    const partial = `${path}.${process.pid}.${dumps++}.partial`;
    writeFileSync(partial, text);
    renameSync(partial, path);
  });
});

export const readRegistry = Effect.fnUntraced(function* (path: string): Effect.fn.Return<RegistryFile, RegistryUnreadable> {
  const text = yield* Effect.try({
    try: () => readFileSync(path, 'utf8'),
    catch: (error) => new RegistryUnreadable({ path, reason: error instanceof Error ? error.message : String(error) }),
  });
  const parsed = decodeRegistry(text);
  if (parsed._tag === 'Failure') return yield* new RegistryUnreadable({ path, reason: parsed.failure.message });
  return parsed.success;
});
