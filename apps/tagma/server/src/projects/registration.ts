import { Clock, Cause, Context, Effect, Exit, FileSystem, Layer, Ref } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { MachineStore, storeDirectory } from '../platform/contract/service/store.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { MachineUnits, type Unit } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import { gitRefusal } from '../platform/git/readings.js';
import { unitsLayer } from '../platform/store/units.js';
import { Projects } from './contract/service/registry.js';
import { keyHolds, markIn, marked, physical } from './identity.js';
import { ReservedNames } from './contract/service/names.js';
import { ProjectChanges, type ProjectRemoved } from './contract/service/changes.js';
import { GLOBAL_PROJECT, type ProjectIdentity, type ProjectRootFailure, type ProjectRow } from './contract/wire/project.js';
import { PROJECT_WORDS } from './contract/wire/words.js';
import {
  byId,
  globalProject,
  holderOfName,
  holderOfRepository,
  holderOfRoot,
  type Canonical,
  list,
  named,
  ownerByKey,
  ownerByPlace,
  registration,
  removedIds,
} from './resolution.js';
import { project } from './store/table.js';

export const rootChecked = Effect.fn('Projects.rootChecked')(function* (
  rootPath: string,
): Effect.fn.Return<void, GateRefusal<ProjectRootFailure>> {
  if (!isAbsolute(rootPath)) {
    return yield* new GateRefusal('relative-root', `root "${rootPath}" is not an absolute path`, [
      'name the root as an absolute path',
    ]).saying(PROJECT_WORDS.folderMissing);
  }
  const directory = yield* Effect.promise(() =>
    stat(rootPath).then(
      (info) => info.isDirectory(),
      () => false,
    ),
  );
  if (!directory) {
    return yield* new GateRefusal('missing-root', `root "${rootPath}" is not an existing directory`, [
      'name a directory that exists',
    ]).saying(PROJECT_WORDS.folderMissing);
  }
});

type Holder = ProjectRow & { readonly removedAt: Date | null };

const gitDirAt = (rootPath: string): string => join(rootPath, '.git');

const markedRoots = Effect.fn('Projects.markRoots')(function* (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  files: FileSystem.FileSystem,
) {
  const rows = yield* units.read((unit) =>
    unit.run(
      store.db
        .select({ id: project.id, repoKey: project.repoKey, rootPath: project.rootPath })
        .from(project)
        .where(and(isNull(project.removedAt), eq(project.global, false))),
    ),
  );
  const unmarked: { readonly id: number; readonly gitDir: string; readonly repoKey: string; readonly rekeyed: boolean }[] = [];
  for (const row of rows) {
    const repository = yield* Effect.promise(() =>
      stat(gitDirAt(row.rootPath)).then(
        (info) => info.isDirectory(),
        () => false,
      ),
    );
    if (!repository) continue;
    const gitDir = yield* physical(files, gitDirAt(row.rootPath)).pipe(
      Effect.flatMap((at) => Effect.map(markIn(at), (held) => (held === null ? at : null))),
      Effect.catchTags({
        PlatformError: (failure) => unread(row.id, failure.message),
        GitUnreadable: (failure) => unread(row.id, failure.reason),
      }),
    );
    if (gitDir === null) continue;
    const rekeyed = isAbsolute(row.repoKey);
    unmarked.push({ id: row.id, gitDir, repoKey: rekeyed ? randomUUID() : row.repoKey, rekeyed });
  }
  const rekeyed = unmarked.filter((row) => row.rekeyed);
  if (rekeyed.length > 0)
    yield* store.transaction(writes('project.marks', [project]), (unit) =>
      Effect.forEach(rekeyed, (row) => unit.run(store.db.update(project).set({ repoKey: row.repoKey }).where(eq(project.id, row.id))), {
        discard: true,
      }),
    );
  for (const row of unmarked) {
    yield* marked(row.gitDir, row.repoKey).pipe(
      Effect.catchTag('GateRefusal', (failure) =>
        Effect.logWarning('a project root keeps no mark: its git directory could not be written', {
          project: row.id,
          reason: failure.reason,
        }),
      ),
    );
  }
});

const unread = (project: number, reason: string) =>
  Effect.as(Effect.logWarning('a project root keeps no mark: its git directory could not be read', { project, reason }), null);

const placeOf = Effect.fn('Projects.placeOf')(function* (
  store: MachineStore['Service'],
  unit: Unit<'machine'>,
  identity: ProjectIdentity,
  canonical: Canonical,
) {
  const keyed = identity.repoKey === null ? undefined : yield* holderOfRepository(store, unit, identity.repoKey);
  if (keyed !== undefined && (yield* Effect.mapError(keyHolds(keyed, identity), gitRefusal)))
    return { holder: keyed, own: identity.repoKey, moved: keyed.rootPath !== identity.rootPath };
  return {
    holder: yield* holderOfRoot(store, unit, identity.rootPath, canonical),
    own: keyed === undefined ? identity.repoKey : null,
    moved: false,
  };
});

const keyOf = (identity: ProjectIdentity, own: string | null, holder?: ProjectRow): string => {
  if (identity.gitDir === null) return identity.rootPath;
  if (holder !== undefined && !isAbsolute(holder.repoKey)) return holder.repoKey;
  return own ?? randomUUID();
};

const markedAt = (identity: ProjectIdentity, repoKey: string) =>
  identity.gitDir === null ? Effect.void : marked(identity.gitDir, repoKey);

const identityFree = (existing: Holder | undefined, exceptId?: number) => {
  if (existing === undefined || existing.id === exceptId) return Effect.void;
  if (existing.removedAt !== null) {
    return new GateRefusal('duplicate-root', `this folder is project "${existing.name}", removed from Tagma`, [
      `add_project with this root — "${existing.name}" comes back with its graph and threads`,
    ]).saying(PROJECT_WORDS.folderTaken(existing.name));
  }
  return new GateRefusal('duplicate-root', `this folder belongs to project "${existing.name}"`, [
    `a subfolder or worktree of ${existing.rootPath} is read in "${existing.name}": scope reads with \`scopeId\` instead of registering it`,
    'a separate clone or copy of the repository registers as a project of its own',
  ]).saying(PROJECT_WORDS.folderTaken(existing.name));
};

const nameChecked = Effect.fn('Projects.nameChecked')(function* (
  store: MachineStore['Service'],
  unit: Unit<'machine'>,
  reserved: ReadonlySet<string>,
  name: string,
  exceptId?: number,
) {
  if (name === GLOBAL_PROJECT.name) {
    return yield* new GateRefusal('reserved-project', `"${GLOBAL_PROJECT.name}" is the cross-project graph, which always exists`, [
      'name this project something else',
      `name project ${GLOBAL_PROJECT.name} in a read to reach the graph that already holds that name`,
    ]).saying(PROJECT_WORDS.nameRefused(name));
  }
  if (reserved.has(name.toLowerCase())) {
    return yield* new GateRefusal('reserved-project', `"${name}" names a server route, so it cannot name a project`, [
      'choose another project name',
    ]).saying(PROJECT_WORDS.nameRefused(name));
  }
  if (name.trim() === '' || /[/\\]/.test(name) || name.includes('..')) {
    return yield* new GateRefusal('project-name', `"${name}" cannot name a project: the name becomes the first segment of its address`, [
      'choose a name without path separators or ..',
    ]).saying(PROJECT_WORDS.nameRefused(name));
  }
  const taken = yield* holderOfName(store, unit, name);
  if (taken !== undefined && taken.id !== exceptId) {
    return yield* new GateRefusal('duplicate-name', `a project named "${name}" is already registered`, [
      'the registry names what is registered',
      'choose another name',
    ]).saying(PROJECT_WORDS.nameTaken(name));
  }
});

const refuseUnmaking = (row: ProjectRow, what: string) =>
  row.global
    ? new GateRefusal('global-permanent', `"${row.name}" is the cross-project graph: it cannot be ${what}`, [
        'delete or disable its rules — that is what stops law from travelling',
      ])
    : Effect.void;

export const projectsLayer = Layer.effectContext(
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    const reserved = yield* ReservedNames;
    const { db } = store;
    const version = yield* Ref.make(0);
    const removals = new Set<(event: ProjectRemoved) => Effect.Effect<void>>();
    const changes = new Set<Effect.Effect<void>>();
    const subscribe = <A>(set: Set<A>, item: A) => {
      set.add(item);
      return () => {
        set.delete(item);
      };
    };
    const publish = Effect.fnUntraced(function* <A>(subscribers: Set<A>, notify: (subscriber: A) => Effect.Effect<void>) {
      let failures: Cause.Cause<never> = Cause.empty;
      for (const subscriber of [...subscribers]) {
        const exit = yield* Effect.exit(Effect.suspend(() => notify(subscriber)));
        if (Exit.isFailure(exit)) failures = Cause.combine(failures, exit.cause);
      }
      if (failures.reasons.length > 0) return yield* Effect.failCause(failures);
    }, Effect.uninterruptible);
    const events = ProjectChanges.of({
      removed: {
        publish: (event) => publish(removals, (subscriber) => subscriber(event)),
        subscribe: (subscriber) => subscribe(removals, subscriber),
      },
      changed: {
        publish: () =>
          Effect.andThen(
            Ref.update(version, (current) => current + 1),
            publish(changes, (subscriber) => subscriber),
          ),
        subscribe: (subscriber) => subscribe(changes, subscriber),
      },
    });
    const files = yield* FileSystem.FileSystem;
    const spelled = resolvePath(storeDirectory(store.path), GLOBAL_PROJECT.rootDirName);
    const globalRoot = yield* physical(files, spelled).pipe(
      Effect.catchTag('PlatformError', (failure) =>
        Effect.as(
          Effect.logWarning('the global root keeps the spelling it was named by: its physical path could not be read', {
            reason: failure.message,
          }),
          spelled,
        ),
      ),
    );
    yield* store
      .transaction(writes('project.global', [project]), (unit) =>
        Effect.gen(function* () {
          if ((yield* globalProject(store, unit)) !== undefined) return;
          yield* unit.run(
            db.insert(project).values({
              name: GLOBAL_PROJECT.name,
              repoKey: GLOBAL_PROJECT.repoKey,
              global: true,
              rootPath: globalRoot,
              createdAt: new Date(yield* Clock.currentTimeMillis),
            }),
          );
        }),
      )
      .pipe(Effect.orDie);
    yield* markedRoots(store, units, files).pipe(Effect.orDie);
    const spellings = new Map<string, string>();
    events.changed.subscribe(Effect.sync(() => spellings.clear()));
    const canonical: Canonical = (rootPath) =>
      Effect.suspend(() => {
        const known = spellings.get(rootPath);
        if (known !== undefined) return Effect.succeed(known);
        return physical(files, rootPath).pipe(
          Effect.catchTag('PlatformError', (failure) =>
            Effect.as(
              Effect.logWarning('a registered root is compared by the spelling it was stored with: its physical path could not be read', {
                rootPath,
                reason: failure.message,
              }),
              rootPath,
            ),
          ),
          Effect.tap((root) => Effect.sync(() => spellings.set(rootPath, root))),
        );
      });
    let removed: { readonly version: number; readonly ids: readonly number[] } | null = null;
    const projects = Projects.of({
      list: () => units.read((unit) => list(store, unit)),
      byId: (id) => units.read((unit) => byId(store, unit, id)),
      global: () => units.read((unit) => globalProject(store, unit)),
      removed: Effect.fnUntraced(function* () {
        const at = yield* Ref.get(version);
        if (removed?.version === at) return removed.ids;
        const ids = yield* units.read((unit) => removedIds(store, unit));
        if ((yield* Ref.get(version)) === at) removed = { version: at, ids };
        return ids;
      }),
      named: (ref) => units.read((unit) => named(store, unit, ref)),
      resolve: Effect.fn('Projects.resolve')(function* (ref, here) {
        if (ref !== undefined && ref !== '') return yield* units.read((unit) => named(store, unit, ref));
        if (here === undefined || here.cwd === '') return undefined;
        const { repoKey } = here.identity;
        const keyed = repoKey === null ? undefined : yield* units.read((unit) => ownerByKey(store, unit, repoKey));
        if (keyed !== undefined && (yield* Effect.mapError(keyHolds(keyed, here.identity), gitRefusal))) return keyed;
        return yield* units.read((unit) => ownerByPlace(store, unit, here, canonical));
      }),
      registryVersion: Ref.get(version),
      register: Effect.fn('Projects.register')(function* (unit, input) {
        const { identity } = input;
        const { holder, own, moved } = yield* placeOf(store, unit, identity, canonical);
        if (holder !== undefined && !holder.global && (holder.removedAt !== null || moved)) {
          const kept = holder.removedAt === null || (yield* holderOfName(store, unit, holder.name)) === undefined;
          if (!kept) yield* nameChecked(store, unit, reserved, input.name, holder.id);
          const repoKey = keyOf(identity, own, holder);
          yield* markedAt(identity, repoKey);
          const row = yield* unit.run(
            db
              .update(project)
              .set({
                repoKey,
                rootPath: moved ? identity.rootPath : holder.rootPath,
                removedAt: null,
                name: kept ? holder.name : input.name,
              })
              .where(eq(project.id, holder.id))
              .returning(registration)
              .get(),
          );
          if (row === undefined) return yield* Effect.die('project update returned no row');
          yield* unit.afterCommit(events.changed.publish());
          return { project: row, returned: true };
        }
        if (holder?.global === true) {
          return yield* new GateRefusal('reserved-project', `"${GLOBAL_PROJECT.name}" is the cross-project graph, which always exists`, [
            'name this project something else',
            `name project ${GLOBAL_PROJECT.name} in a read to reach the graph that already holds that name`,
          ]).saying(PROJECT_WORDS.nameRefused(input.name));
        }
        yield* nameChecked(store, unit, reserved, input.name);
        yield* identityFree(holder);
        const repoKey = keyOf(identity, own);
        yield* markedAt(identity, repoKey);
        const row = yield* unit.run(
          db
            .insert(project)
            .values({ name: input.name, repoKey, rootPath: identity.rootPath, createdAt: new Date(yield* Clock.currentTimeMillis) })
            .returning(registration)
            .get(),
        );
        if (row === undefined) return yield* Effect.die('project insert returned no row');
        yield* unit.afterCommit(events.changed.publish());
        return { project: row, returned: false };
      }),
      setRoot: Effect.fn('Projects.setRoot')(function* (unit, current, identity) {
        yield* refuseUnmaking(current, 're-pointed');
        const { holder, own } = yield* placeOf(store, unit, identity, canonical);
        yield* identityFree(holder, current.id);
        const repoKey = keyOf(identity, own, current);
        yield* markedAt(identity, repoKey);
        const row = yield* unit.run(
          db.update(project).set({ repoKey, rootPath: identity.rootPath }).where(eq(project.id, current.id)).returning(registration).get(),
        );
        if (row === undefined) return yield* Effect.die('project update returned no row');
        yield* unit.afterCommit(events.changed.publish());
        return row;
      }),
      rename: Effect.fn('Projects.rename')(function* (unit, current, name) {
        yield* refuseUnmaking(current, 'renamed');
        if (name === current.name) return current;
        yield* nameChecked(store, unit, reserved, name, current.id);
        const row = yield* unit.run(db.update(project).set({ name }).where(eq(project.id, current.id)).returning(registration).get());
        if (row === undefined) return yield* Effect.die('project update returned no row');
        yield* unit.afterCommit(events.changed.publish());
        return row;
      }),
      remove: Effect.fn('Projects.remove')(function* (unit, current) {
        yield* refuseUnmaking(current, 'removed');
        yield* unit.run(
          db
            .update(project)
            .set({ removedAt: new Date(yield* Clock.currentTimeMillis) })
            .where(eq(project.id, current.id)),
        );
        yield* unit.afterCommit(events.changed.publish());
      }),
      forget: Effect.fn('Projects.forget')(function* (unit, current) {
        yield* unit.run(db.delete(project).where(eq(project.id, current.id)));
        yield* unit.afterCommit(events.changed.publish());
      }),
    });
    return Context.make(Projects, projects).pipe(Context.add(ProjectChanges, events));
  }),
).pipe(Layer.provide(Layer.merge(unitsLayer(MachineUnits, MachineStore), BunFileSystem.layer)));
