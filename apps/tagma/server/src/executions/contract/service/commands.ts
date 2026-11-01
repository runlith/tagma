import { Context, type Effect, type Queue, type Stream } from 'effect';
import type { ExecutionRef, HostRequestKey, Incarnation } from '@runlith/executions/protocol/execution';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import type { CommandDeadline, CommandRevision, CommandRevisionAnswer, CommandRevisionRequest } from '@runlith/executions/protocol/command';
import type { InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import type { ByteCursor, RecordRange, StreamPositions } from '@runlith/executions/protocol/record';
import type { StopAction, StopReceipt } from '@runlith/executions/protocol/stop';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { InventoryMoves } from '../../terminals/inventory.js';
import type { CommandMarks } from '../../store/commandRows.js';
import type { CommandState, ExecutionStoreFailure } from '../../store/rows.js';
import type { CommandFeedFrame } from '../wire/commandFeed.js';
import type { CommandDelivery, CommandRecord, CommandWait, CommandWaitMode } from '../wire/commands.js';
import type { CommandSubject } from '../wire/commandSubject.js';
import type {
  CommandCursor,
  CommandHostAnswer,
  CommandListAnswer,
  CommandLive,
  CommandOutputReading,
  CommandReading,
  CommandSearchReading,
  CommandSelection,
  OutputStream,
} from '../wire/commands.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { OperationKeyRetention, TerminalOperationKey } from '../wire/requestKeys.js';
import type { TerminalRefused, TerminalUnavailable } from '../wire/refusals.js';
import type { TerminalWaitAnswer } from '../wire/terminals.js';
import type { AwaitPreparation, LaunchPreparation, ObservePreparation, RevisePreparation, StopPreparation } from './access.js';
import type { BytesOptions } from './records.js';
import type { TerminalFailure } from './terminals.js';
import type { TerminalAdopters } from './adopters.js';
import type { CallDebt, CallDebts } from './notices.js';
import { sql, type SQL } from 'drizzle-orm';
import { commandDelivery } from '../../store/terminal.js';
import { projectRows } from '../../../platform/contract/service/projections.js';

export const deliveryRows = projectRows({
  id: 'executions.delivery',
  table: commandDelivery,
  keys: ['executionId'],
  address: 'threadId',
  columns: { executionId: commandDelivery.executionId, threadId: commandDelivery.threadId },
});

export const commandOwedThreads: SQL = sql`select ${commandDelivery.threadId} as id from ${commandDelivery}`;
export const commandOwing = (thread: SQL): SQL<number> =>
  sql<number>`exists (select 1 from (${commandOwedThreads}) debt where debt.id = ${thread})`;

export type CommandAuthority<TPrepared> = {
  readonly prepared: TPrepared;
  readonly recheck: (unit: Unit<'machine'>) => Effect.Effect<void, TerminalRefused | TerminalUnavailable>;
};

export type CommandLaunch = CommandAuthority<LaunchPreparation> & {
  readonly wait?: CommandWaitMode;
  readonly label?: string;
};

export type CommandSweep = {
  readonly fences: readonly number[];
  readonly stopped: readonly StopReceipt[];
  readonly standing: readonly ExecutionRef[];
  readonly refused: readonly { readonly execution: ExecutionRef; readonly refusal: TerminalRefused }[];
  readonly unresolved: readonly TerminalOperationKey[];
};

export type CommandLives = {
  readonly live: (execution: ExecutionRef) => CommandLive;
  readonly host: CommandHostAnswer;
};

export type CommandPage = {
  readonly rows: readonly CommandState[];
  readonly after?: CommandCursor;
};

export class CommandReader extends Context.Service<
  CommandReader,
  {
    readonly page: (projectId: number, selection: CommandSelection) => Effect.Effect<CommandListAnswer, TerminalFailure>;
    readonly rows: (projectId: number, selection: CommandSelection) => Effect.Effect<CommandPage, TerminalFailure>;
    readonly lives: (refs: readonly ExecutionRef[]) => Effect.Effect<CommandLives>;
    readonly operationKeys: () => Effect.Effect<OperationKeyRetention, TerminalFailure>;
    readonly marks: (projectId: number) => Effect.Effect<CommandMarks, TerminalFailure>;
    readonly one: (projectId: number, execution: string, incarnation: number) => Effect.Effect<CommandReading, TerminalFailure>;
    readonly output: (request: CommandOutputRequest) => Effect.Effect<CommandOutputReading, TerminalFailure>;
    readonly search: (
      request: CommandSearchRequest,
    ) => Effect.Effect<CommandSearchReading, TerminalFailure | GateRefusal<OutputSearchRefusal>>;
    readonly follow: (
      projectId: number,
      bounds: { readonly ended: number },
      adopters: TerminalAdopters['Service'],
    ) => Stream.Stream<CommandFeedFrame, TerminalFailure>;
  }
>()('tagma/executions/CommandReader') {}

export type CommandOutputRequest = {
  readonly projectId: number;
  readonly reader: string;
  readonly thread: ThreadId | undefined;
  readonly execution: ExecutionRef;
  readonly authority: CommandAuthority<ObservePreparation>;
  readonly tail?: number;
};

export type OutputSearchRefusal = 'search-failed' | 'search-unavailable' | 'bad-cursor' | 'cursor-stale';

export type CommandSearchRequest = {
  readonly projectId: number;
  readonly execution: ExecutionRef;
  readonly authority: CommandAuthority<ObservePreparation>;
  readonly pattern: string;
  readonly stream?: OutputStream;
  readonly ignoreCase?: boolean;
  readonly before: number;
  readonly after: number;
  readonly limit: number;
  readonly budget: number;
  readonly cursor?: string;
};

export type CommandDeliveryCursor = { readonly openedAt: number; readonly execution: string };

type DeliveryFailure = ExecutionStoreFailure | StoreFailure;

export type CommandWaitMove =
  | { readonly _tag: 'Moved'; readonly wait: CommandWait }
  | { readonly _tag: 'Stale'; readonly wait: CommandWait }
  | { readonly _tag: 'Ended' };

export class CommandWaiters extends Context.Service<
  CommandWaiters,
  {
    readonly owed: (execution: ExecutionRef) => Effect.Effect<CommandDelivery | null, DeliveryFailure>;
    readonly outstanding: (after?: CommandDeliveryCursor) => Effect.Effect<readonly CommandDelivery[], DeliveryFailure>;
    readonly owing: (threads?: readonly string[]) => Effect.Effect<readonly string[], StoreFailure>;
    readonly accepted: (unit: WriteUnit<'machine'>, execution: ExecutionRef) => Effect.Effect<boolean, ExecutionStoreFailure>;
    readonly delivered: (execution: ExecutionRef) => Effect.Effect<void, DeliveryFailure>;
    readonly take: (execution: ExecutionRef, thread: ThreadId) => Effect.Effect<boolean, DeliveryFailure>;
    readonly seen: (execution: ExecutionRef, thread: ThreadId, signalId: string) => Effect.Effect<void, DeliveryFailure>;
    readonly answered: (
      execution: ExecutionRef,
      thread: ThreadId,
      signalId: string,
      alongside: (unit: WriteUnit<'machine'>) => Effect.Effect<void, DeliveryFailure>,
    ) => Effect.Effect<void, DeliveryFailure>;
    readonly unread: (execution: ExecutionRef) => Effect.Effect<void, DeliveryFailure>;
    readonly recover: () => Effect.Effect<void, DeliveryFailure>;
    readonly due: (execution: ExecutionRef) => Effect.Effect<void>;
    readonly debts: Effect.Effect<CallDebts>;
    readonly background: (
      execution: ExecutionRef,
      expected: number,
      owed: CommandDelivery | null,
      call: CallDebt | null,
    ) => Effect.Effect<CommandWaitMove, DeliveryFailure>;
    readonly measured: (execution: ExecutionRef, words: string) => Effect.Effect<void, DeliveryFailure>;
    readonly measurement: (execution: ExecutionRef) => Effect.Effect<string | null | undefined, DeliveryFailure>;
    readonly ended: Queue.Dequeue<ExecutionRef>;
  }
>()('tagma/executions/CommandWaiters') {}

export type CommandCall = { readonly thread: ThreadId; readonly run?: string; readonly toolCall: string };

export type StartedCommand = { readonly record: CommandRecord; readonly operation: HostRequestKey };

export class ManagedCommands extends Context.Service<
  ManagedCommands,
  {
    readonly record: (executionId: string, incarnation?: Incarnation) => Effect.Effect<CommandRecord | null, TerminalFailure>;
    readonly startedBy: (projectId: number, call: CommandCall) => Effect.Effect<StartedCommand | null, TerminalFailure>;
    readonly revise: (
      key: TerminalOperationKey,
      execution: ExecutionRef,
      authority: CommandAuthority<RevisePreparation>,
      cause: CommandRevisionRequest['cause'],
      expected: CommandRevision,
    ) => Effect.Effect<CommandRevisionAnswer, TerminalFailure>;
    readonly background: (execution: ExecutionRef) => Effect.Effect<'moved' | 'already' | 'ended', TerminalFailure>;
    readonly foreground: (execution: ExecutionRef) => Effect.Effect<'withdrawn' | 'delivered', TerminalFailure>;
    readonly measured: (execution: ExecutionRef, words: string) => Effect.Effect<void, TerminalFailure>;
    readonly deadline: (execution: ExecutionRef) => Effect.Effect<CommandDeadline | null, TerminalFailure>;
    readonly wait: (
      execution: ExecutionRef,
      authority: CommandAuthority<AwaitPreparation>,
      waitMs: number,
    ) => Effect.Effect<TerminalWaitAnswer, TerminalFailure>;
    readonly bytes: (
      cursor: ByteCursor,
      limit: number,
      authority: CommandAuthority<ObservePreparation>,
      options?: BytesOptions,
    ) => Effect.Effect<{ readonly range: RecordRange; readonly positions?: StreamPositions; readonly bytes: Uint8Array }, TerminalFailure>;
    readonly stop: (
      projectId: number,
      key: TerminalOperationKey,
      execution: ExecutionRef,
      authority: CommandAuthority<StopPreparation>,
      cause: CancellationCause,
      action: StopAction,
      trigger?: string,
    ) => Effect.Effect<StopReceipt, TerminalFailure>;
    readonly stopAll: (
      projectId: number,
      owners: readonly CommandSubject[],
      key: TerminalOperationKey,
      authorize: (execution: ExecutionRef) => Effect.Effect<CommandAuthority<StopPreparation>, TerminalFailure>,
      cause: CancellationCause,
      action: StopAction,
      run?: string,
    ) => Effect.Effect<CommandSweep, TerminalFailure>;
    readonly changes: () => Stream.Stream<InventoryFeedItem>;
    readonly moves: () => Effect.Effect<InventoryMoves>;
  }
>()('tagma/executions/ManagedCommands') {}
