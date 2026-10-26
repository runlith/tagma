import type { AskedReason } from '@runlith/agent/permissions';
import type { OperationConfirmation } from './operation.js';

export const APPROVAL_WAIT_MS = 50_000;

export type ApprovalRoute = {
  readonly project: number | null;
  readonly cwd: string | null;
  readonly checkout: string | null;
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly checkoutHead: string | null;
  readonly workspaceHead: string | null;
  readonly scope: string | null;
};

export type ApprovalAsk = {
  readonly threadId: string;
  readonly operation: string;
  readonly key: string;
  readonly reasons: readonly AskedReason[];
  readonly confirmation: OperationConfirmation;
  readonly route: ApprovalRoute;
  readonly timeoutMs: number | null;
  readonly waitMs: number;
};

export type ApprovalAnswer =
  | { readonly _tag: 'Given' }
  | { readonly _tag: 'Declined'; readonly by: string; readonly note?: string }
  | { readonly _tag: 'Waiting'; readonly questionId: string; readonly waitedMs: number }
  | { readonly _tag: 'Lapsed'; readonly questionId: string; readonly askedOf: string; readonly timeoutMs: number }
  | { readonly _tag: 'Unseated'; readonly reason?: string };
