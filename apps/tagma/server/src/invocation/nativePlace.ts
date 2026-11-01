import { Context, Effect } from 'effect';
import type { ToolCaller } from '@runlith/agent/contracts';
import type { NativeCall } from './contract/service/nativeCall.js';
import type { Operation } from '../platform/contract/wire/operation.js';
import type { ErasedBound } from './contract/service/catalog.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { CurrentGraph, RefusedGraph, GraphScopes } from '../graph/contract/service/serving.js';
import { Tags } from '../graph/contract/service/vocabulary.js';
import { MachineStore } from '../platform/contract/service/store.js';
import type { Place } from '../platform/contract/wire/place.js';
import { CallPlace } from '../platform/contract/service/place.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { callServices, onPlace, type CallFacts } from './admission/services.js';
import { factsAt, operationFacts, placedContext } from './admission/place.js';
import { unopenedGraph } from './admission/project.js';
import { recordedPlace, recordPlace, type PlaceKey } from './admission/receipts.js';
import { admitOperation } from './admission/callers.js';
import type { GraphServices } from '../graph/contract/service/services.js';
import type { OperationChecks } from './contract/service/operationChecks.js';
import type { CallServices } from './contract/service/admission.js';
import type { DynamicOperationFailure } from './contract/service/refusals.js';

export type NativePreparation = {
  readonly facts: CallFacts;
  readonly context: Context.Context<any>;
  readonly value: unknown;
  readonly place: Place | null;
  readonly unopened: GateRefusal<'not-served'> | null;
};

export const callerAt = (ambient: Caller, called: ToolCaller): Caller => {
  const actor = ambient.actor;
  if (actor.kind !== 'thread' || called.thread === null) return ambient;
  return {
    ...ambient,
    actor: {
      ...actor,
      threadId: called.thread.threadId,
      principalId: called.ownerId,
      session: { ...actor.session, key: called.thread.threadId },
    },
  };
};

export const nativePlacement = <Owners>(ctx: NativeCall<Owners>) => {
  const base = (caller: Caller, owners: Context.Context<Owners | GraphServices>, runId: string | null): CallFacts => {
    const served = Context.get(owners, CurrentGraph) ?? ctx.served;
    const refused = Context.get(owners, RefusedGraph) ?? ctx.refused;
    return {
      caller,
      request: {
        session: caller.actor.kind === 'operator' || caller.actor.kind === 'external' ? null : caller.actor.session,
        project: undefined,
        cwd: undefined,
        branch: undefined,
        scope: undefined,
      },
      place: ctx.place,
      target: {
        projectId: ctx.project.id,
        checkout: served?.checkout ?? (refused === undefined ? null : (ctx.place?.root ?? null)),
        branch: null,
      },
      world: ctx.world,
      standing: ctx.standing === undefined ? null : { ...ctx.standing, runId },
      served: served ?? null,
      refused: refused ?? null,
      project: Effect.succeed({ project: ctx.project }),
      graph: Effect.map(
        served === undefined ? Effect.succeed(ctx.vocabulary()) : Context.get(served.context, Tags).of(ctx.project.id),
        (vocabulary) => ({
          project: ctx.project,
          vocabulary,
          lens: { scope: undefined, names: 'every-served-project' as const },
          deliveredTags: undefined,
        }),
      ).pipe(Effect.mapError((failure) => new GateRefusal('graph-pool', failure.message, ['read the graph again']))),
      scopes: served === undefined ? null : Context.get(served.context, GraphScopes),
      door: { key: null },
    };
  };
  const same = (place: Place | null | undefined, target: Place): boolean =>
    place !== null &&
    place !== undefined &&
    place.projectId === target.projectId &&
    place.checkout === target.checkout &&
    place.branch === target.branch;
  const keyOf = (facts: CallFacts, operation: string, key: string): PlaceKey | null =>
    facts.caller.actor.kind === 'thread' ? { threadId: facts.caller.actor.threadId, operation, key } : null;

  type Services = Owners | GraphServices | OperationCatalog | OperationChecks | CallServices;
  const resolve = Effect.fnUntraced(function* (
    id: string,
    entry: Operation,
    bound: ErasedBound<Services>,
    input: unknown,
    called: ToolCaller,
    key: string,
    prepare: boolean,
  ): Effect.fn.Return<NativePreparation, DynamicOperationFailure> {
    const owners = yield* ctx.owners;
    const initial = base(callerAt(ctx.caller, called), owners, called.thread?.runId ?? null);
    const lifetimes = placedContext(Context.add(owners, OperationCatalog, ctx.catalog));
    const context = Context.merge(lifetimes, callServices(initial));
    const identity = keyOf(initial, id, key);
    const unopened = unopenedGraph(id, entry);
    const store = entry.mutates === true || bound.settle !== undefined ? Context.getOrUndefined(context, MachineStore) : undefined;
    const pinned = identity === null || store === undefined ? null : yield* recordedPlace(store, identity);
    let facts =
      pinned === null
        ? yield* operationFacts(entry, { ...bound, id }, input, initial, context)
        : same(initial.target, pinned)
          ? initial
          : yield* Effect.provide(factsAt(initial, pinned, unopened), context);
    if (pinned !== null) {
      facts = { ...facts, request: { ...facts.request, project: String(pinned.projectId) } };
      if (prepare) {
        facts = yield* operationFacts(entry, { ...bound, id }, input, facts, Context.merge(lifetimes, callServices(facts)));
        const selected = Context.get(callServices(facts), CallPlace);
        if (!same(selected, pinned))
          return yield* new GateRefusal('place-mismatch', 'This call key already names another checkout.', [
            'start a new call for the new subject',
          ]);
      }
    }
    let services = Context.merge(lifetimes, callServices(facts));
    let place = Context.get(services, CallPlace);
    if (prepare && identity !== null && store !== undefined && place !== null && place.checkout !== null && pinned === null) {
      const recorded = yield* recordPlace(store, identity, place);
      if (!same(recorded, place))
        return yield* new GateRefusal('place-mismatch', 'This call key already names another checkout.', [
          'start a new call for the new subject',
        ]);
    }
    yield* Effect.provide(admitOperation(id, facts.caller), services);
    const actor = facts.caller.actor;
    const checkout = facts.served?.checkout ?? place?.checkout;
    if (
      prepare &&
      ctx.places !== undefined &&
      actor.kind === 'thread' &&
      place !== null &&
      checkout != null &&
      (facts.served !== null || (entry.mutates === true && place.projectId !== actor.projectId))
    ) {
      yield* ctx.places.enter({
        threadId: actor.threadId,
        home: actor.projectId,
        place: { projectId: place.projectId, root: checkout },
        mutates: entry.mutates === true,
        toolCallId: key,
      });
    }
    const value =
      !prepare || bound.prepare === undefined
        ? undefined
        : yield* Effect.provide(onPlace(bound.prepare(facts.bodyInput ?? input, facts.caller)), services);
    return { facts, context: lifetimes, value, place, unopened } satisfies NativePreparation;
  });

  const refresh = Effect.fnUntraced(function* (prepared: NativePreparation): Effect.fn.Return<NativePreparation, DynamicOperationFailure> {
    const owners = yield* ctx.owners;
    const initial = base(prepared.facts.caller, owners, prepared.facts.standing?.runId ?? null);
    const lifetimes = placedContext(Context.add(owners, OperationCatalog, ctx.catalog));
    const current =
      prepared.place === null || same(initial.target, prepared.place)
        ? initial
        : yield* Effect.provide(factsAt(prepared.facts, prepared.place, prepared.unopened), lifetimes);
    return {
      ...prepared,
      context: lifetimes,
      facts: {
        ...prepared.facts,
        project: current.project,
        graph: current.graph,
        graphContext: current.graphContext,
        served: current.served,
        refused: current.refused,
        scopes: current.scopes,
      },
    };
  });

  const serve = <A, E>(
    prepared: NativePreparation,
    key: string | null,
    work: Effect.Effect<A, E, Services>,
    stage?: (detail: string) => void,
  ): Effect.Effect<A, E> => {
    const facts = { ...prepared.facts, door: { ...prepared.facts.door, key, stage } };
    return Effect.provide(onPlace(work), Context.merge(prepared.context, callServices(facts)));
  };
  return { resolve, refresh, serve };
};
