import { Context, Effect } from 'effect';
import { GateRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import type { GraphUse } from '../../platform/contract/wire/operation.js';
import { BlockNames } from '../../graph/contract/service/acts.js';
import type { ServedGraph, ServedGraphs } from '../../graph/contract/service/serving.js';
import { Projects, type ProjectIdentification } from '../../projects/contract/service/registry.js';
import { placeAt } from '../../projects/identity.js';
import { sameOrInside } from '../../projects/resolution.js';
import type { MachineContext } from '../../graph/serving/machine.js';
import type { SessionResolution } from '../../external-harnesses/contract/service/sessionResolution.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { identityOf } from './identity.js';
import { resolveProject } from '../../graph/serving/selector.js';
import type { RequestedCall } from '../contract/service/admission.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import type { StandingThread, Stood } from './standing.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';

const projectOfName = Effect.fnUntraced(function* (pool: ServedGraphs['Service'], candidates: readonly number[], name: string) {
  for (const projectId of candidates) {
    const found = yield* Effect.gen(function* () {
      const served = yield* pool.resolve({ projectId });
      yield* served.fresh();
      return yield* Context.get(served.context, BlockNames).idOfName(name);
    }).pipe(
      Effect.catch((error) =>
        error instanceof GateRefusal
          ? error.code === 'not-found'
            ? Effect.succeed(undefined)
            : Effect.fail(error)
          : Effect.fail(
              new GateRefusal('graph-pool', `this server could not search project ${projectId}: ${String(error)}`, ['make the call again']),
            ),
      ),
    );
    if (found !== undefined) return projectId;
  }
  return undefined;
});

const resolvedProject = Effect.fnUntraced(function* (machine: MachineContext, project?: string, cwd?: string) {
  const here = project === undefined ? yield* placeAt(cwd) : undefined;
  return yield* Effect.mapError(
    project === undefined ? Context.get(machine, Projects).resolve(project, here) : Effect.provide(resolveProject(project), machine),
    (error) => (error instanceof GateRefusal ? error : new GateRefusal('graph-pool', String(error), ['retry'])),
  );
});

const projectOf = Effect.fnUntraced(function* (
  machine: MachineContext,
  pool: ServedGraphs['Service'],
  caller: RequestedCall,
  own: number | undefined,
  named: ProjectRow | undefined,
) {
  const projects = Context.get(machine, Projects);
  if (own !== undefined && caller.project === undefined)
    return caller.cwd === undefined ? own : ((yield* resolvedProject(machine, undefined, caller.cwd)) ?? own);
  const here =
    caller.project !== undefined
      ? (named ?? (yield* resolvedProject(machine, caller.project, caller.cwd)))
      : caller.cwd === undefined
        ? undefined
        : yield* resolvedProject(machine, undefined, caller.cwd);
  if (own !== undefined) return here ?? own;
  if (caller.scope !== undefined) {
    const listed = (yield* projects
      .list()
      .pipe(
        Effect.mapError(
          (failure) =>
            new GateRefusal('graph-pool', `this server could not list projects for scope resolution: ${failure.message}`, [
              'make the call again',
            ]),
        ),
      )).map((row) => row.id);
    const global = (yield* projects
      .global()
      .pipe(
        Effect.mapError(
          (failure) =>
            new GateRefusal('graph-pool', `this server could not read the global project: ${failure.message}`, ['make the call again']),
        ),
      ))?.id;
    const reachable = global === undefined || listed.includes(global) ? listed : [...listed, global];
    const order = here === undefined ? reachable : [here.id, ...reachable.filter((id) => id !== here.id)];
    const held = yield* projectOfName(pool, order, caller.scope);
    if (held !== undefined) return held === here?.id ? here : held;
  }
  return here;
});

const rowOf = (machine: MachineContext, found: ProjectRow | number) =>
  typeof found !== 'number'
    ? Effect.succeed(found)
    : Context.get(machine, Projects)
        .byId(found)
        .pipe(
          Effect.mapError((error) =>
            error instanceof GateRefusal
              ? new GateRefusal('unknown-project', error.reason, ['name a registered project by name or id'])
              : new GateRefusal('graph-pool', error.message, ['retry the project read']),
          ),
        );

export const unopenedGraph = (id: string, entry: GraphUse): GateRefusal<'not-served'> | null =>
  entry.graph === 'none'
    ? new GateRefusal(
        'not-served',
        `${id} declares that it needs no graph of the calling place, so admission opened none, yet the call reached for one`,
        [`fix the declaration of ${id}: its call reaches the project graph`],
      )
    : null;

export const servedAt = (
  pool: ServedGraphs['Service'],
  aim: { readonly projectId: number; readonly cwd?: string; readonly branch?: string; readonly project?: ProjectRow },
  unopened: GateRefusal<'not-served'> | null,
): Effect.Effect<{
  readonly served: ServedGraph | null;
  readonly refused: GateRefusal<OpenRefusal> | null;
  readonly checkout: string | null;
}> =>
  unopened === null
    ? Effect.match(pool.resolve(aim), {
        onFailure: (refused) => ({ served: null, refused, checkout: null }),
        onSuccess: (served) => ({ served, refused: null, checkout: served.checkout }),
      })
    : Effect.match(pool.checkout(aim), {
        onFailure: (refused) => ({ served: null, refused, checkout: null }),
        onSuccess: (checkout) => ({ served: null, refused: unopened, checkout }),
      });

export const admitProject = Effect.fnUntraced(function* (
  options: {
    readonly machine: MachineContext;
    readonly pool: ServedGraphs['Service'];
    readonly resolution: SessionResolution['Service'];
    readonly grants: GrantSigner['Service'];
    readonly stand: (thread: StandingThread) => Effect.Effect<Stood, StoreFailure | GateRefusal>;
  },
  headers: Record<string, string | undefined>,
  request: Omit<RequestedCall, 'session'>,
  unopened: GateRefusal<'not-served'> | null,
) {
  const identity = yield* identityOf(options.machine, options.resolution, options.grants, headers);
  const asked: RequestedCall = { ...request, session: identity.session };
  const named = asked.project === undefined ? undefined : yield* resolvedProject(options.machine, asked.project, asked.cwd);
  const native = identity.native;
  const home = native === null ? null : named?.id === native.projectId ? named : yield* rowOf(options.machine, native.projectId);
  const stood =
    native === null || home === null
      ? null
      : yield* options
          .stand({ id: native.threadId, ownerId: native.ownerId, projectId: native.projectId, root: home.rootPath })
          .pipe(
            Effect.mapError((failure) =>
              failure instanceof GateRefusal ? failure : new GateRefusal('graph-pool', failure.message, ['read the calling thread again']),
            ),
          );
  const caller: RequestedCall = {
    ...asked,
    project: named === undefined ? asked.project : String(named.id),
  };
  const cwd =
    asked.cwd === undefined && asked.branch === undefined && stood !== null && (named === undefined || named.id === native?.projectId)
      ? stood.checkout
      : asked.cwd;
  const atHome =
    caller.cwd !== undefined &&
    stood !== null &&
    home !== null &&
    [stood.checkout, home.rootPath].some((root) => sameOrInside(caller.cwd!, root));
  const aimed: RequestedCall = {
    ...caller,
    cwd: atHome ? undefined : caller.cwd,
    scope: unopened === null ? caller.scope : undefined,
  };
  const found = yield* projectOf(options.machine, options.pool, aimed, native?.projectId, named);
  if (found === undefined) return { caller, identity, stood, served: null, project: null, refused: null, checkout: null };
  const project = typeof found === 'number' && found === home?.id ? home : yield* rowOf(options.machine, found);
  yield* Effect.annotateCurrentSpan({ project: project.id });
  const placed: RequestedCall =
    native !== null && caller.project === undefined && project.id !== native.projectId
      ? { ...caller, ambient: String(project.id) }
      : caller;
  const reached = yield* servedAt(options.pool, { projectId: project.id, cwd, branch: caller.branch, project }, unopened);
  return { caller: placed, identity, stood, project, ...reached };
});
