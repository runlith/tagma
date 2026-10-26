import { Effect } from 'effect';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { MachineStore } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { ProjectPlace } from './contract/wire/project.js';
import { project } from './store/table.js';

export const registration = {
  id: project.id,
  name: project.name,
  repoKey: project.repoKey,
  rootPath: project.rootPath,
  createdAt: project.createdAt,
  global: project.global,
};

const holding = { ...registration, removedAt: project.removedAt };

const standing = isNull(project.removedAt);

export const holderOfName = (store: MachineStore['Service'], unit: Unit<'machine'>, name: string) =>
  unit.run(store.db.select(holding).from(project).where(eq(project.name, name)).get());

export const holderOfRepository = (store: MachineStore['Service'], unit: Unit<'machine'>, repoKey: string) =>
  unit.run(store.db.select(holding).from(project).where(eq(project.repoKey, repoKey)).get());

export type Canonical = (rootPath: string) => Effect.Effect<string>;

export const holderOfRoot = Effect.fn('Projects.holderOfRoot')(function* (
  store: MachineStore['Service'],
  unit: Unit<'machine'>,
  rootPath: string,
  canonical: Canonical,
) {
  const rows = yield* unit.run(store.db.select(holding).from(project));
  const held = [];
  for (const row of rows) if (row.rootPath === rootPath || (yield* canonical(row.rootPath)) === rootPath) held.push(row);
  return held.find((row) => row.removedAt === null) ?? held[0];
});

export function sameOrInside(path: string, root: string): boolean {
  const a = path.replace(/\/+$/, '');
  const b = root.replace(/\/+$/, '');
  return a === b || a.startsWith(`${b}/`);
}

export const list = (store: MachineStore['Service'], unit: Unit<'machine'>) =>
  unit.run(store.db.select(registration).from(project).where(standing).orderBy(desc(project.global), asc(project.name)));

export const removedIds = (store: MachineStore['Service'], unit: Unit<'machine'>) =>
  Effect.map(unit.run(store.db.select({ id: project.id }).from(project).where(isNotNull(project.removedAt))), (rows) =>
    rows.map((row) => row.id),
  );

export const globalProject = (store: MachineStore['Service'], unit: Unit<'machine'>) =>
  unit.run(store.db.select(registration).from(project).where(eq(project.global, true)).get());

export const byId = Effect.fn('Projects.byId')(function* (store: MachineStore['Service'], unit: Unit<'machine'>, id: number) {
  const row = yield* unit.run(
    store.db
      .select(registration)
      .from(project)
      .where(and(eq(project.id, id), standing))
      .get(),
  );
  if (row === undefined) {
    return yield* new GateRefusal('not-found', `project ${id} does not exist`, ['the registry names the registered roots and their ids']);
  }
  return row;
});

export const named = Effect.fn('Projects.named')(function* (store: MachineStore['Service'], unit: Unit<'machine'>, ref: string) {
  if (/^\d+$/.test(ref)) return yield* byId(store, unit, Number(ref));
  const row = yield* unit.run(
    store.db
      .select(registration)
      .from(project)
      .where(and(eq(project.name, ref), standing))
      .get(),
  );
  if (row !== undefined) return row;
  const known = (yield* list(store, unit)).map((registered) => `${registered.name} (${registered.id})`).join(', ');
  return yield* new GateRefusal('unknown-project', `no unique project named "${ref}"; registered: ${known || 'none'}`, [
    'the registry names what is registered',
  ]);
});

export const ownerByKey = (store: MachineStore['Service'], unit: Unit<'machine'>, repoKey: string) =>
  unit.run(
    store.db
      .select(registration)
      .from(project)
      .where(and(eq(project.repoKey, repoKey), standing))
      .get(),
  );

export const ownerByPlace = Effect.fn('Projects.ownerByPlace')(function* (
  store: MachineStore['Service'],
  unit: Unit<'machine'>,
  here: ProjectPlace,
  canonical: Canonical,
) {
  const { rootPath, gitDir } = here.identity;
  const all = yield* list(store, unit);
  let best: (typeof all)[number] | undefined;
  for (const row of all) {
    if (!sameOrInside(here.cwd, row.rootPath)) {
      const root = yield* canonical(row.rootPath);
      if (!(gitDir === null ? sameOrInside(rootPath, root) : rootPath === root)) continue;
    }
    if (best === undefined || row.rootPath.length > best.rootPath.length) best = row;
  }
  return best;
});
