import type { Table } from 'drizzle-orm';
import { Data, Effect, Layer, type Context } from 'effect';
import type { EndpointDeclaration, FeedDeclaration, OperationDeclaration } from '../wire/operation.js';
import type { FeedHandlers } from '../wire/live.js';
import type { DoctrineFact, DoctrineSection } from '../wire/section.js';
import type { OperationId } from '../wire/ids.js';
import type { SettingControl, SettingKey, SettingSectionDeclaration } from '../wire/setting.js';
import { type OperationPair, OperationPairInvalid } from './body.js';
import type { Contribution } from '../wire/contribution.js';
import type { CapabilityDeclaration } from '../wire/capability.js';
import type { SnapshotHome, SnapshotParticipant } from './snapshots.js';
import type { SubjectPlace } from './place.js';
import type { OwnStore } from './ownStore.js';
import type { Machine } from './capacity.js';
import type { ThreadEntryKind, ThreadFormStep } from '@runlith/agent/transcript/kinds';
import type { PoolDeclaration } from '@runlith/held/Capacity';

import { journaledOf, type OperationSet, type RefusalWords } from '../wire/manifest.js';
import type { ModulePresentation } from './presentation.js';

export type SettingControlSource<R> = {
  readonly id: string;
  readonly read: (context: Context.Context<R>) => SettingControl;
};

export type Manifest = {
  readonly id: string;
  readonly title?: string;
  readonly journaled?: true;
  readonly operations?: () => Promise<OperationSet>;
  readonly bodies?: () => Promise<readonly OperationPair[]>;
  readonly presentation?: () => Promise<ModulePresentation<any>>;
  readonly subjects?: () => Promise<readonly SubjectPlace[]>;
  readonly verbs?: (...bindings: never[]) => Readonly<Record<string, () => Promise<Record<string, unknown>>>>;
  readonly feeds?: readonly FeedDeclaration[];
  readonly live?: {
    readonly feeds: readonly FeedDeclaration[];
    readonly handlers: (door: Context.Context<any>) => Effect.Effect<object>;
  };
  readonly endpoints?: readonly EndpointDeclaration[];
  readonly settings?: readonly SettingKey<any>[];
  readonly settingSections?: readonly SettingSectionDeclaration[];
  readonly settingControls?: readonly SettingControlSource<any>[];
  readonly sections?: readonly DoctrineSection[];
  readonly facts?: readonly DoctrineFact[];
  readonly tables?: () => Promise<{ readonly entities: readonly Table[]; readonly history: readonly Table[] }>;
  readonly retiredTables?: readonly string[];
  readonly stores?: readonly OwnStore[];

  readonly formSteps?: readonly ThreadFormStep[];
  readonly pools?: (machine: Machine) => readonly PoolDeclaration[];
  readonly snapshots?: (home: SnapshotHome) => Promise<SnapshotParticipant>;
  readonly lifetimes?: {
    readonly preparation?: Layer.Layer<never, any>;
    readonly installation?: Layer.Any;
    readonly workspace?: Layer.Any;
    readonly serving?: Layer.Any;
    readonly afterRecovery?: Layer.Layer<never, any, any>;
    readonly run?: Layer.Any;
    readonly call?: (input: never) => Context.Context<never>;
  };
  readonly capabilities?: readonly CapabilityDeclaration[];
  readonly hooks?: readonly Identified[];
  readonly providers?: readonly Identified[];
  readonly agents?: readonly Identified[];
  readonly resources?: readonly Identified[];
  readonly gauges?: readonly Identified[];
  readonly passes?: readonly Identified[];
  readonly drivers?: readonly Identified[];
  readonly contributions?: readonly Contribution[];
  readonly entryKinds?: readonly ThreadEntryKind[];
};

type Identified = { readonly id: string };

const COLLECTIONS = [
  'feeds',
  'endpoints',
  'settings',
  'settingSections',
  'settingControls',
  'sections',
  'facts',
  'capabilities',
  'hooks',
  'providers',
  'agents',
  'resources',
  'gauges',
  'passes',
  'drivers',
  'stores',
] as const;
type Collection = (typeof COLLECTIONS)[number];

type RepeatedIds<Entries extends readonly Identified[], Seen extends string = never> = Entries extends readonly [
  infer First extends Identified,
  ...infer Rest extends readonly Identified[],
]
  ? string extends First['id']
    ? RepeatedIds<Rest, Seen>
    : OperationId extends First['id']
      ? RepeatedIds<Rest, Seen>
      : First['id'] extends Seen
        ? First['id']
        : RepeatedIds<Rest, Seen | First['id']>
  : never;

export type UniqueIds<Entries extends readonly Identified[]> = [RepeatedIds<Entries>] extends [never]
  ? unknown
  : { readonly duplicateId: RepeatedIds<Entries> };

type Entries<M, Key extends Collection> = Key extends 'feeds'
  ? M extends { readonly live: { readonly feeds: infer Values extends readonly Identified[] } }
    ? Values
    : []
  : M extends { readonly [K in Key]: infer Values extends readonly Identified[] }
    ? Values
    : [];

type RepeatedManifest<M> = { [K in Collection]: RepeatedIds<Entries<M, K>> }[Collection];

type UniqueManifest<M> = ([UnknownFields<M>] extends [never] ? unknown : { readonly unknownFields: UnknownFields<M> }) &
  ([RepeatedManifest<M>] extends [never] ? unknown : { readonly duplicateId: RepeatedManifest<M> });

type Gather<
  Modules extends readonly Manifest[],
  Key extends Collection,
  Gathered extends readonly Identified[] = [],
> = Modules extends readonly [infer First extends Manifest, ...infer Rest extends readonly Manifest[]]
  ? Gather<Rest, Key, [...Gathered, ...Entries<First, Key>]>
  : Gathered;

type RepeatedManifests<Modules extends readonly Manifest[]> =
  | RepeatedIds<Modules>
  | { [K in Collection]: RepeatedIds<Gather<Modules, K>> }[Collection];

type UnknownFields<M> = M extends Manifest
  ?
      | Exclude<keyof M, keyof Manifest>
      | (M extends { readonly lifetimes: infer Lifetimes } ? Exclude<keyof Lifetimes, keyof NonNullable<Manifest['lifetimes']>> : never)
  : never;

type UniqueManifests<Modules extends readonly Manifest[]> = ([UnknownFields<Modules[number]>] extends [never]
  ? unknown
  : { readonly unknownFields: UnknownFields<Modules[number]> }) &
  ([RepeatedManifests<Modules>] extends [never] ? unknown : { readonly duplicateId: RepeatedManifests<Modules> });

export class ManifestConflict extends Data.TaggedError('ManifestConflict')<{
  readonly collection: Collection | 'modules' | 'operations' | 'contributions' | 'refusals';
  readonly id: string;
  readonly point?: string;
  readonly owners: readonly [string, string];
}> {}

function checkManifests(modules: readonly Manifest[]): void {
  const names = new Set<string>();
  const entries = new Map<Collection, Map<string, string>>(COLLECTIONS.map((collection) => [collection, new Map()]));
  const contributed = new Map<string, Map<string, string>>();
  for (const module of modules) {
    for (const { point, id } of module.contributions ?? []) {
      const owners = contributed.get(point) ?? new Map<string, string>();
      contributed.set(point, owners);
      const owner = owners.get(id);
      if (owner !== undefined) throw new ManifestConflict({ collection: 'contributions', id, point, owners: [owner, module.id] });
      owners.set(id, module.id);
    }
    if (names.has(module.id)) throw new ManifestConflict({ collection: 'modules', id: module.id, owners: [module.id, module.id] });
    names.add(module.id);
    if (module.feeds !== undefined || module.live !== undefined) servesDeclared(module.id, module.feeds ?? [], module.live?.feeds ?? []);
    for (const collection of COLLECTIONS) {
      const owners = entries.get(collection)!;
      for (const entry of (collection === 'feeds' ? module.live?.feeds : module[collection]) ?? []) {
        const owner = owners.get(entry.id);
        if (owner !== undefined) throw new ManifestConflict({ collection, id: entry.id, owners: [owner, module.id] });
        owners.set(entry.id, module.id);
      }
    }
  }
}

class LiveFeedsUnmatched extends Data.TaggedError('LiveFeedsUnmatched')<{
  readonly module: string;
  readonly unserved: readonly string[];
  readonly undeclared: readonly string[];
}> {
  override get message(): string {
    return `${this.module}: feeds its wire declares and its live does not serve (${this.unserved.join(', ')}), feeds its live serves and its wire does not declare (${this.undeclared.join(', ')})`;
  }
}

function servesDeclared(module: string, declared: readonly FeedDeclaration[], served: readonly FeedDeclaration[]): void {
  const servedIds = new Set(served.map((feed) => feed.id));
  const declaredIds = new Set(declared.map((feed) => feed.id));
  const unserved = [...declaredIds].filter((id) => !servedIds.has(id));
  const undeclared = [...servedIds].filter((id) => !declaredIds.has(id));
  if (unserved.length > 0 || undeclared.length > 0) throw new LiveFeedsUnmatched({ module, unserved, undeclared });
}

type Kept = 'id' | 'title' | 'journaled' | 'verbs' | 'live' | 'lifetimes' | Exclude<Collection, 'feeds'>;

export function manifest<const M extends Manifest>(
  declaration: M & UniqueManifest<M> & Record<Exclude<keyof M, keyof Manifest>, never>,
): Omit<Manifest, Kept> & { readonly [K in keyof M & Kept]: M[K] } {
  checkManifests([declaration]);
  return declaration;
}

export function manifests<const Modules extends readonly Manifest[]>(...modules: Modules & UniqueManifests<Modules>): Modules {
  checkManifests(modules);
  return modules;
}

export class ManifestBodiesUnmatched extends Data.TaggedError('ManifestBodiesUnmatched')<{
  readonly module: string;
  readonly undeclared: readonly string[];
  readonly unbodied: readonly string[];
}> {
  override get message(): string {
    return `${this.module}: bodies without their declaration (${this.undeclared.join(', ')}), declarations without a body (${this.unbodied.join(', ')})`;
  }
}

export type DeclaredOperations = {
  readonly module: Manifest;
  readonly declarations: readonly OperationDeclaration[];
  readonly journaled: ReadonlySet<string>;
  readonly refusals: RefusalWords;
};

const unique = (loaded: readonly DeclaredOperations[]): readonly DeclaredOperations[] => {
  const owners = new Map<string, string>();
  for (const { module, declarations } of loaded) {
    for (const { id } of declarations) {
      const owner = owners.get(id);
      if (owner !== undefined) throw new ManifestConflict({ collection: 'operations', id, owners: [owner, module.id] });
      owners.set(id, module.id);
    }
  }
  return loaded;
};

export const operationsOf = (modules: readonly Manifest[]): Effect.Effect<readonly DeclaredOperations[]> =>
  Effect.map(
    Effect.forEach(
      modules,
      (module): Effect.Effect<DeclaredOperations> =>
        module.operations === undefined
          ? Effect.succeed({ module, declarations: [], journaled: new Set<string>(), refusals: {} })
          : Effect.map(Effect.promise(module.operations), (set) => ({
              module,
              declarations: Object.values(set.declarations),
              journaled: journaledOf(module.journaled, set),
              refusals: set.refusals ?? {},
            })),
      { concurrency: 'unbounded' },
    ),
    unique,
  );

const matched = ({ module, declarations }: DeclaredOperations, pairs: readonly OperationPair[]): readonly OperationPair[] => {
  for (const entry of pairs) {
    if (entry.declaration !== entry.body.declaration || entry.id !== entry.declaration.id) {
      throw new OperationPairInvalid({ declaration: entry.id, body: entry.body.declaration.id });
    }
  }
  const declared = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  const undeclared = pairs.filter((entry) => declared.get(entry.id) !== entry.declaration).map((entry) => entry.id);
  const bodied = new Set(pairs.map((entry) => entry.id));
  const unbodied = [...declared.keys()].filter((id) => !bodied.has(id));
  if (undeclared.length > 0 || unbodied.length > 0) throw new ManifestBodiesUnmatched({ module: module.id, undeclared, unbodied });
  return pairs;
};

export const bodiesOf = (declared: DeclaredOperations): Effect.Effect<readonly OperationPair[]> => {
  const load = declared.module.bodies;
  return load === undefined ? Effect.succeed(matched(declared, [])) : Effect.map(Effect.promise(load), (pairs) => matched(declared, pairs));
};

export class RefusalsUnphrased extends Data.TaggedError('RefusalsUnphrased')<{
  readonly unphrased: readonly { readonly module: string; readonly codes: readonly string[] }[];
}> {
  override get message(): string {
    return `refusal codes no module gives words for: ${this.unphrased.map(({ module, codes }) => `${module} (${codes.join(', ')})`).join('; ')}`;
  }
}

export const refusalWordsOf = (loaded: readonly DeclaredOperations[], base: RefusalWords): RefusalWords => {
  const words: Record<string, string> = { ...base };
  const owners = new Map<string, string>(Object.keys(base).map((code) => [code, 'platform']));
  for (const { module, refusals } of loaded) {
    for (const [code, said] of Object.entries(refusals)) {
      const owner = owners.get(code);
      if (owner !== undefined) throw new ManifestConflict({ collection: 'refusals', id: code, owners: [owner, module.id] });
      owners.set(code, module.id);
      words[code] = said;
    }
  }
  const unphrased = loaded.flatMap(({ module, declarations }) => {
    const codes = [...new Set(declarations.flatMap((declaration) => declaration.refusals))].filter((code) => !Object.hasOwn(words, code));
    return codes.length === 0 ? [] : [{ module: module.id, codes }];
  });
  if (unphrased.length > 0) throw new RefusalsUnphrased({ unphrased });
  return words;
};

export class PresentationUndeclared extends Data.TaggedError('PresentationUndeclared')<{
  readonly module: string;
  readonly undeclared: readonly string[];
}> {
  override get message(): string {
    return `${this.module} presents operations it does not declare: ${this.undeclared.join(', ')}`;
  }
}

export const presentationsOf = ({
  module,
  declarations,
}: DeclaredOperations): Effect.Effect<ReadonlyMap<string, ModulePresentation<any>>> => {
  const load = module.presentation;
  if (load === undefined) return Effect.succeed(new Map());
  return Effect.map(Effect.promise(load), (presentation) => {
    const declared = new Set<string>(declarations.map((declaration) => declaration.id));
    const named = presentation.operations ?? [...declared];
    const undeclared = named.filter((id) => !declared.has(id));
    if (undeclared.length > 0) throw new PresentationUndeclared({ module: module.id, undeclared });
    return new Map(named.map((id) => [id, presentation]));
  });
};

export type LiveDeclaration<Feeds extends readonly FeedDeclaration[], R> = {
  readonly feeds: Feeds;
  readonly handlers: (door: Context.Context<R>) => Effect.Effect<FeedHandlers<Feeds[number]>>;
};

export const liveOf = <const Feeds extends readonly FeedDeclaration[], R>(
  feeds: Feeds,
  handlers: (door: Context.Context<R>) => FeedHandlers<Feeds[number]> | Promise<FeedHandlers<Feeds[number]>>,
): LiveDeclaration<Feeds, R> => ({ feeds, handlers: (door) => Effect.promise(async () => handlers(door)) });

export const lazyLayer = <M, A, E, R>(load: () => Promise<M>, pick: (module: M) => Layer.Layer<A, E, R>): Layer.Layer<A, E, R> =>
  Layer.unwrap(Effect.map(Effect.promise(load), pick));
