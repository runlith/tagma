import type { PermissionSubject } from '@runlith/agent/permissions';
import type { BindingId, CustodyRevision, Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef, HostRequestKey, Transport } from '@runlith/executions/protocol/execution';
import type { EnvironmentBinding } from '../../../workspace/contract/wire/environments.js';
import type { ResolvedExecutionTarget, TargetKey } from '../wire/targets.js';
import type { TerminalLifetime } from '../wire/terminals.js';

export type TerminalSubjectRequest =
  | { readonly _tag: 'Read'; readonly execution: ExecutionRef }
  | { readonly _tag: 'ReadOperation'; readonly operation: HostRequestKey }
  | {
      readonly _tag: 'Launch';
      readonly operation: HostRequestKey;
      readonly program: string;
      readonly args: readonly string[];
      readonly lifetime: TerminalLifetime;
      readonly transport: Transport;
      readonly interactive?: { readonly actor: Principal; readonly binding: BindingId };
    }
  | {
      readonly _tag: 'Input';
      readonly execution: ExecutionRef;
      readonly actor: Principal;
      readonly binding?: BindingId;
      readonly run?: string;
      readonly command: string;
    }
  | { readonly _tag: 'Signal'; readonly execution: ExecutionRef; readonly revision: CustodyRevision; readonly signal: string }
  | { readonly _tag: 'Stop'; readonly execution: ExecutionRef; readonly revision: CustodyRevision }
  | {
      readonly _tag: 'Transfer';
      readonly execution: ExecutionRef;
      readonly revision: CustodyRevision;
      readonly destination: Principal;
    };

export type TerminalFacts = {
  readonly projectId: number;
  readonly cwd: string;
  readonly environment: EnvironmentBinding;
  readonly roots: readonly string[];
  readonly command?: string;
  readonly lifetime?: TerminalLifetime;
  readonly transport?: Transport;
};

export type PreparedTerminalSubjects = {
  readonly subjects: readonly PermissionSubject[];
};

export type TerminalPlace =
  | {
      readonly _tag: 'Resolved';
      readonly target: ResolvedExecutionTarget;
      readonly targetKey?: TargetKey;
    }
  | { readonly _tag: 'Keyed'; readonly projectId: number; readonly targetKey: TargetKey };

export const TERMINAL_PERMISSION_REVISION = 0;
