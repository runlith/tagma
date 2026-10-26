import { isAbsolute, resolve } from 'node:path';
import { Context, Effect } from 'effect';
import type { Actor } from '../../platform/contract/wire/actor.js';
import type { Caller, FileReach } from '../../platform/contract/wire/caller.js';
import { GateRefusal, type CallerRefusal } from '../../platform/contract/wire/refusal.js';
import { BlockNames } from '../../graph/contract/service/acts.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { GraphScopes, type ServedGraph } from '../../graph/contract/service/serving.js';
import type { ProjectIdentification } from '../../projects/contract/service/registry.js';
import type { ProjectCall } from '../../graph/contract/wire/call.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import type { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import type { CallIdentity } from './identity.js';
import type { RequestedCall, ThreadStanding } from '../contract/service/admission.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { CallingThread, Stood } from './standing.js';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import { workspaceAt } from './workspace.js';

export const projectRequired = () =>
  new GateRefusal('project-required', 'name the project or run inside a registered root', ['?project=<name|id>']);

const fileScope = (path: string): FileReach => ({
  path,
  resolve: (candidate) => (isAbsolute(candidate) ? candidate : resolve(path, candidate)),
});

export const projectCall = (
  transport: RequestedCall,
  actor: Actor,
  served: ServedGraph | null,
  project: ProjectRow | null,
): Effect.Effect<ProjectCall, GateRefusal<CallerRefusal>, ProjectIdentification> =>
  served === null || project === null
    ? Effect.fail(projectRequired())
    : Effect.gen(function* () {
        const vocabulary = yield* Context.get(served.context, Tags).of(served.projectId);
        const here = Context.get(served.context, GraphScopes);
        const scope =
          transport.scope !== undefined
            ? (yield* here.scope(served.projectId, yield* Context.get(served.context, BlockNames).idOfName(transport.scope))).id
            : transport.cwd === undefined || transport.project !== undefined || transport.ambient !== undefined
              ? undefined
              : (yield* here.scopeByPlace(served.projectId, transport.cwd))?.id;
        return {
          project: { id: project.id, name: project.name },
          vocabulary,
          lens: {
            scope,
            names: 'every-served-project',
          },
          deliveredTags: undefined,
        } satisfies ProjectCall;
      }).pipe(
        Effect.mapError((error) =>
          error instanceof GateRefusal ? error : new GateRefusal('graph-pool', error.message, ['retry the project read']),
        ),
      );

export const operationCaller = Effect.fn('invocation.operationCaller')(function* (
  scratch: ScratchAreas['Service'],
  identity: CallIdentity,
  checkout: string | null,
  project: ProjectRow | null,
  origins: WorkingOrigins['Service'],
  stood: Stood | null,
  authorize: (thread: CallingThread) => Effect.Effect<AgentApprovalMode | null, StoreFailure | GateRefusal>,
  device: string | null,
) {
  const actor: Actor =
    identity.session === null
      ? identity.external !== undefined
        ? { kind: 'external', name: identity.external }
        : device === null
          ? { kind: 'operator' }
          : { kind: 'operator', deviceId: device }
      : identity.native !== null
        ? {
            kind: 'thread',
            threadId: identity.native.threadId,
            projectId: identity.native.projectId,
            principalId: identity.native.ownerId,
            session: identity.session,
            act: identity.native.act ?? undefined,
          }
        : { kind: 'session', session: identity.session, projectId: project?.id ?? null };

  const root = checkout ?? project?.rootPath;
  const proved = root === undefined ? null : yield* workspaceAt(origins, actor, root);
  const files =
    actor.kind === 'thread'
      ? scratch.scope(actor.threadId)
      : actor.kind === 'operator' && proved !== null && proved.root !== null
        ? fileScope(proved.root.root.path)
        : null;
  const unread = (failure: StoreFailure | GateRefusal) =>
    failure instanceof GateRefusal ? failure : new GateRefusal('graph-pool', failure.message, ['make the call again']);
  const place: CallerWorkspace['Service'] =
    stood !== null && actor.kind === 'thread' && project?.id === actor.projectId && (checkout === null || checkout === stood.checkout)
      ? stood.place
      : (proved?.place ?? null);
  const standing: ThreadStanding | null =
    stood === null || actor.kind !== 'thread' ? null : { ...stood.standing, runId: actor.act?.by ?? stood.standing.runId };
  const authority =
    actor.kind !== 'thread'
      ? null
      : stood !== null
        ? stood.authority
        : yield* Effect.mapError(authorize({ id: actor.threadId, ownerId: actor.principalId }), unread);
  return { caller: { actor, files } satisfies Caller, place, standing, authority };
});
