import { Context, Effect } from 'effect';
import {
  APPROVAL_WAIT_MS,
  type ApprovalAnswer,
  type ApprovalAsk,
  type ApprovalRoute as Route,
} from '../../../platform/contract/wire/approval.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { OperationConfirmation } from '../../../platform/contract/wire/operation.js';

export type ApprovalAct = { readonly input: unknown; readonly confirmation: () => OperationConfirmation };

export const ApprovalSeats = Context.Reference<{
  readonly ask: (request: ApprovalAsk) => Effect.Effect<ApprovalAnswer, GateRefusal<'approval-pending'>>;
} | null>('tagma/invocation/ApprovalSeats', {
  defaultValue: () => null,
});

export const ApprovalWait = Context.Reference<number>('tagma/invocation/ApprovalWait', { defaultValue: () => APPROVAL_WAIT_MS });

export const ApprovalRoute = Context.Reference<Effect.Effect<Route, GateRefusal>>('tagma/invocation/ApprovalRoute', {
  defaultValue: () =>
    Effect.succeed({
      project: null,
      cwd: null,
      checkout: null,
      workspace: null,
      branch: null,
      checkoutHead: null,
      workspaceHead: null,
      scope: null,
    }),
});
