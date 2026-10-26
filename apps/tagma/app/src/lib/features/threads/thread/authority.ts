import type { Effect } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';
import type { ThreadRefused } from './ThreadRefused.js';

export const DELEGATION_PICKS = ['on', 'off', 'inherit'] as const;
export type DelegationPick = (typeof DELEGATION_PICKS)[number];
export const DELEGATION_OWN: Record<DelegationPick, boolean | null> = { on: true, off: false, inherit: null };

export type DelegationReading = {
  readonly own: boolean | null;
  readonly allowed: boolean | null;
  readonly origin: string | null;
  readonly depth: WireThread['spawnDepth'] | null;
};

export type ApprovingReading = WireThread['approving'];

export type ModeAction = { readonly id: string; readonly label: string; readonly description: string };

export const APPROVER_PICKS = ['you', 'default'] as const;
export type ApproverPick = (typeof APPROVER_PICKS)[number];

export interface AuthorityView {
  readonly approving?: ApprovingReading | null;
  readonly modeActions?: readonly ModeAction[];
  setApprover?(pick: ApproverPick): Effect.Effect<void, ThreadRefused>;
  setApproves?(approves: readonly string[] | null): Effect.Effect<void, ThreadRefused>;
  readonly modes: ThreadModes | null;
  readonly notes: readonly string[];
  readonly delegation: DelegationReading;
  readonly busy: boolean;
  readonly terminalRefusal: string | null;
  chooseMode(id: string): Effect.Effect<void, ThreadRefused>;
  setDelegation(pick: DelegationPick): Effect.Effect<void, ThreadRefused>;
  promoteDelegation(): Effect.Effect<void, ThreadRefused>;
}
