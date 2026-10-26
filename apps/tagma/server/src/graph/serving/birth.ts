import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { gitIdentity, runGit } from '../../platform/git/ownGit.js';
import { blocksRetiredKey, rowsStepKey, type ServesFrom } from '../contract/wire/storage.js';
import { GraphSteps } from '../contract/service/steps.js';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { GraphStore, MachineStore, storeDirectory, type StoreDb } from '../../platform/contract/service/store.js';
import { pagesOf } from '../../platform/store/binds.js';
import { block, meta } from '../store/tables.js';
import { project } from '../../projects/store/table.js';
import { projectPolicy, writePolicy } from '../store/policy.js';
import { GLOBAL_PROJECT, type ProjectRow, type StorageMode } from '../../projects/contract/wire/project.js';
import { rootChecked } from '../../projects/registration.js';
import type { AdmittedProject, ProjectPolicyRow } from '../contract/wire/serving.js';
import { ProjectIdentification, Projects } from '../../projects/contract/service/registry.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { GraphScopes, ProjectLifecycle, ProjectPolicy } from '../contract/service/serving.js';
import { Act, BlockNames, BlockProjection, BlockReferences } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Settings } from '../../settings/contract/service/values.js';
import { automaticInstall, installCatalogs, installRoad } from '../vocabulary/activation.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { Behaviours } from '../contract/service/behaviours.js';
import { GateRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { readsOf } from '../acts/reads.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { CORE_LIBRARY } from '../contract/wire/tags/identity.js';
import { ManagedWrite } from '../../settings/contract/service/managed.js';
import { setting } from '../../settings/store/table.js';
import { session } from '../../platform/store/writers.js';
import { Git } from '@runlith/git/Git';
import { type GraphRole, policyChangesOf, policyRows, servedPolicy } from './policy.js';
import { graphScopes } from './scope.js';
import { projectRemoval } from './removal.js';
import { projecting, referencing } from '../store/actWrites.js';

const vocabularyEnsuring = writes('Projects.ensureVocabulary', [block], projecting, referencing);
const globalEnsuring = writes('Projects.ensureGlobal', [block, projectPolicy, meta], projecting, referencing);
const creating = writes('ProjectLifecycle.create', [block, projectPolicy, meta], projecting, referencing);
const settingWrites = writes('ProjectLifecycle.create.catalogs', [session, setting]);

const chosenCatalogs = Effect.fn('Projects.chosenCatalogs')(function* (shipped: Catalogs['Service'], asked: readonly string[] | undefined) {
  if (asked === undefined || shipped.key === null) return undefined;
  for (const id of asked) {
    if (shipped.byId(id) === null) {
      return yield* new GateRefusal('unknown-catalog', `no catalog named "${id}" is shipped`, [
        'name a shipped catalog, or omit catalogs to inherit the machine setting',
      ]);
    }
  }
  return [...new Set([...(shipped.byId(CORE_LIBRARY) === null ? [] : [CORE_LIBRARY]), ...asked])];
});
const moving = writes('ProjectLifecycle.move', []);

export const ensureVocabulary = Effect.fn('Projects.ensureVocabulary')(function* (role: GraphRole) {
  const { db } = yield* GraphStore;
  const road = yield* installRoad;
  const settings = yield* Settings;
  const rooted = yield* db
    .select({ id: project.id })
    .from(project)
    .where(
      and(
        isNull(project.removedAt),
        sql`exists (
        select 1 from ${block} r
        where r.project_id = ${project.id} and r.parent_id is null and r.deleted_at is null)`,
      ),
    );
  let candidates = rooted;
  if (role === 'machine') {
    const { last } = yield* GraphSteps;
    const current = new Set<string>();
    for (const keys of pagesOf(
      rooted.map((row) => rowsStepKey(row.id)),
      2,
      (key) => key.length,
    )) {
      const marks = yield* db
        .select({ key: meta.key })
        .from(meta)
        .where(and(inArray(meta.key, keys), eq(meta.value, last)));
      for (const mark of marks) current.add(mark.key);
    }
    candidates = rooted.filter((row) => current.has(rowsStepKey(row.id)));
  }
  const homes = role === 'machine' ? yield* (yield* ProjectPolicy).servesFrom(candidates.map((row) => row.id)) : null;
  const standing = homes === null ? candidates : candidates.filter((row) => homes.get(row.id) === 'rows');
  for (const row of standing) {
    const catalogIds = road.shipped.key === null ? [] : yield* settings.value(road.shipped.key, row.id);
    yield* automaticInstall(road, row.id, catalogIds, vocabularyEnsuring);
  }
  return standing.map((row) => row.id);
});

const servesFromOf = (db: StoreDb<'graph'>, role: GraphRole) =>
  Effect.fn('Projects.servesFrom')(function* (ids: readonly number[]) {
    const answer = new Map<number, ServesFrom>(ids.map((id) => [id, role === 'mirror' ? 'files' : 'rows']));
    if (role === 'mirror' || ids.length === 0) return answer;
    const keys = new Map(ids.map((id) => [blocksRetiredKey(id), id]));
    const rows = yield* db
      .select({ key: meta.key })
      .from(meta)
      .where(inArray(meta.key, [...keys.keys()]));
    for (const row of rows) {
      const id = keys.get(row.key);
      if (id !== undefined) answer.set(id, 'files');
    }
    return answer;
  });

export const projectsLayer = (
  role: GraphRole,
): Layer.Layer<
  GraphScopes | ProjectPolicy | ProjectLifecycle,
  never,
  | GraphStore
  | GraphUnits
  | MachineStore
  | Projects
  | ProjectChanges
  | Act
  | BlockRows
  | BlockNames
  | BlockProjection
  | BlockReferences
  | Git
  | Tags
  | Settings
  | ManagedWrite
  | Catalogs
  | Behaviours
  | GraphSteps
  | FileSystem.FileSystem
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const store = yield* GraphStore;
      const { db, path: storePath } = store;
      const managed = yield* ManagedWrite;
      const reads = readsOf(yield* GraphUnits);
      const act = yield* Act;
      const blockRows = yield* BlockRows;
      const blockNames = yield* BlockNames;
      const blockProjection = yield* BlockProjection;
      const blockReferences = yield* BlockReferences;
      const road = yield* installRoad;
      const vocabulary = yield* Tags;
      const settings = yield* Settings;
      const git = yield* Git;
      const machine = yield* MachineStore;
      const projects = yield* Projects;
      const projectChanges = yield* ProjectChanges;
      const { last: lastStep, prepareStorage } = yield* GraphSteps;
      if (role === 'machine') yield* Effect.orDie(prepareStorage);
      const { changed, subscribe, policyChanged } = policyChangesOf(projectChanges);
      const servesFrom = servesFromOf(db, role);
      const rows = policyRows(db, projects);
      const { byId } = rows;

      const globalRoot = resolvePath(storeDirectory(storePath), GLOBAL_PROJECT.rootDirName);

      const ensureGlobal = Effect.gen(function* () {
        if (storePath !== ':memory:') {
          yield* Effect.sync(() => mkdirSync(globalRoot, { recursive: true }));
          if (!(yield* Effect.sync(() => existsSync(join(globalRoot, '.git'))))) {
            yield* runGit(git, 'global-init', ['init', '-q', '-b', 'main', globalRoot]);
            yield* runGit(git, 'global-init', ['-C', globalRoot, 'commit', '-q', '--allow-empty', '-m', 'Shared project born'], {
              env: gitIdentity('tagma'),
            });
          }
        }
        const registered = yield* projects.global();
        if (registered === undefined) return yield* Effect.die('the machine registry has no global project');
        const standing = yield* byId(registered.id);
        const root = yield* db
          .select({ id: block.id })
          .from(block)
          .where(and(eq(block.projectId, standing.id), isNull(block.parentId), isNull(block.deletedAt)))
          .get();
        if (root !== undefined) return;
        yield* act.unit(
          globalEnsuring,
          Effect.gen(function* () {
            const born = yield* rootBlock(standing.id, GLOBAL_PROJECT.name, new Date(yield* Clock.currentTimeMillis));
            yield* installCatalogs(road, standing.id, road.shipped.key === null ? [] : yield* settings.value(road.shipped.key));
            yield* db
              .insert(meta)
              .values({ key: rowsStepKey(standing.id), value: lastStep })
              .onConflictDoUpdate({ target: meta.key, set: { value: lastStep } });
            yield* act.record('project_add', born?.id ?? null, { projectId: standing.id, repoKey: GLOBAL_PROJECT.repoKey });
          }),
        );
      });

      const rootBlock = Effect.fn('Projects.rootBlock')(function* (projectId: number, title: string, now: Date) {
        const root = yield* db
          .insert(block)
          .values({ uuid: mintBlockId(), projectId, parentId: null, ord: 1, tags: [], fields: {}, title, createdAt: now, updatedAt: now })
          .returning()
          .get();
        if (root) yield* blockProjection.syncSearch(root.id);
        return root;
      });

      const { takeBack, remove } = projectRemoval({ db, machine, act, vocabulary, projects, projectChanges, rows });
      if (role === 'machine') yield* ensureGlobal.pipe(Effect.orDie);

      const lifecycle = ProjectLifecycle.of({
        create: Effect.fn('ProjectLifecycle.create')(function* (
          input: {
            name: string;
            rootPath: string;
            strictProvenance?: boolean;
            private?: boolean;
            storage?: StorageMode;
            catalogs?: readonly string[];
            graphRemote?: string;
          },
          birth?: (row: ProjectPolicyRow) => Effect.Effect<void, GateRefusal<OpenRefusal>>,
        ) {
          yield* rootChecked(input.rootPath);
          const identity = yield* Effect.mapError((yield* ProjectIdentification).identify(input.rootPath), gitRefusal);
          const chosen = yield* chosenCatalogs(road.shipped, input.catalogs);
          const now = new Date(yield* Clock.currentTimeMillis);
          let announce: Effect.Effect<void> = Effect.void;
          const bear = Effect.fnUntraced(function* (row: ProjectRow) {
            const policy = {
              strictProvenance: input.strictProvenance ?? false,
              private: input.private ?? false,
              storage: input.storage ?? 'stealth',
              graphRemote: input.graphRemote ?? null,
            };
            yield* writePolicy(db, row.id, policy);
            const born: ProjectPolicyRow = { ...row, ...policy };
            const root = yield* rootBlock(born.id, input.name, now);
            yield* db.insert(meta).values({ key: rowsStepKey(born.id), value: lastStep });
            yield* act.record('project_add', root?.id ?? null, { projectId: born.id, repoKey: born.repoKey, rootPath: born.rootPath });
            if (road.shipped.key === null) return born;
            if (chosen === undefined) {
              yield* installCatalogs(road, born.id, yield* settings.value(road.shipped.key));
              return born;
            }
            yield* installCatalogs(road, born.id, chosen);
            const key = road.shipped.key;
            const written = yield* store.transaction(
              settingWrites,
              (settingUnit) =>
                managed.write(settingUnit, {
                  key,
                  scope: 'project',
                  projectId: born.id,
                  value: chosen,
                  declined: false,
                  pinned: true,
                  resolved: chosen,
                }),
              { settlement: 'savepoint' },
            );
            announce = written.announce;
            return born;
          });
          const registered: AdmittedProject = yield* machine.transaction(writes('project.birth', [project, projectPolicy]), (unit) =>
            act.unit(
              creating,
              Effect.gen(function* () {
                const { project: row, returned } = yield* projects.register(unit, { name: input.name, identity });
                if (!returned) return { ...(yield* bear(row)), returned };
                yield* act.record('project_return', null, { projectId: row.id, repoKey: row.repoKey, rootPath: row.rootPath });
                return { ...(yield* byId(row.id)), returned };
              }),
            ),
          );
          yield* announce;
          if (registered.returned || birth === undefined) return registered;
          yield* birth(registered).pipe(Effect.onError(() => Effect.orDie(takeBack(registered))));
          return registered;
        }),
        move: Effect.fn('ProjectLifecycle.move')(function* (projectId: number, root: string) {
          const current = yield* projects.byId(projectId);
          if (current.global)
            return yield* new GateRefusal('global-permanent', `"${current.name}" is the cross-project graph: it cannot be re-pointed`, [
              'delete or disable its rules — that is what stops law from travelling',
            ]);
          yield* rootChecked(root);
          const identity = yield* Effect.mapError((yield* ProjectIdentification).identify(root), gitRefusal);
          return yield* machine.transaction(writes('project.relocate', [project]), (unit) =>
            act.unit(
              moving,
              Effect.gen(function* () {
                yield* projects.setRoot(unit, current, identity);
                yield* act.record('project_set_root', null, {
                  projectId: current.id,
                  from: current.rootPath,
                  to: identity.rootPath,
                });
                return yield* byId(current.id);
              }),
            ),
          );
        }),
        remove,
      });

      return Context.make(ProjectLifecycle, lifecycle).pipe(
        Context.add(GraphScopes, graphScopes({ db, reads, git, projects, blockRows, blockNames, byId })),
        Context.add(
          ProjectPolicy,
          servedPolicy({ db, reads, act, servesFrom, resolveRef: rows.resolveRef, changed, policyChanged, subscribe }),
        ),
      );
    }),
  );
