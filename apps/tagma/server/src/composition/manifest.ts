import { Effect, Layer } from 'effect';
import type { OperationDeclaration } from '../platform/contract/wire/operation.js';
import { type DeclaredOperations, type Manifest, operationsOf } from '../platform/contract/service/manifest.js';
import type { Machine } from '../platform/contract/service/capacity.js';
import type { PoolDeclaration } from '@runlith/held/Capacity';
import type { SubjectKind } from '../platform/contract/wire/place.js';
import type { SubjectPlace } from '../platform/contract/service/place.js';
import type { DoctrineFact, DoctrineSection } from '../platform/contract/wire/section.js';
import type { SnapshotHome, SnapshotParticipant } from '../platform/contract/service/snapshots.js';
import type { SettingKey, SettingSectionDeclaration } from '../platform/contract/wire/setting.js';
import { OPERATION_IDS } from './catalog.js';
import { MODULES } from '@tagma/server/composition/modules';
import type { DeclaredCapability } from '../native-harness/contract/service/capabilities.js';
import { BEHAVIOURS, type BehaviourRegistry } from '../graph/contract/service/behaviours.js';
import { registerBehaviours } from '../graph/vocabulary/behaviours.js';
import { makeThreadEntryReader, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { JOURNAL_BASE, journalSteps } from '../threads/journal/formSteps.js';
import { BUILTIN_NOTES, type BuiltinNote } from '../threads/contract/service/notes.js';
import { NATIVE_RULES } from '../native-harness/contract/service/rules.js';

const modules: readonly Manifest[] = MODULES;

export const RETIRED_TABLES: readonly string[] = modules.flatMap((module) => module.retiredTables ?? []);

export const PREPARATION = Layer.mergeAll(Layer.empty, ...modules.flatMap((module) => module.lifetimes?.preparation ?? []));

export const AFTER_RECOVERY = Layer.mergeAll(Layer.empty, ...modules.flatMap((module) => module.lifetimes?.afterRecovery ?? []));

export const SECTIONS: readonly DoctrineSection[] = modules.flatMap((module) => module.sections ?? []);

export const POOLS = (machine: Machine): readonly PoolDeclaration[] => modules.flatMap((module) => module.pools?.(machine) ?? []);

export const CAPABILITIES: readonly DeclaredCapability[] = modules.flatMap((module) =>
  (module.capabilities ?? []).map((declaration) => ({ owner: module.id, declaration })),
);

export const FACTS: readonly DoctrineFact[] = modules.flatMap((module) => module.facts ?? []);

export const BEHAVIOUR_REGISTRY: BehaviourRegistry = registerBehaviours(BEHAVIOURS.collect(modules), new Set(OPERATION_IDS));

export const BUILTIN_NOTE_ENTRIES: readonly BuiltinNote[] = BUILTIN_NOTES.collect(modules).map(({ entry }) => entry);

export const NATIVE_AGENT_RULES = NATIVE_RULES.collect(modules);

export const ENTRY_KINDS: ThreadEntryReader = makeThreadEntryReader({
  products: modules.flatMap((module) => module.entryKinds ?? []),
  steps: journalSteps(modules.map((module) => module.formSteps ?? [])),
  base: JOURNAL_BASE,
});

export const COLLECTED_SETTINGS: {
  readonly sections: readonly SettingSectionDeclaration[];
  readonly keys: readonly SettingKey<unknown>[];
} = {
  sections: modules.flatMap((module) => module.settingSections ?? []),
  keys: modules.flatMap((module) => module.settings ?? []),
};

export const snapshotParticipants = (home: SnapshotHome): Effect.Effect<Readonly<Record<string, SnapshotParticipant>>> =>
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

type DriversOf<M> = M extends { readonly drivers: readonly (infer D extends { readonly id: string })[] } ? D['id'] : never;

export type DriverId = DriversOf<(typeof MODULES)[number]>;

export const DRIVERS: ReadonlySet<string> = new Set(modules.flatMap((module) => (module.drivers ?? []).map(({ id }) => id)));

type FeedsOf<M> = M extends { readonly live: { readonly feeds: readonly (infer F)[] } } ? F : never;

export type LiveFeed = FeedsOf<(typeof MODULES)[number]>;

export const COLLECTED_FEEDS: readonly LiveFeed[] = MODULES.flatMap((module): readonly LiveFeed[] =>
  'live' in module ? module.live.feeds : [],
);

export type CollectedOperations = {
  readonly modules: readonly DeclaredOperations[];
  readonly declarations: readonly OperationDeclaration[];
  readonly tables: readonly { readonly title: string; readonly declarations: readonly OperationDeclaration[] }[];
  readonly journaled: ReadonlySet<string>;
};

const collect = (loaded: readonly DeclaredOperations[]): CollectedOperations => ({
  modules: loaded,
  declarations: loaded.flatMap((module) => module.declarations),
  tables: loaded.flatMap(({ module, declarations: own }) =>
    own.length === 0 ? [] : [{ title: module.title ?? module.id, declarations: own }],
  ),
  journaled: new Set(loaded.flatMap((module) => [...module.journaled])),
});

export const subjectPlaces: Effect.Effect<ReadonlyMap<SubjectKind, SubjectPlace>> = Effect.map(
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

export const collectedOperations: Effect.Effect<CollectedOperations> = Effect.runSync(
  Effect.cached(Effect.map(operationsOf(modules), collect)),
);
