import { Context, Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { type OpenRefusal, GateRefusal, refusalBody } from '../../platform/contract/wire/refusal.js';
import { Act, BlockAnswers, BlockNames, BlockProjection, BlockReferences } from '../contract/service/acts.js';
import { InstalledCatalogs } from '../contract/service/vocabulary.js';
import { CatalogGraph } from '../vocabulary/install.js';
import { Documents, Batch, Reflections, Supersession, Tasks } from '../contract/service/work.js';
import { Blocks, Edges, Trash } from '../contract/service/blocks.js';
import { Digest } from '../contract/service/orientation.js';
import { Sources } from '../contract/service/sources.js';
import { GraphFeed } from '../contract/service/journal.js';
import { BlockReads, History, Ranking, Selection, type BlockTitle } from '../contract/service/reads.js';
import { GraphJournal } from '../contract/service/journal.js';
import { Orientation } from '../contract/service/orientation.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { GraphScopes } from '../contract/service/serving.js';
import { Tags } from '../contract/service/vocabulary.js';
import { SourceProject } from '../contract/service/source.js';
import { Touches } from '../contract/service/orientation.js';
import { type MachineContext, withoutRegistry } from './machine.js';
import { CallerAim } from '../../platform/contract/service/place.js';
import { CurrentGraph, RefusedGraph, RoutedGraphs, type ServedGraphs, type ServedGraph } from '../contract/service/serving.js';
import type { GraphServices } from '../contract/service/services.js';
import type { LocatedTitle, TitleReading, UnreadableCopy } from '../contract/wire/titles.js';
import { blockIdentity, blockName } from '../contract/wire/references.js';
import type { CopyFailure } from '../contract/wire/answers.js';
import { refused } from './refusal.js';
import { ambiguousAcross } from './ambiguity.js';

export const FreshenedGraphs = Context.Reference<Set<string> | null>('tagma/graph/FreshenedGraphs', {
  defaultValue: () => null,
});

const freshOnce = Effect.fnUntraced(function* (served: ServedGraph) {
  const freshened = yield* FreshenedGraphs;
  if (freshened === null) return yield* served.fresh();
  if (freshened.has(served.layout.treeRoot)) return;
  yield* served.fresh();
  freshened.add(served.layout.treeRoot);
});

const resolveServed = Effect.fnUntraced(function* (pool: ServedGraphs['Service'], projectId: number) {
  const aim = yield* CallerAim;
  return yield* pool.resolve({ projectId, cwd: aim?.cwd, branch: aim?.branch });
});

const servedCatalogWriter = Effect.fn('GraphRouting.catalogWriter')(function* (pool: ServedGraphs['Service'], projectId: number) {
  const current = yield* CurrentGraph;
  const served = current !== null && current.projectId === projectId ? current : yield* resolveServed(pool, projectId);
  yield* freshOnce(served);
  const install = Context.get(served.context, CatalogGraph);
  if (install === null) {
    return yield* new GateRefusal('graph-pool', `served graph ${projectId} exposes no catalog writer`, [
      'resolve the project again — a served graph is built with its catalog writer',
    ]);
  }
  return yield* install(projectId);
});

export const titlesAcross = Effect.fn('GraphPool.titlesAcross')(function* (
  names: readonly string[],
): Effect.fn.Return<TitleReading, GateRefusal | StoreFailure, Selection | Projects> {
  const missing = new Set(names);
  const found: LocatedTitle[] = [];
  const unreadable: UnreadableCopy[] = [];
  const copyFailures: CopyFailure[] = [];
  type Candidate = BlockTitle & { readonly branch?: string | null };
  const accept = Effect.fnUntraced(function* (rows: readonly Candidate[]) {
    const matches = new Map<string, Map<string, Candidate>>();
    for (const row of rows) {
      let candidates = matches.get(row.name);
      if (candidates === undefined) {
        candidates = new Map();
        matches.set(row.name, candidates);
      }
      const key = `${row.projectId}:${row.uuid}`;
      if (!candidates.has(key)) candidates.set(key, row);
    }
    for (const [name, candidates] of matches) {
      if (candidates.size > 1) return yield* ambiguousAcross(name, [...candidates.values()]);
      const row = candidates.values().next().value!;
      found.push({
        name: row.name,
        shortName: blockName(row.uuid),
        identity: blockIdentity(row.uuid),
        rowKey: row.rowKey,
        title: row.title,
        projectId: row.projectId,
        branch: row.branch,
      });
      missing.delete(name);
    }
  });
  const current = yield* CurrentGraph;
  const record = Effect.fn('GraphPool.titlesAcross.record')(function* <R>(
    projectId: number,
    checkout: string,
    branch: string | null,
    asked: readonly string[],
    read: Effect.Effect<readonly Candidate[], GateRefusal, R>,
  ) {
    const answer = yield* Effect.result(read);
    if (answer._tag === 'Success') return answer.success;
    const error = answer.failure;
    unreadable.push({
      projectId,
      checkout,
      branch,
      names: [...asked],
      error: refusalBody(error),
    });
    return [];
  });
  const addFailures = (reported: readonly CopyFailure[]) => {
    for (const failure of reported) {
      if (!copyFailures.some((known) => known.copy.tree === failure.copy.tree)) copyFailures.push(failure);
    }
  };
  const report = (): TitleReading => ({
    titles: found,
    unreadable,
    copyFailures: copyFailures.length === 0 ? undefined : copyFailures,
  });
  const selection = yield* Selection;
  yield* accept(
    current === null
      ? yield* selection.titles([...missing])
      : yield* record(current.projectId, current.checkout, (yield* CallerAim)?.branch ?? null, names, refused(selection.titles(names))),
  );
  if (current !== null) {
    const own = yield* Effect.result(current.copyFailures());
    if (own._tag === 'Success') addFailures(own.success);
    else {
      unreadable.push({
        projectId: current.projectId,
        checkout: current.checkout,
        branch: (yield* CallerAim)?.branch ?? null,
        names: [...names],
        error: refusalBody(own.failure),
      });
    }
  }
  const pool = yield* RoutedGraphs;
  if (missing.size === 0 || pool === null) return report();
  const indexed = Effect.fnUntraced(function* (projectIds: readonly number[]) {
    const reading = yield* pool.titles({ projectIds, names: [...missing], excluding: current?.layout.treeRoot });
    unreadable.push(...reading.unreadable);
    return reading.titles.filter((row) => !row.trashed);
  });
  if (current !== null) {
    yield* accept(yield* indexed([current.projectId]));
    if (missing.size === 0) return report();
  }
  const projects = yield* Projects;
  const listed = yield* projects.list();
  const global = yield* projects.global();
  const targets = global === undefined || listed.some((project) => project.id === global.id) ? listed : [...listed, global];
  yield* accept(yield* indexed(targets.flatMap((project) => (project.id === current?.projectId ? [] : [project.id]))));
  return report();
});

export const ROUTED = [
  Act,
  Documents,
  Batch,
  BlockAnswers,
  BlockNames,
  BlockProjection,
  BlockReferences,
  Blocks,
  InstalledCatalogs,
  Digest,
  Edges,
  Sources,
  GraphFeed,
  GraphScopes,
  History,
  GraphJournal,
  Orientation,
  Ranking,
  BlockReads,
  Reflections,
  Selection,
  SourceProject,
  WriterRegister,
  Supersession,
  Tags,
  Tasks,
  Touches,
  Trash,
] as const;

type AnyService = Record<string, unknown>;

const delegate = Effect.fnUntraced(function* (
  machine: Context.Context<GraphServices>,
  tag: Context.Key<never, unknown>,
  prop: string,
  args: unknown[],
) {
  const current = yield* CurrentGraph;
  if (current === null) {
    const refused = yield* RefusedGraph;
    if (refused !== null) return yield* refused;
  }
  if (current !== null) yield* freshOnce(current);
  const service = Context.get(current?.context ?? machine, tag as Context.Key<never, AnyService>) as AnyService;
  const out = (service[prop] as (...inner: unknown[]) => unknown)(...args);
  if (!Effect.isEffect(out)) return out;
  const effect = out as Effect.Effect<unknown, unknown, never>;
  if (current === null) return yield* effect;
  return yield* Effect.provide(effect, current.context);
});

function routedService<Id, S extends object>(machine: Context.Context<GraphServices>, tag: Context.Key<Id, S>): S {
  const held = Context.get(machine, tag as Context.Key<never, S>) as AnyService;
  return new Proxy(held as S, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      const member = held[prop];
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => delegate(machine, tag as Context.Key<never, unknown>, prop, args);
    },
  });
}

export function routedSeams(machine: Context.Context<GraphServices>, pool?: ServedGraphs['Service']): Context.Context<never> {
  let context: Context.Context<never> = Context.empty();
  for (const tag of ROUTED) {
    const seam = routedService(machine, tag as unknown as Context.Key<never, object>);
    context = Context.add(context, tag as unknown as Context.Key<never, object>, seam);
  }
  if (pool !== undefined) {
    context = Context.add(context, RoutedGraphs, pool);
    context = Context.add(context, CatalogGraph, (projectId) => servedCatalogWriter(pool, projectId));
  }
  return context;
}

const places = new WeakMap<ServedGraph, Context.Context<never>>();

export const placeContext = (served: ServedGraph, pool: ServedGraphs['Service'] | null): Context.Context<never> => {
  const known = places.get(served);
  if (known !== undefined) return known;
  const own: Context.Context<never> = withoutRegistry(served.context);
  const place: Context.Context<never> = Context.merge(own, routedSeams(served.context, pool ?? undefined));
  places.set(served, place);
  return place;
};

export function routedContext(machine: MachineContext, pool?: ServedGraphs['Service']): MachineContext {
  return Context.merge(machine, routedSeams(machine, pool));
}
