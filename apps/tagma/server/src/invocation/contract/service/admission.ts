import { Context, type Effect } from 'effect';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import type { FeedDeclaration } from '../../../platform/contract/wire/operation.js';
import type { GateRefusal, OpenRefusal } from '../../../platform/contract/wire/refusal.js';
import type { GraphCall, ServedGraph } from '../../../graph/contract/service/serving.js';
import type { ChangeScope } from '../../../change-record/contract/service/scope.js';
import type { CurrentProject } from '../../../projects/contract/service/caller.js';
import type { ProjectIdentification } from '../../../projects/contract/service/registry.js';
import type { ProjectRow } from '../../../projects/contract/wire/project.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { CallerWorkspace } from '../../../workspace/contract/service/places.js';
import type { ThreadWorld } from '../../../executions/contract/service/worlds.js';
import type { HeldTaskLabels } from '../../../change-record/contract/service/taskLabels.js';
import type { HolderLabels } from '../../../workspace/contract/service/checkouts.js';
import type { AccessRequest, PairRequest, Paired } from '../../../remote/contract/service/devices.js';

export type RequestedCall = {
  readonly session: SessionRef | null;
  readonly project: string | undefined;
  readonly cwd: string | undefined;
  readonly branch: string | undefined;
  readonly scope: string | undefined;
  readonly ambient?: string;
};

export class CallRequest extends Context.Service<CallRequest, RequestedCall>()('tagma/invocation/CallRequest') {}

export class CurrentCaller extends Context.Service<CurrentCaller, Caller>()('tagma/invocation/CurrentCaller') {}

export class CallWorld extends Context.Service<CallWorld, 'checkout' | 'elsewhere'>()('tagma/invocation/CallWorld') {}

export type ThreadStanding = {
  readonly world: ThreadWorld;
  readonly runId: string | null;
  readonly projectRoot: string;
};

export const CallStanding = Context.Reference<ThreadStanding | null>('tagma/invocation/CallStanding', {
  defaultValue: () => null,
});

export type ServedCall = GraphCall | CurrentProject | ChangeScope;

export type CallServices = CallRequest | CurrentCaller | CallWorld | CallerWorkspace | ServedCall | HeldTaskLabels | HolderLabels;

export type DoorFacts = {
  readonly key: string | null;
  readonly approvalWaitMs?: number;
  readonly stage?: (detail: string) => void;
};

export const CallDevice = Context.Reference<string | null>('tagma/invocation/CallDevice', {
  defaultValue: () => null,
});

export const ConnectionHeaders = Context.Reference<Readonly<Record<string, string | undefined>>>('invocation/ConnectionHeaders', {
  defaultValue: () => ({}),
});

export type AdmittedCall = {
  readonly startedAt: number;
  readonly requested: RequestedCall;
  readonly caller: Caller;
  readonly place: CallerWorkspace['Service'];
  readonly served: ServedGraph | null;
  readonly refused: GateRefusal<OpenRefusal> | null;
  readonly project: ProjectRow | null;
  readonly world: CallWorld['Service'];
  readonly standing: ThreadStanding | null;
  readonly authority: AgentApprovalMode | null;
};

export class Admission extends Context.Service<
  Admission,
  {
    admit(
      headers: Record<string, string | undefined>,
      request: Omit<RequestedCall, 'session'>,
      operation: string | null,
    ): Effect.Effect<AdmittedCall, GateRefusal>;
    admitFeed(declaration: FeedDeclaration, projectId: number | undefined): Effect.Effect<void, StoreFailure | GateRefusal>;
    admitProtocol(call: AdmittedCall, declaration: FeedDeclaration, meaning: string): Effect.Effect<void, GateRefusal>;
    remote<A, E, R>(
      request: AccessRequest,
      admitted: (renewed: boolean) => Effect.Effect<A, E, R>,
      refused: (refusal: GateRefusal) => A,
    ): Effect.Effect<A, E, R>;
    pair(request: PairRequest, code: Effect.Effect<string, GateRefusal>): Effect.Effect<Paired, GateRefusal>;
    carry<A, E, R>(
      call: AdmittedCall,
      door: DoorFacts,
      work: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, Exclude<R, CallServices | ProjectIdentification>>;
  }
>()('tagma/invocation/Admission') {}
