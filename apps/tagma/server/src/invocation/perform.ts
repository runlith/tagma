import { Context, Effect, Option, Schema } from 'effect';
import { rootCost } from '@runlith/performance/CostLedger';
import type { Caller } from '../platform/contract/wire/caller.js';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { knownAnswer, type Operation } from '../platform/contract/wire/operation.js';
import { toJson } from '@runlith/utils/json';
import type { OperationId } from '../platform/contract/wire/ids.js';
import type { Outcome } from './contract/wire/headers.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { CallRequest, CallStanding, CallWorld, type ServedCall } from './contract/service/admission.js';
import { CallAuthority } from '../platform/contract/service/authority.js';
import { CallPlace } from '../platform/contract/service/place.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { CurrentGraph, RefusedGraph, GraphCall, GraphScopes } from '../graph/contract/service/serving.js';
import { SignedCall } from '../platform/contract/service/writers.js';
import { projectRequired } from './admission/actor.js';
import type { CallFacts } from './admission/services.js';
import { CallerWorkspace } from '../workspace/contract/service/places.js';
import type { Bound } from '../platform/contract/service/body.js';
import { OperationChecks } from './contract/service/operationChecks.js';
import { OperationCatalog, type ErasedBound } from './contract/service/catalog.js';
import type { DynamicOperationFailure } from './contract/service/refusals.js';
import type { Call } from './contract/service/call.js';
import { onPlace, callServices, PlacedCall } from './admission/services.js';
import { addressedThread, operationFacts, placedContext } from './admission/place.js';
import { judged } from './approval.js';
import { admitCaller, admitOperation } from './admission/callers.js';
import { admitPlugin } from './admission/plugin.js';
import { callDefected, caused, type CallStand } from './cause.js';
import { WorkPlaces } from '../threads/contract/service/working.js';
import { NativeStorage } from '../threads/contract/service/engine.js';
import { HarnessGuidance } from '../external-harnesses/contract/service/guidance.js';
import { Orientation } from '../graph/contract/service/orientation.js';
import { instructionText } from '../graph/orientation/Instructions.js';
import {
  OperationPerformer,
  type CallNeeds,
  type CallSite,
  type InvocationLifetime,
  type OwnerContext,
  type Performed,
  type Shaped,
} from './contract/service/performer.js';
import { answerDisplay, presentationOf, voiced } from './presentation.js';
import { journaled } from './journaled.js';

export const prepare = <Input, Prepared, Answer, R, E>(
  bound: Bound<Input, Prepared, Answer, R, E>,
  input: NoInfer<Input>,
  caller: Caller,
): Effect.Effect<Prepared, E, R> => (bound.prepare === undefined ? Effect.succeed(undefined as Prepared) : bound.prepare(input, caller));

export const execute = <Input, Prepared, Answer, R, E>(
  bound: Bound<Input, Prepared, Answer, R, E>,
  input: NoInfer<Input>,
  prepared: Prepared,
  caller: Caller,
): Effect.Effect<Answer, E, R> => bound.execute(input, prepared, caller);

export const triggered = <A, E, R>(
  id: string,
  caller: Caller,
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | GateRefusal | StoreFailure, R | OperationChecks | OperationCatalog> =>
  Effect.flatMap(OperationCatalog, (catalog) => {
    const actor = caller.actor;
    const named = catalog.registry.named(id);
    const mutates = named !== null && catalog.registry.entry(named).mutates === true;
    const done = caused(id, caller, body);
    const work = actor.kind === 'thread' && mutates ? Effect.tap(done, () => acted(actor.threadId, actor.projectId)) : done;
    if (catalog.checks(id) !== 'head' || actor.kind === 'operator' || actor.kind === 'external') return work;
    return Effect.flatMap(OperationChecks, (checks) => checks.run(id, actor, work));
  });

const acted = Effect.fnUntraced(function* (threadId: string, home: number) {
  const places = yield* Effect.serviceOption(WorkPlaces);
  if (Option.isNone(places)) return;
  const served = yield* CurrentGraph;
  const place = yield* CallPlace;
  const origin =
    served !== null
      ? { projectId: served.projectId, root: served.checkout }
      : place?.checkout == null
        ? null
        : { projectId: place.projectId, root: place.checkout };
  if (origin !== null) yield* places.value.acted({ threadId, home, place: origin });
});

const bodyInputOf = <Input>(input: Input): Effect.Effect<Input> => Effect.map(PlacedCall, (facts) => (facts?.bodyInput ?? input) as Input);

export const perform = <Input, Prepared, Answer, R, E>(
  bound: Bound<Input, Prepared, Answer, R, E>,
  input: NoInfer<Input>,
  caller: Caller,
): Effect.Effect<Answer, E | GateRefusal | StoreFailure, R | OperationChecks | OperationCatalog> =>
  Effect.andThen(
    admitCaller(bound.id, caller),
    Effect.flatMap(bodyInputOf(input), (body) =>
      Effect.flatMap(prepare(bound, body, caller), (prepared) =>
        Effect.andThen(judged(bound.id, input, prepared, caller), triggered(bound.id, caller, bound.execute(body, prepared, caller))),
      ),
    ),
  );

const factsOf = Effect.fn('invocation.factsOf')(function* <Owners, World>(context: Context.Context<Owners>, site: CallSite<World>) {
  const existing = Context.get(context, PlacedCall);
  if (existing !== null) return { ...existing, caller: site.caller };
  const givenGraph = Context.getOrUndefined(context, GraphCall);
  const graph = givenGraph ?? Effect.fail(projectRequired());
  const givenProject =
    Context.getOrUndefined(context, CurrentProject) ??
    (givenGraph === undefined
      ? undefined
      : Effect.map(givenGraph, (call) => ({ project: call.project })).pipe(
          Effect.mapError((failure) => new GateRefusal('graph-pool', failure.reason, failure.unblock)),
        ));
  const project: CurrentProject['Service'] = givenProject ?? Effect.fail(projectRequired());
  const known = givenProject === undefined ? undefined : (yield* givenProject).project;
  const served = Context.get(context, CurrentGraph);
  const actor = site.caller.actor;
  const target =
    Context.get(context, CallPlace) ??
    (known === undefined ? undefined : { projectId: known.id, checkout: served?.checkout ?? null, branch: null });
  return {
    request: Context.getOrUndefined(context, CallRequest) ?? {
      session: actor.kind === 'operator' || actor.kind === 'external' ? null : actor.session,
      project: undefined,
      cwd: undefined,
      branch: undefined,
      scope: undefined,
    },
    caller: site.caller,
    place: site.place,
    target,
    world: Context.getOrUndefined(context, CallWorld) ?? (site.place === null ? 'elsewhere' : 'checkout'),
    standing: Context.get(context, CallStanding),
    authority: Context.get(context, CallAuthority),
    served,
    refused: Context.get(context, RefusedGraph),
    project,
    graph,
    scopes: Context.getOrUndefined(context, GraphScopes) ?? null,
    door: { key: Context.get(context, SignedCall) },
  } satisfies CallFacts;
});

const contextAt = Effect.fn('invocation.contextAt')(function* <Input, Prepared, Answer, R, E, Owners, World>(
  owners: OwnerContext<Owners, World>,
  bound: Bound<Input, Prepared, Answer, R, E>,
  input: Input,
  site: CallSite<World>,
  initial?: Context.Context<Owners | InvocationLifetime>,
): Effect.fn.Return<Context.Context<any>, E | DynamicOperationFailure> {
  const ambient = yield* Effect.context<never>();
  const first = initial ?? (yield* owners(site.caller, site.place, site.world));
  let context = placedContext(Context.merge(ambient, first));
  const catalog = Context.get(context, OperationCatalog);
  const id = catalog.registry.named(bound.id);
  if (id === null) return yield* Effect.die(new Error(`No operation is registered as ${bound.id}.`));
  const facts = yield* factsOf(context, site);
  const entry = catalog.registry.entry(id);
  const selected = yield* operationFacts(entry, bound, input, facts, context);
  if (selected.place?.root !== site.place?.root) context = Context.merge(context, yield* owners(site.caller, selected.place, site.world));
  const complete = Context.merge(context, callServices(selected));
  yield* Effect.provide(admitOperation(bound.id, site.caller), complete);
  yield* Effect.provide(admitPlugin(bound.id, entry, input, site.caller), complete);
  const places = Context.getOrUndefined(complete, WorkPlaces);
  const actor = site.caller.actor;
  const place = Context.get(complete, CallPlace);
  const origin =
    selected.served === null
      ? place?.checkout == null
        ? null
        : { projectId: place.projectId, root: place.checkout }
      : { projectId: selected.served.projectId, root: selected.served.checkout };
  if (
    places !== undefined &&
    actor.kind === 'thread' &&
    origin !== null &&
    entry.place === 'project' &&
    (selected.served !== null || (entry.mutates === true && origin.projectId !== actor.projectId))
  ) {
    yield* places
      .enter({
        threadId: actor.threadId,
        home: actor.projectId,
        place: origin,
        mutates: entry.mutates === true,
      })
      .pipe(
        Effect.catchTag('GateRefusal', (refusal) =>
          Effect.gen(function* () {
            if (refusal.code !== 'instructions-unread') return yield* refusal;
            const served =
              selected.served ??
              (yield* places
                .graphAt(origin)
                .pipe(
                  Effect.catchTag('GateRefusal', (failure) =>
                    Effect.andThen(places.leave(actor.threadId, origin.projectId), Effect.fail(failure)),
                  ),
                ));
            const native = Context.getOrUndefined(complete, NativeStorage);
            const thread =
              native === undefined
                ? undefined
                : yield* native.threads
                    .find(actor.threadId)
                    .pipe(Effect.mapError((failure) => new GateRefusal('graph-pool', failure.message, ['read the thread again'])));
            const guidance = thread?.transport.adapter === 'native' ? undefined : Context.getOrUndefined(complete, HarnessGuidance);
            const delivered = yield* Effect.result(
              guidance === undefined
                ? Effect.gen(function* () {
                    yield* served.fresh();
                    const set = yield* Context.get(served.context, Orientation)
                      .instructions({ projectId: served.projectId, audience: 'graph' })
                      .pipe(Effect.provide(served.context));
                    return instructionText(set);
                  })
                : Effect.map(
                    guidance.touch(
                      actor.threadId,
                      `law:${served.projectId}:${crypto.randomUUID()}`,
                      [],
                      [{ projectId: served.projectId, checkout: served.checkout, branch: null }],
                    ),
                    (guided) => guided.text ?? '',
                  ),
            );
            if (delivered._tag === 'Failure') {
              yield* places.leave(actor.threadId, served.projectId);
              return yield* new GateRefusal(
                'graph-pool',
                `The law of project ${served.projectId} could not be delivered: ${String(delivered.failure)}`,
                ['read that project again'],
              );
            }
            return yield* new GateRefusal('instructions-unread', `${refusal.reason}\n\n${delivered.success}`, refusal.unblock);
          }),
        ),
        Effect.mapError((failure) =>
          failure instanceof GateRefusal ? failure : new GateRefusal('graph-pool', failure.message, ['read the place again']),
        ),
      );
  }
  return complete;
});

export const performIn =
  <Owners, World>(owners: OwnerContext<Owners, World>) =>
  <Input, Prepared, Answer, R extends Owners | InvocationLifetime | ServedCall | CallerWorkspace, E>(
    bound: Bound<Input, Prepared, Answer, R, E>,
    input: NoInfer<Input>,
    site: CallSite<World>,
  ): Effect.Effect<Answer, E | GateRefusal | StoreFailure, Exclude<R, Owners | InvocationLifetime | CallerWorkspace>> =>
    rootCost(
      bound.id,
      Effect.flatMap(contextAt(owners, bound, input, site), (context) =>
        Effect.provide(onPlace(perform(bound, input, site.caller)), context),
      ),
    );

export const performOperatorIn = <Owners, World, Input, Prepared, Answer, E>(
  owners: OwnerContext<Owners, World>,
  bound: Bound<Input, Prepared, Answer, Owners | InvocationLifetime, E>,
  input: NoInfer<Input>,
  world: World,
): Effect.Effect<Answer, E | GateRefusal | StoreFailure> => {
  const caller: Caller = { actor: { kind: 'operator' }, files: null };
  return rootCost(
    bound.id,
    Effect.flatMap(contextAt(owners, bound, input, { caller, place: null, world }), (context) =>
      Effect.provide(
        onPlace(
          Effect.andThen(
            admitCaller(bound.id, caller),
            Effect.flatMap(bodyInputOf(input), (body) =>
              Effect.flatMap(prepare(bound, body, caller), (prepared) => caused(bound.id, caller, execute(bound, body, prepared, caller))),
            ),
          ),
        ),
        context,
      ),
    ),
  );
};

export const boundAt = <R>(id: OperationId): Effect.Effect<ErasedBound<R>, never, OperationCatalog> =>
  Effect.map(OperationCatalog, (catalog) => {
    const bound = catalog.bound(id);
    if (bound === undefined) throw new Error(`No operation body is registered for ${id}.`);
    return bound;
  });

export const executeById = <R>(
  id: OperationId,
  input: unknown,
  caller: Caller,
): Effect.Effect<unknown, DynamicOperationFailure, R | OperationChecks | OperationCatalog> =>
  Effect.andThen(
    admitCaller(id, caller),
    Effect.flatMap(Effect.all([boundAt<R>(id), bodyInputOf(input)]), ([bound, body]) =>
      Effect.flatMap(prepareById(bound, body, caller), (prepared) =>
        Effect.andThen(judged(id, input, prepared, caller), triggered(id, caller, bound.execute(body, prepared, caller))),
      ),
    ),
  );

export const prepareById = <R>(
  bound: ErasedBound<R>,
  input: unknown,
  caller: Caller,
): Effect.Effect<unknown, DynamicOperationFailure, R> =>
  bound.prepare === undefined ? Effect.succeed(undefined) : bound.prepare(input, caller);

export const answeredOutcome = (entry: Operation, answer: unknown): Shaped['outcome'] =>
  entry.negative?.(toJson(answer)) === true ? 'negative' : 'answer';

const shapedOf = (entry: Operation, toolDisplay: ToolDisplay | undefined, recorded: unknown): Shaped => {
  const answer = toJson(recorded);
  return {
    answer: toolDisplay === undefined ? answer : { ...(answer as object), _meta: { toolDisplay: toJson(toolDisplay) } },
    outcome: answeredOutcome(entry, answer),
  };
};

export const performById = <R>(call: Call<R>, operationId: OperationId, input: unknown): Effect.Effect<unknown, DynamicOperationFailure> =>
  Effect.provide(onPlace(executeById<R>(operationId, input, call.caller)), call.lifetimes);

const placedById = <Owners, World>(owners: OwnerContext<Owners, World>) =>
  Effect.fnUntraced(function* (id: OperationId, input: unknown, site: CallSite<World>) {
    const first = yield* owners(site.caller, site.place, site.world);
    const bound = Context.get(first, OperationCatalog).bound(id);
    if (bound === undefined) return yield* Effect.die(new Error(`No operation body is registered for ${id}.`));
    const context = yield* contextAt(owners, { ...bound, id }, input, site, first);
    return { bound, context };
  });

export const performByIdIn = <Owners, World>(owners: OwnerContext<Owners, World>) =>
  Effect.fnUntraced(
    function* (
      id: OperationId,
      input: unknown,
      site: CallSite<World>,
      needs: CallNeeds,
    ): Effect.fn.Return<Performed, DynamicOperationFailure | StoreFailure> {
      const { bound, context, stand } = yield* placedById(owners)(id, input, site).pipe(
        Effect.flatMap((at) => Effect.map(standAt(id, input, site.caller, at.context), (stand) => ({ ...at, stand }))),
        refusedOrBroken,
        Effect.tapCause((cause) => Effect.flatMap(standOf(site.caller, null), (stand) => callDefected(id, site.caller, stand, cause))),
      );
      return yield* answeredIn(bound, context, id, input, site.caller, needs).pipe(
        refusedOrBroken,
        Effect.tapCause((cause) => callDefected(id, site.caller, stand, cause)),
      );
    },
    (effect, id) => rootCost(id, effect),
  );

const refusedOrBroken = <A, R>(work: Effect.Effect<A, DynamicOperationFailure | StoreFailure, R>): Effect.Effect<A, GateRefusal, R> =>
  Effect.catch(work, (failure) => (failure instanceof GateRefusal ? Effect.fail(failure) : Effect.die(failure)));

const standOf = (caller: Caller, addressed: string | null): Effect.Effect<CallStand> =>
  Effect.map(Effect.all([CallStanding, CallPlace]), ([standing, place]) =>
    caller.actor.kind === 'thread'
      ? { thread: caller.actor.threadId, run: standing?.runId ?? null, project: null }
      : { thread: addressed, run: null, project: place?.projectId ?? null },
  );

const standAt = (id: OperationId, input: unknown, caller: Caller, context: Context.Context<any>) =>
  Effect.provide(
    caller.actor.kind === 'thread'
      ? standOf(caller, null)
      : Effect.flatMap(addressedThread(Context.get(context, OperationCatalog).registry.entry(id), input, caller), (thread) =>
          standOf(caller, thread),
        ),
    context,
  );

const answeredIn = Effect.fnUntraced(function* (
  bound: ErasedBound<any>,
  context: Context.Context<any>,
  id: OperationId,
  input: unknown,
  caller: Caller,
  needs: CallNeeds,
): Effect.fn.Return<Performed, DynamicOperationFailure | StoreFailure> {
  const value = yield* performById({ caller, lifetimes: context }, id, input);
  const answer = yield* Effect.provide(onPlace(journaled(bound.answer === undefined ? value : bound.answer(value, input))), context);
  const media = !needs.media || bound.media === undefined ? [] : yield* Effect.provide(onPlace(bound.media(answer)), context);
  const catalog = Context.get(context, OperationCatalog);
  const entry = catalog.registry.entry(id);
  const presentation = presentationOf(catalog, id);
  const shaped = shapedOf(entry, answerDisplay(presentation, input, answer, media), answer);
  if (!needs.text) return { value, answer, shaped, media, text: undefined };
  const document = entry.answer === undefined ? Schema.Unknown : knownAnswer(entry.answer);
  const told = voiced(presentation, document, id, answer, input, caller);
  const text = yield* Effect.provide(onPlace(told), context);
  return { value, answer, shaped, media, text };
});

export const operationPerformer = OperationPerformer.of({ performIn, performOperatorIn, performByIdIn });
