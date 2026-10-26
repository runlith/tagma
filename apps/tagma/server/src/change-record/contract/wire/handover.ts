import type { Raised } from '@runlith/agent/permissions';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type ChangeTaking = { readonly projectId: number | null; readonly threadId: string };

export type HandoverSession = ChangeTaking & {
  readonly label: string;
  readonly running: boolean;
};

export type SubmitHandover = {
  readonly taking: readonly HandoverSession[];
  readonly refusal: GateRefusal<'no-record'> | null;
  readonly consents: readonly Raised[];
};
