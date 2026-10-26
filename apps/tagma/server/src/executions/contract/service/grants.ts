import { Context, type Effect } from 'effect';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InteractiveGrant } from '../wire/terminals.js';
import type { TargetKey } from '../wire/targets.js';
import type { TerminalRefused } from '../wire/refusals.js';

export type GrantRevocation =
  | 'run-ended'
  | 'view-closed'
  | 'binding-closed'
  | 'custody-transferred'
  | 'permission-withdrawn'
  | 'custodian-replaced'
  | 'execution-ended';

export type GrantEnding = {
  readonly grant: InteractiveGrant;
  readonly fence: 'fenced' | 'pending';
};

export type GrantClaim = {
  readonly projectId: number;
  readonly execution: ExecutionRef;
  readonly actor: Principal;
  readonly binding: BindingId;
  readonly targetKey: TargetKey;
  readonly permissionRevision: number;
  readonly runId?: string;
};

export type GrantRoad = 'view' | 'harness' | 'agent';

export type GrantEnded = (
  ended: { readonly projectId: number; readonly execution: ExecutionRef; readonly actor: Principal; readonly binding: BindingId },
  cause: GrantRevocation,
) => void;

type GrantLane = { readonly projectId: number; readonly execution: ExecutionRef; readonly actor: Principal; readonly binding: BindingId };

export class TerminalGrants extends Context.Service<
  TerminalGrants,
  {
    readonly mint: (grant: InteractiveGrant, road: GrantRoad) => Effect.Effect<InteractiveGrant, TerminalRefused>;
    readonly watch: (ended: GrantEnded) => () => void;
    readonly counts: () => Readonly<Record<GrantRoad, number>>;
    readonly roadOf: (grant: InteractiveGrant) => GrantRoad | null;
    readonly holds: (binding: BindingId) => boolean;
    readonly evidence: (claim: GrantClaim) => Effect.Effect<InteractiveGrant, TerminalRefused>;
    readonly revoke: (claim: GrantLane & { readonly runId?: string }, cause: GrantRevocation) => Effect.Effect<'fenced' | 'pending', never>;
    readonly closeOrKeep: (binding: BindingId, principal: Principal, fence?: string) => Effect.Effect<'fenced' | 'pending'>;
    readonly retryCloses: () => Effect.Effect<number>;
    readonly attendCloses: (everyMs: number) => Effect.Effect<never>;
    readonly unclosedCount: () => number;
    readonly settle: (
      projectId: number,
      targetKey: TargetKey,
      lane: { readonly execution: ExecutionRef; readonly road: GrantRoad },
      scope: { readonly binding: BindingId; readonly principal: Principal; readonly runId?: string; readonly decisionRevision: number },
    ) => Effect.Effect<void, TerminalRefused>;
    readonly over: (projectId: number, execution: ExecutionRef) => readonly InteractiveGrant[];
    readonly of: (actor: Principal) => readonly InteractiveGrant[];
    readonly endOver: (projectId: number, execution: ExecutionRef, cause: GrantRevocation) => Effect.Effect<readonly GrantEnding[], never>;
    readonly endOf: (actor: Principal, cause: GrantRevocation) => Effect.Effect<readonly GrantEnding[], never>;
    readonly endRun: (actor: Principal, runId: string, cause: GrantRevocation) => Effect.Effect<readonly GrantEnding[], never>;
    readonly withdrawn: (permissionRevision: number) => Effect.Effect<readonly GrantEnding[], never>;
    readonly revoking: (claim: GrantLane) => GrantRevocation | null;
  }
>()('tagma/executions/TerminalGrants') {}

export class ActingRun extends Context.Service<ActingRun, { readonly runId: string | null }>()('tagma/executions/ActingRun') {}
