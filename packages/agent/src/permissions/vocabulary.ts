import type { Duration } from 'effect';

export const PERMISSION_KINDS = ['read', 'write', 'execute', 'network'] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export type PermissionSubject = {
  readonly kind: PermissionKind;
  readonly value: string;
  readonly binding?: string;
  readonly file?: true;
  readonly entry?: true;
  readonly tree?: true;
};

export type Rung = string;

export type Timeout = Duration.Duration | 'none';

export type Condition = {
  readonly id: string;
  readonly label: string;
  readonly asksFrom: Rung;
  readonly timeout: Timeout;
};

export type ConditionUse = Condition | { readonly condition: Condition; readonly asksFrom: Rung; readonly timeout: Timeout };

export type Approval =
  | { readonly asksFrom: 'never'; readonly when?: readonly ConditionUse[] }
  | {
      readonly asksFrom: Rung;
      readonly timeout: Timeout;
      readonly why?: string;
      readonly when?: readonly ConditionUse[];
    };

export type Raised = { readonly condition: string; readonly fact: string };

export type ApprovalAct = {
  readonly toolName: string;
  readonly mutating: boolean;
};

export type AskedReason = {
  readonly id: string;
  readonly text: string;
};

export type PermissionOutcome =
  | { readonly verdict: 'allow' }
  | { readonly verdict: 'ask'; readonly reasons: readonly AskedReason[]; readonly timeoutMs: number | null }
  | { readonly verdict: 'deny'; readonly code: string; readonly reason: string };

export type PermissionRefusal = {
  readonly status: 'refused';
  readonly code: string;
  readonly reason: string;
  readonly unblock?: readonly string[];
};

export type ApprovalView = {
  readonly summary: string;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly consequence?: string;
};

export const ASKS_NEVER: Approval = { asksFrom: 'never' };

export const ASKS_IN_REVIEW: Approval = { asksFrom: 'review', timeout: 'none' };

export const ASKS_IN_TRUST: Approval = { asksFrom: 'trust', timeout: 'none' };
