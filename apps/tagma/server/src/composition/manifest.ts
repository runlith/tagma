import { Effect, Layer } from 'effect';
import { prepareSqlite } from './sqlite.js';
import type { CheckSubjectKind, FeedDeclaration, Operation, OperationDeclaration } from '../platform/contract/wire/operation.js';
import { type DeclaredOperations, type Manifest, manifests, operationsOf } from '../platform/contract/service/manifest.js';
import type { Machine } from '../platform/contract/service/capacity.js';
import type { PoolDeclaration } from '@runlith/held/Capacity';
import type { SubjectKind } from '../platform/contract/wire/place.js';
import type { SubjectPlace } from '../platform/contract/service/place.js';
import type { DoctrineFact, DoctrineSection } from '../platform/contract/wire/section.js';
import type { SnapshotHome, SnapshotParticipant } from '../platform/contract/service/snapshots.js';
import type { SettingKey, SettingSectionDeclaration } from '../platform/contract/wire/setting.js';
import { OperationId } from '../platform/contract/wire/ids.js';
import { projectedOperations } from '../platform/contract/wire/projection.js';
import type { OperationRegistry } from '../invocation/contract/service/registry.js';
import { operationRegistry } from '../invocation/registry.js';
import type { DeclaredCapability } from '../native-harness/contract/service/capabilities.js';
import { BEHAVIOURS, type BehaviourRegistry } from '../graph/contract/service/behaviours.js';
import { registerBehaviours } from '../graph/vocabulary/behaviours.js';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { entryKinds } from './entryKinds.js';
import { BUILTIN_NOTES, type BuiltinNote } from '../threads/contract/service/notes.js';
import { NATIVE_RULES } from '../native-harness/contract/service/rules.js';
import { HOME_FOLLOWERS, type HomeFollower } from '../thread-record/contract/service/homes.js';
import { LIVE_WORK, type LiveWork } from '../platform/contract/service/live.js';
import { PROJECT_CREATION, type CreationStep } from '../graph/contract/service/creation.js';
import type { NamedRight } from '../platform/contract/service/access.js';
import type { ServerParts } from './build.js';
import { type LiveGroup, liveRpc } from './rpc.js';
import type { CORE_MODULES } from './core.js';

type DriversOf<M> = M extends { readonly drivers: readonly (infer D extends { readonly id: string })[] } ? D['id'] : never;

export type DriverId = DriversOf<(typeof CORE_MODULES)[number]>;

type FeedsOf<M> = M extends { readonly live: { readonly feeds: readonly (infer F)[] } } ? F : never;

export type LiveFeed = FeedsOf<(typeof CORE_MODULES)[number]>;

export type CollectedOperations = {
  readonly modules: readonly DeclaredOperations[];
  readonly declarations: readonly OperationDeclaration[];
  readonly tables: readonly { readonly title: string; readonly declarations: readonly OperationDeclaration[] }[];
  readonly journaled: ReadonlySet<string>;
};

export const WORLD_TOOL_CHECKS: Readonly<Record<string, CheckSubjectKind>> = { edit: 'file', write: 'file' };

export type Assembly = {
  readonly modules: readonly Manifest[];
  readonly operations: CollectedOperations;
  readonly registry: OperationRegistry<OperationId>;
  readonly ids: readonly OperationId[];
  readonly ownerOf: (name: string) => string | null;
  readonly subjectOf: (op: string) => CheckSubjectKind | null;
  readonly retiredTables: readonly string[];
  readonly preparation: Layer.Layer<never, unknown>;
  readonly afterRecovery: Layer.Layer<never, unknown, unknown>;
  readonly sections: readonly DoctrineSection[];
  readonly facts: readonly DoctrineFact[];
  readonly pools: (machine: Machine) => readonly PoolDeclaration[];
  readonly capabilities: readonly DeclaredCapability[];
  readonly behaviours: BehaviourRegistry;
  readonly notes: readonly BuiltinNote[];
  readonly nativeRules: ReturnType<typeof NATIVE_RULES.collect>;
  readonly homeFollowers: readonly HomeFollower[];
  readonly liveWork: readonly LiveWork[];
  readonly creationSteps: readonly CreationStep[];
  readonly rights: readonly NamedRight[];
  readonly entryKinds: ThreadEntryReader;
  readonly settings: { readonly sections: readonly SettingSectionDeclaration[]; readonly keys: readonly SettingKey<unknown>[] };
  readonly snapshotParticipants: (home: SnapshotHome) => Effect.Effect<Readonly<Record<string, SnapshotParticipant>>>;
  readonly drivers: ReadonlySet<string>;
  readonly feeds: readonly FeedDeclaration[];
  readonly live: LiveGroup;
  readonly socketVerbs: Readonly<Record<string, OperationId>>;
  readonly subjectPlaces: Effect.Effect<ReadonlyMap<SubjectKind, SubjectPlace>>;
};

const collect = (loaded: readonly DeclaredOperations[]): CollectedOperations => ({
  modules: loaded,
  declarations: loaded.flatMap((module) => module.declarations),
  tables: loaded.flatMap(({ module, declarations: own }) =>
    own.length === 0 ? [] : [{ title: module.title ?? module.id, declarations: own }],
  ),
  journaled: new Set(loaded.flatMap((module) => [...module.journaled])),
});

const subjectOf =
  (registry: OperationRegistry<OperationId>) =>
  (op: string): CheckSubjectKind | null => {
    const world = WORLD_TOOL_CHECKS[op];
    if (world !== undefined) return world;
    const id = registry.named(op);
    if (id === null) return null;
    const entry: Operation = registry.entry(id);
    if (entry.subject !== undefined) return entry.subject === 'none' ? null : entry.subject;
    return entry.checks ?? (entry.mutates === true ? null : 'head');
  };

const placesOf = (modules: readonly Manifest[]): Effect.Effect<ReadonlyMap<SubjectKind, SubjectPlace>> =>
  Effect.map(
    Effect.forEach(
      modules.flatMap((module) => (module.subjects === undefined ? [] : [{ id: module.id, load: module.subjects }])),
      ({ id, load }) => Effect.map(Effect.promise(load), (owned) => owned.map((one) => ({ id, one }))),
      { concurrency: 'unbounded' },
    ),
    (loaded) => {
      const owners = new Map<SubjectKind, { readonly id: string; readonly one: SubjectPlace }>();
      for (const { id, one } of loaded.flat()) {
        const owner = owners.get(one.kind);
        if (owner !== undefined) throw new Error(`The subject kind ${one.kind} is resolved by both ${owner.id} and ${id}.`);
        owners.set(one.kind, { id, one });
      }
      return new Map([...owners].map(([kind, { one }]) => [kind, one] as const));
    },
  );

export const participantsOf =
  (modules: readonly Manifest[]) =>
  (home: SnapshotHome): Effect.Effect<Readonly<Record<string, SnapshotParticipant>>> =>
    Effect.map(
      Effect.forEach(
        modules.flatMap((module) => (module.snapshots === undefined ? [] : [[module.id, module.snapshots] as const])),
        ([id, participant]) =>
          Effect.map(
            Effect.promise(() => participant(home)),
            (loaded) => [id, loaded] as const,
          ),
        { concurrency: 'unbounded' },
      ),
      Object.fromEntries,
    );

export const assemble = async ({ modules, rested }: ServerParts): Promise<Assembly> => {
  manifests(...modules);
  const operations = collect(await Effect.runPromise(operationsOf(modules)));
  const registry = operationRegistry<OperationId>(
    projectedOperations(Object.fromEntries(operations.declarations.map((declaration) => [declaration.id, declaration]))),
  );
  const owners = new Map<string, string>(
    operations.modules.flatMap(({ module, declarations }) => declarations.map(({ id }) => [id, module.id] as const)),
  );
  const capabilities: readonly DeclaredCapability[] = modules.flatMap((module) =>
    (module.capabilities ?? []).map((declaration) => ({ owner: module.id, declaration })),
  );
  const toolOwners = new Map(
    capabilities.flatMap(({ declaration }) => {
      const code = declaration.toolCode;
      return code === undefined ? [] : code.names.map((name) => [name, code.module] as const);
    }),
  );
  const feeds = modules.flatMap((module) => module.live?.feeds ?? []);
  const creationSteps = PROJECT_CREATION.collect(modules).map(({ entry }) => entry);
  const rights = [...operations.declarations, ...feeds, ...creationSteps].flatMap(({ id, right }): NamedRight[] =>
    right === undefined ? [] : [{ key: right, by: id }],
  );
  return {
    modules,
    operations,
    registry,
    ids: registry.ids,
    ownerOf: (name) => owners.get(name) ?? toolOwners.get(name) ?? null,
    subjectOf: subjectOf(registry),
    retiredTables: modules.flatMap((module) => module.retiredTables ?? []),
    preparation: Layer.mergeAll(Layer.empty, ...modules.flatMap((module) => module.lifetimes?.preparation ?? [])).pipe(
      Layer.provide(Layer.effectDiscard(prepareSqlite)),
    ),
    afterRecovery: Layer.mergeAll(Layer.empty, ...modules.flatMap((module) => module.lifetimes?.afterRecovery ?? [])),
    sections: modules.flatMap((module) => module.sections ?? []),
    facts: modules.flatMap((module) => module.facts ?? []),
    pools: (machine) => modules.flatMap((module) => module.pools?.(machine) ?? []),
    capabilities,
    behaviours: registerBehaviours(BEHAVIOURS.collect(modules), new Set<string>(registry.ids)),
    notes: BUILTIN_NOTES.collect(modules).map(({ entry }) => entry),
    nativeRules: NATIVE_RULES.collect(modules),
    homeFollowers: HOME_FOLLOWERS.collect(modules).map(({ entry }) => entry),
    liveWork: LIVE_WORK.collect(modules).map(({ entry }) => entry),
    creationSteps,
    rights,
    entryKinds: entryKinds(modules, rested),
    settings: {
      sections: modules.flatMap((module) => module.settingSections ?? []),
      keys: modules.flatMap((module) => module.settings ?? []),
    },
    snapshotParticipants: participantsOf(modules),
    drivers: new Set(modules.flatMap((module) => (module.drivers ?? []).map(({ id }) => id))),
    feeds,
    live: liveRpc(feeds),
    socketVerbs: Object.fromEntries(
      feeds.flatMap((declared) => (declared.performs === undefined ? [] : [[declared.id, OperationId.make(declared.performs)] as const])),
    ),
    subjectPlaces: Effect.runSync(Effect.cached(placesOf(modules))),
  };
};
