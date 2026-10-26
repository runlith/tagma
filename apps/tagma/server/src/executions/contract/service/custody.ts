import { Context, type Effect, type Queue, type Stream } from 'effect';
import type { CustodyRevision, Principal } from '@runlith/executions/protocol/custody';
import type { HostRequestKey, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { CommandRecord } from '../wire/commands.js';
import type { TerminalRecord } from '../wire/terminals.js';
import type { ExecutionStoreFailure } from '../../store/rows.js';
import type { CustodyAnswer, CustodyTransfer } from '@runlith/executions/protocol/control';
import type { Disowned } from '@runlith/executions/protocol/keep';
import type { TerminalActor } from '../wire/terminals.js';
import type { TerminalTakeOverAnswer } from '../wire/viewLeases.js';
import type { TerminalOperationKey } from '../wire/requestKeys.js';
import type { TerminalFailure } from './terminals.js';

export const HOST_REPLACED = 'host-replaced';

export type CustodyNoticeCursor = { readonly openedAt: number; readonly projectId: number; readonly operationId: string };

export type CustodyNotice = {
  readonly projectId: number;
  readonly operationId: string;
  readonly thread: string;
  readonly requester: string;
  readonly execution: ExecutionRef;
  readonly expected: number;
  readonly name: string;
  readonly state: 'intent' | 'owed';
  readonly openedAt: number;
};

export type TerminalTakeOver = {
  readonly actor: TerminalActor;
  readonly projectId: number;
  readonly operationId: HostRequestKey;
  readonly execution: ExecutionRef;
};

export type TerminalDisplaced = { readonly projectId: number; readonly operationId: string };

export const UNATTRIBUTED_MOVE = 'unattributed';

export type NoticeDecision =
  | { readonly _tag: 'Owed'; readonly notice: CustodyNotice }
  | { readonly _tag: 'Gone' }
  | { readonly _tag: 'Undecided' };

export class Custody extends Context.Service<
  Custody,
  {
    readonly move: (
      projectId: number,
      key: TerminalOperationKey,
      execution: ExecutionRef,
      expected: CustodyRevision,
      act: CustodyTransfer,
      principal: Principal,
    ) => Effect.Effect<CustodyAnswer, TerminalFailure>;
    readonly takeOver: (request: TerminalTakeOver) => Effect.Effect<TerminalTakeOverAnswer, TerminalFailure>;
    readonly displaced: Queue.Dequeue<TerminalDisplaced>;
    readonly fencesOf: (
      unit: Unit<'machine'>,
      threadIds: readonly ThreadId[],
    ) => Effect.Effect<readonly TerminalOperationKey[], ExecutionStoreFailure>;
    readonly heldBy: (
      unit: Unit<'machine'>,
      threadIds: readonly ThreadId[],
    ) => Effect.Effect<readonly TerminalRecord[], ExecutionStoreFailure>;
    readonly holdingUses: (
      unit: Unit<'machine'>,
      projectId: number,
      useIds: readonly string[],
    ) => Effect.Effect<
      { readonly terminals: readonly TerminalRecord[]; readonly commands: readonly CommandRecord[] },
      ExecutionStoreFailure
    >;
    readonly pendingNotices: (limit: number, after?: CustodyNoticeCursor) => Effect.Effect<readonly CustodyNotice[], TerminalFailure>;
    readonly noticeDecided: (notice: CustodyNotice) => Effect.Effect<NoticeDecision, TerminalFailure>;
    readonly noticeDelivered: (notice: {
      readonly projectId: number;
      readonly operationId: string;
    }) => Effect.Effect<void, TerminalFailure>;
    readonly stillDisplaced: (notice: CustodyNotice) => Effect.Effect<boolean | null>;
    readonly moves: (projectId: number) => Stream.Stream<void>;
    readonly disown: (disowned: Disowned) => Effect.Effect<void>;
    readonly disownThreads: (threadIds: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly disownProject: (projectId: number) => Effect.Effect<void>;
    readonly disownGone: () => Effect.Effect<void>;
  }
>()('tagma/executions/Custody') {}
