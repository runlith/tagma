import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { RegistryPart, RegistryRestore, RegistryRow } from '../../platform/contract/service/machineRegistry.js';
import { dataPathOf, MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { RegistryIncoherent, RegistryUnreadable } from '../contract/wire/registry.js';

export function registryPathFor(storePath: string): string | null {
  const data = dataPathOf(storePath);
  return data === null ? null : join(data, 'registry.json');
}

const decodeSections = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

let dumps = 0;

const joined = (standing: readonly RegistryRow[], rows: readonly RegistryRow[]): readonly RegistryRow[] => {
  const byId = new Map(rows.map((row) => [row['id'], row]));
  return standing.map((row) => ({ ...row, ...byId.get(row['id']) }));
};

export const dumpMachineRegistry = Effect.fn('registry.dump')(function* (
  parts: readonly RegistryPart[],
): Effect.fn.Return<void, StoreFailure | RegistryIncoherent, MachineStore | MachineUnits> {
  const { db, path: storePath } = yield* MachineStore;
  const path = registryPathFor(storePath);
  if (path === null) return;
  const sections = yield* (yield* MachineUnits).read(
    (unit) =>
      Effect.gen(function* () {
        const read = new Map<string, readonly RegistryRow[]>();
        for (const part of parts) {
          const rows = yield* part.dump(unit, db);
          const standing = read.get(part.section);
          read.set(part.section, standing === undefined ? rows : joined(standing, rows));
        }
        return read;
      }),
    { snapshot: true },
  );
  for (const part of parts) {
    yield* part
      .read(sections.get(part.section))
      .pipe(Effect.mapError((failure) => new RegistryIncoherent({ path, reason: `${part.section}: ${failure.message}` })));
  }
  const text = `${JSON.stringify(Object.fromEntries(sections), null, 2)}\n`;
  yield* Effect.sync(() => {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
    mkdirSync(dirname(path), { recursive: true });
    const partial = `${path}.${process.pid}.${dumps++}.partial`;
    writeFileSync(partial, text);
    renameSync(partial, path);
  });
});

export const readRegistry = Effect.fnUntraced(function* (
  parts: readonly RegistryPart[],
  path: string,
): Effect.fn.Return<readonly RegistryRestore[], RegistryUnreadable> {
  const text = yield* Effect.try({
    try: () => readFileSync(path, 'utf8'),
    catch: (error) => new RegistryUnreadable({ path, reason: error instanceof Error ? error.message : String(error) }),
  });
  const parsed = decodeSections(text);
  if (parsed._tag === 'Failure') return yield* new RegistryUnreadable({ path, reason: parsed.failure.message });
  const sections = parsed.success;
  return yield* Effect.forEach(parts, (part) => {
    const rows = Object.hasOwn(sections, part.section) ? sections[part.section] : undefined;
    return part
      .read(rows === undefined && part.optional === true ? [] : rows)
      .pipe(Effect.mapError((failure) => new RegistryUnreadable({ path, reason: `${part.section}: ${failure.message}` })));
  });
});
