import { Context, type Effect } from 'effect';
import type { PermissionSubject } from '@runlith/agent/permissions';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { CommandRevision, DeadlineChange } from '@runlith/executions/protocol/command';
import type { ExecutionRef, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { CommandPolicy } from '../../commands/policy.js';
import type { CommandFacts } from '../../commands/subjects.js';
import type { TerminalInstruction, TerminalState } from '../../terminals/policy.js';
import type { PreparedTerminalSubjects, TerminalPlace, TerminalSubjectRequest } from './subjectPolicy.js';
import type { CommandCreator, CommandPolicyReceipt, CommandView } from '../wire/commands.js';
import type { CommandRelation, CommandSubject } from '../wire/commandSubject.js';
import type { InteractiveGrant, TerminalActor } from '../wire/terminals.js';
import type { ResolvedExecutionTarget, TargetKey } from '../wire/targets.js';
import type { TerminalRefused, TerminalUnavailable } from '../wire/refusals.js';

export type TerminalActRequest = {
  readonly actor: TerminalActor;
  readonly place: TerminalPlace;
  readonly owner: Principal;
  readonly standing: TerminalState;
  readonly act: TerminalInstruction;
  readonly subject: TerminalSubjectRequest;
  readonly interactive?: {
    readonly binding: BindingId;
    readonly permissionRevision: number;
    readonly execution: ExecutionRef;
    readonly runId?: string;
  };
};

export type TerminalPreparation = PreparedTerminalSubjects & {
  readonly grant?: InteractiveGrant;
};

export class TerminalAccess extends Context.Service<
  TerminalAccess,
  {
    readonly prepare: (request: TerminalActRequest) => Effect.Effect<TerminalPreparation, TerminalRefused | TerminalUnavailable>;
  }
>()('tagma/executions/TerminalAccess') {}

export type ResolvedRequest =
  | { readonly _tag: 'Observe'; readonly actor: TerminalActor; readonly scope: number; readonly execution: ExecutionRef }
  | { readonly _tag: 'Await'; readonly actor: TerminalActor; readonly scope: number; readonly execution: ExecutionRef }
  | {
      readonly _tag: 'Launch';
      readonly actor: TerminalActor;
      readonly scope: number;
      readonly target: ResolvedExecutionTarget;
      readonly program: string;
      readonly args: readonly string[];
      readonly tool: string;
      readonly requested?: number;
      readonly waitMs?: number;
      readonly owner: CommandSubject;
      readonly creator: CommandCreator;
      readonly operation: HostRequestKey;
      readonly cwd?: string;
      readonly policyRoot?: string;
      readonly ruled: RuledPlace | null;
      readonly policy: CommandPolicy;
    }
  | { readonly _tag: 'Stop'; readonly actor: TerminalActor; readonly scope: number; readonly execution: ExecutionRef }
  | {
      readonly _tag: 'Revise';
      readonly actor: TerminalActor;
      readonly scope: number;
      readonly execution: ExecutionRef;
      readonly current: { readonly executionMs?: number; readonly ceilingMs?: number; readonly revision: CommandRevision };
      readonly change: DeadlineChange;
      readonly exceptionMs?: number;
    };

export type RuledPlace = { readonly projectId: number; readonly root: string; readonly cwd: string };

export type CommandAccessRequest = ResolvedRequest extends infer R
  ? R extends ResolvedRequest
    ? Omit<R, 'current' | 'policy' | 'ruled'>
    : never
  : never;

export type CommandPreparation = {
  readonly request: ResolvedRequest;
  readonly subjects: readonly PermissionSubject[];
  readonly facts?: CommandFacts;
  readonly targetKey: TargetKey;
  readonly receipt?: CommandPolicyReceipt;
  readonly origin: CommandView | null;
  readonly owner: CommandSubject | null;
  readonly ownerStanding: { readonly projectId: number; readonly live: boolean } | null;
  readonly ownerFence: number | null;
  readonly lineage: { readonly actorThread: ThreadId; readonly descends: boolean; readonly live: boolean } | null;
  readonly relation: CommandRelation;
  readonly policyIdentity: string | null;
  readonly revision?: CommandRevision;
};

export type LaunchPreparation = CommandPreparation & {
  readonly request: Extract<ResolvedRequest, { readonly _tag: 'Launch' }>;
  readonly receipt: CommandPolicyReceipt;
};

export type ObservePreparation = CommandPreparation & { readonly request: Extract<ResolvedRequest, { readonly _tag: 'Observe' }> };
export type AwaitPreparation = CommandPreparation & { readonly request: Extract<ResolvedRequest, { readonly _tag: 'Await' }> };
export type StopPreparation = CommandPreparation & { readonly request: Extract<ResolvedRequest, { readonly _tag: 'Stop' }> };
export type RevisePreparation = CommandPreparation & {
  readonly request: Extract<ResolvedRequest, { readonly _tag: 'Revise' }>;
  readonly revision: CommandRevision;
};

export class CommandAccess extends Context.Service<
  CommandAccess,
  {
    readonly prepare: (
      request: CommandAccessRequest,
    ) => Effect.Effect<CommandPreparation, TerminalRefused | TerminalUnavailable | ExecutionsFailure | StoreFailure>;
    readonly recheck: (unit: Unit<'machine'>, prepared: CommandPreparation) => Effect.Effect<void, TerminalRefused | TerminalUnavailable>;
  }
>()('tagma/executions/CommandAccess') {}
