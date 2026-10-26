import { CallAuthority } from '../../platform/contract/service/authority.js';
import { ApprovalRoute, ApprovalWait } from '../contract/service/approvalSeats.js';
import { APPROVAL_WAIT_MS } from '../../platform/contract/wire/approval.js';
import { gitRefusal, headNamed } from '../../platform/git/readings.js';
import { Context, Effect, Scope } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { GateRefusal, OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { SignedCall, SignedSession } from '../../platform/contract/service/writers.js';
import { CallStage } from '../../platform/contract/service/stage.js';
import type { ProjectCall } from '../../graph/contract/wire/call.js';
import {
  CurrentGraph,
  GraphCall,
  GraphScopes,
  RefusedGraph,
  RoutedGraphs,
  ServedTree,
  TaskHolders,
  type ServedGraph,
  type ServedGraphs,
} from '../../graph/contract/service/serving.js';
import { HeldTaskLabels } from '../../change-record/contract/service/taskLabels.js';
import { HolderLabels } from '../../workspace/contract/service/checkouts.js';
import { changeScopeOf } from './changeScope.js';
import { FreshenedGraphs, placeContext } from '../../graph/serving/routing.js';
import { ChangeScope } from '../../change-record/contract/service/scope.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { ProjectIdentification } from '../../projects/contract/service/registry.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import type { MachineContext } from '../../graph/serving/machine.js';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import {
  CallRequest,
  CallStanding,
  CallWorld,
  type ThreadStanding,
  CurrentCaller,
  type AdmittedCall,
  type CallServices,
  type DoorFacts,
  type RequestedCall,
} from '../contract/service/admission.js';
import { projectCall, projectRequired } from './actor.js';
import { CallPlace, CallerAim } from '../../platform/contract/service/place.js';
import type { Place } from '../../platform/contract/wire/place.js';

export type CallFacts = {
  readonly request: RequestedCall;
  readonly caller: Caller;
  readonly place: CallerWorkspace['Service'];
  readonly target?: Place;
  readonly graphContext?: Context.Context<never>;
  readonly world: CallWorld['Service'];
  readonly served: ServedGraph | null;
  readonly refused?: GateRefusal | null;
  readonly project: CurrentProject['Service'];
  readonly graph: Effect.Effect<ProjectCall, GateRefusal<OpenRefusal>>;
  readonly scopes: GraphScopes['Service'] | null;
  readonly door: DoorFacts;
  readonly standing?: ThreadStanding | null;
  readonly authority?: AgentApprovalMode | null;
  readonly startedAt?: number;
  readonly bodyInput?: unknown;
};

export const PlacedCall = Context.Reference<CallFacts | null>('tagma/invocation/PlacedCall', { defaultValue: () => null });

const routeOf = Effect.fnUntraced(function* (facts: CallFacts) {
  const checkout = facts.target?.checkout ?? facts.served?.checkout ?? null;
  const workspace = facts.place?.root ?? null;
  const head = (root: string | null) =>
    root === null || facts.served === null ? Effect.succeed(null) : Effect.mapError(headNamed(facts.served.git, root), gitRefusal);
  const checkoutHead = yield* head(checkout);
  const workspaceHead = workspace === checkout ? checkoutHead : yield* head(workspace);
  return {
    project:
      facts.target?.projectId ??
      facts.served?.projectId ??
      (facts.caller.actor.kind === 'operator' || facts.caller.actor.kind === 'external' ? null : facts.caller.actor.projectId),
    cwd: facts.request.cwd ?? null,
    checkout,
    workspace,
    branch: facts.request.branch ?? null,
    checkoutHead,
    workspaceHead,
    scope: facts.request.scope ?? null,
  };
});

const noTasks: TaskHolders['Service'] = { forHolders: () => Effect.succeed(new Map()) };

const holderLabelsOf = (tasks: TaskHolders['Service']): HolderLabels['Service'] => ({
  forHolders: (ids) =>
    Effect.map(
      tasks.forHolders(ids),
      (found) =>
        new Map([...found].map(([threadId, held]) => [threadId, held.map((task) => ({ name: task.name, title: task.title }))] as const)),
    ),
});

export const onPlace = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(CurrentGraph, (served) =>
    served === null ? body : Effect.flatMap(RoutedGraphs, (pool) => Effect.provide(body, placeContext(served, pool))),
  );

const servedBy =
  (served: ServedGraph | null, refused: GateRefusal | null) =>
  (context: Context.Context<Exclude<CallServices, HeldTaskLabels | HolderLabels>>): Context.Context<CallServices> => {
    const tasks = served === null ? noTasks : Context.get(served.context, TaskHolders);
    const labelled = context.pipe(Context.add(HeldTaskLabels, tasks), Context.add(HolderLabels, holderLabelsOf(tasks)));
    if (served !== null) {
      return labelled.pipe(Context.add(CurrentGraph, served), Context.add(ServedTree, Context.get(served.context, ServedTree)));
    }
    return refused === null ? labelled : Context.add(labelled, RefusedGraph, refused);
  };

export const callServices = (facts: CallFacts): Context.Context<CallServices> =>
  Context.merge(facts.graphContext ?? Context.empty(), Context.make(CallRequest, facts.request)).pipe(
    Context.add(PlacedCall, facts),
    Context.add(CurrentCaller, facts.caller),
    Context.add(CallWorld, facts.world),
    Context.add(CallerWorkspace, facts.place),
    Context.add(
      CallPlace,
      facts.target ??
        (facts.served === null
          ? null
          : { projectId: facts.served.projectId, checkout: facts.served.checkout, branch: facts.request.branch ?? null }),
    ),
    Context.add(CurrentProject, facts.project),
    Context.add(GraphCall, facts.graph),
    Context.add(ChangeScope, changeScopeOf(facts.project)),
    Context.add(CallerAim, { project: facts.request.project, cwd: facts.request.cwd, branch: facts.request.branch }),
    Context.add(SignedSession, facts.request.session),
    Context.add(SignedCall, facts.door.key),
    Context.add(CallStage, facts.door.stage ?? CallStage.defaultValue()),
    Context.add(FreshenedGraphs, new Set<string>()),
    Context.add(CallStanding, facts.standing ?? null),
    Context.add(CallAuthority, facts.authority ?? null),
    Context.add(ApprovalRoute, routeOf(facts)),
    Context.add(ApprovalWait, Math.min(facts.door.approvalWaitMs ?? APPROVAL_WAIT_MS, APPROVAL_WAIT_MS)),
    servedBy(facts.served, facts.refused ?? null),
  );

export const carrying = (machine: MachineContext, pool: ServedGraphs['Service']) => {
  const identification = Context.get(machine, ProjectIdentification);
  const carried = Effect.fnUntraced(function* <A, E, R>(
    call: AdmittedCall,
    door: DoorFacts,
    work: Effect.Effect<A, E, R>,
    served: ServedGraph | null,
    refused: GateRefusal<OpenRefusal> | null,
  ) {
    const { requested, caller } = call;
    const project =
      call.project === null
        ? Effect.fail(projectRequired())
        : Effect.succeed({ project: { id: call.project.id, name: call.project.name } });
    const graph =
      served === null
        ? Effect.fail(refused ?? projectRequired())
        : yield* Effect.cached(
            Effect.provideService(projectCall(requested, caller.actor, served, call.project), ProjectIdentification, identification),
          );
    const services = callServices({
      request: requested,
      caller,
      place: call.place,
      target:
        call.project === null
          ? undefined
          : {
              projectId: call.project.id,
              checkout: served?.checkout ?? call.place?.root ?? null,
              branch: requested.branch ?? null,
            },
      world: call.world,
      served,
      refused,
      project,
      graph,
      scopes: served === null ? null : Context.get(served.context, GraphScopes),
      door,
      standing: call.standing,
      authority: call.authority,
      startedAt: call.startedAt,
    });
    return yield* Effect.provide(work, Context.add(services, ProjectIdentification, identification));
  });
  return <A, E, R>(call: AdmittedCall, door: DoorFacts, work: Effect.Effect<A, E, R>) => {
    const admitted = call.served;
    if (admitted === null) return carried(call, door, work, null, call.refused);
    return Effect.acquireUseRelease(
      Scope.make(),
      (scope) =>
        Effect.flatMap(Effect.result(Scope.provide(pool.hold({ projectId: admitted.projectId, cwd: admitted.checkout }), scope)), (held) =>
          held._tag === 'Success' ? carried(call, door, work, held.success, null) : carried(call, door, work, null, held.failure),
        ),
      (scope, exit) => Scope.close(scope, exit),
    );
  };
};
