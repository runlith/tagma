import { Context, Effect } from 'effect';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { PROJECT_SETTINGS, type ProjectSetting, type ProjectSettings } from '../contract/wire/storage.js';
import type { GraphStore, StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { project } from '../../projects/store/table.js';
import { projectPolicy, projectsWithPolicy, writePolicy } from '../store/policy.js';
import type { ProjectRefusal, StorageMode } from '../../projects/contract/wire/project.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import type { ProjectChanges } from '../../projects/contract/service/changes.js';
import { ProjectPolicy, type ProjectPolicyChanged } from '../contract/service/serving.js';
import type { Act } from '../contract/service/acts.js';
import { transactionUnit } from '../acts/state.js';
import { GateRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import type { readsOf } from '../acts/reads.js';
import type { GraphServices } from '../contract/service/services.js';
import { writes } from '../../platform/contract/service/writes.js';

const policySetting = writes('Projects.set', [projectPolicy]);
const storageSetting = writes('ProjectPolicy.setStorage', [projectPolicy]);
const remoteSetting = writes('ProjectPolicy.setRemote', [projectPolicy]);

export const OtherGraphs = Context.Reference<
  ((projectId: number) => Effect.Effect<Context.Context<GraphServices | GraphStore>, GateRefusal<OpenRefusal>>) | null
>('tagma/graph/OtherGraphs', { defaultValue: () => null });

export type GraphRole = 'machine' | 'mirror';

export const policyRows = (db: StoreDb<'graph'>, projects: Projects['Service']) => {
  const byId = Effect.fn('Projects.byId')(function* (
    id: number,
  ): Effect.fn.Return<ProjectPolicyRow, StoreFailure | GateRefusal<'not-found'>> {
    const row = yield* projectsWithPolicy(db)
      .where(and(eq(project.id, id), isNull(project.removedAt)))
      .get();
    if (!row) {
      return yield* new GateRefusal('not-found', `project ${id} does not exist`, ['the registry names the registered roots and their ids']);
    }
    return row;
  });

  const resolveRef = Effect.fn('Projects.resolveRef')(function* (
    ref: string,
  ): Effect.fn.Return<ProjectPolicyRow, StoreFailure | GateRefusal<ProjectRefusal>> {
    if (/^\d+$/.test(ref)) return yield* byId(Number(ref));
    const all = yield* projects.list();
    const rows = all.filter((p) => p.name === ref);
    if (rows.length === 1 && rows[0] !== undefined) return yield* byId(rows[0].id);
    const known = all.map((p) => `${p.name} (${p.id})`).join(', ');
    return yield* new GateRefusal(
      rows.length === 0 ? 'unknown-project' : 'ambiguous-project',
      `no unique project named "${ref}"; registered: ${known || 'none'}`,
      ['the registry names what is registered'],
    );
  });

  return { byId, resolveRef };
};

export const policyChangesOf = (projectChanges: ProjectChanges['Service']) => {
  const changed = Effect.flatMap(transactionUnit, (unit) => unit.afterCommit(projectChanges.changed.publish()));
  const policySubscribers = new Set<(event: ProjectPolicyChanged) => Effect.Effect<void>>();
  const subscribe = (subscriber: (event: ProjectPolicyChanged) => Effect.Effect<void>) => {
    policySubscribers.add(subscriber);
    return () => {
      policySubscribers.delete(subscriber);
    };
  };
  const policyChanged = (event: ProjectPolicyChanged) =>
    Effect.flatMap(transactionUnit, (unit) =>
      unit.afterCommit(Effect.forEach([...policySubscribers], (subscriber) => subscriber(event), { discard: true })),
    );
  return { changed, subscribe, policyChanged };
};

export const servedPolicy = (input: {
  readonly db: StoreDb<'graph'>;
  readonly reads: ReturnType<typeof readsOf>;
  readonly act: Act['Service'];
  readonly servesFrom: ProjectPolicy['Service']['servesFrom'];
  readonly resolveRef: ReturnType<typeof policyRows>['resolveRef'];
  readonly changed: ReturnType<typeof policyChangesOf>['changed'];
  readonly policyChanged: ReturnType<typeof policyChangesOf>['policyChanged'];
  readonly subscribe: ReturnType<typeof policyChangesOf>['subscribe'];
}) => {
  const { db, reads, act, resolveRef, changed, policyChanged } = input;
  return ProjectPolicy.of({
    subscribe: input.subscribe,
    read: reads(
      Effect.fn('ProjectPolicy.read')(function* (ids: readonly number[]) {
        const rows = ids.length === 0 ? [] : yield* projectsWithPolicy(db).where(and(inArray(project.id, ids), isNull(project.removedAt)));
        return new Map(rows.map((row) => [row.id, row]));
      }),
    ),
    servesFrom: reads(input.servesFrom),

    set: Effect.fn('Projects.set')(function* (input: { ref: string; settings: ProjectSettings }) {
      const current = yield* resolveRef(input.ref);
      const moved = PROJECT_SETTINGS.flatMap((field) => {
        const value = input.settings[field];
        return value === undefined || value === current[field] ? [] : [{ field, value }];
      });
      if (moved.length === 0) return current;
      return yield* act.unit(
        policySetting,
        Effect.gen(function* () {
          const fields: { [Field in ProjectSetting]?: boolean } = {};
          for (const { field, value } of moved) fields[field] = value;
          yield* writePolicy(db, current.id, fields);
          for (const { field, value } of moved)
            yield* act.record('project_set', null, { projectId: current.id, field, from: current[field], to: value });
          yield* changed;
          for (const { field } of moved) yield* policyChanged({ projectId: current.id, field });
          return { ...current, ...fields } satisfies ProjectPolicyRow;
        }),
      );
    }),

    setStorage: Effect.fn('ProjectPolicy.setStorage')(function* (input: { id: number; mode: StorageMode }) {
      const current = yield* projectsWithPolicy(db)
        .where(and(eq(project.id, input.id), isNull(project.removedAt)))
        .get();
      if (!current) {
        return yield* new GateRefusal('not-found', `project ${input.id} does not exist`, [
          'the registry names the registered roots and their ids',
        ]);
      }
      return yield* act.unit(
        storageSetting,
        Effect.gen(function* () {
          yield* writePolicy(db, current.id, { storage: input.mode });
          const row: ProjectPolicyRow = { ...current, storage: input.mode };
          yield* act.record('project_set_storage', null, { projectId: current.id, from: current.storage, to: input.mode });
          yield* changed;
          yield* policyChanged({ projectId: current.id, field: 'storage' });
          return row;
        }),
      );
    }),

    setRemote: Effect.fn('ProjectPolicy.setRemote')(function* (input: { id: number; remote: string | null }) {
      const current = yield* projectsWithPolicy(db)
        .where(and(eq(project.id, input.id), isNull(project.removedAt)))
        .get();
      if (!current) {
        return yield* new GateRefusal('not-found', `project ${input.id} does not exist`, [
          'the registry names the registered roots and their ids',
        ]);
      }
      return yield* act.unit(
        remoteSetting,
        Effect.gen(function* () {
          yield* writePolicy(db, current.id, { graphRemote: input.remote });
          const row: ProjectPolicyRow = { ...current, graphRemote: input.remote };
          yield* act.record('project_set', null, {
            projectId: current.id,
            field: 'graphRemote',
            from: current.graphRemote,
            to: input.remote,
          });
          yield* changed;
          yield* policyChanged({ projectId: current.id, field: 'graphRemote' });
          return row;
        }),
      );
    }),
  });
};
