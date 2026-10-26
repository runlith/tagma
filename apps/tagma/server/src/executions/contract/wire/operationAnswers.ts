import * as Schema from 'effect/Schema';
import { PageCursor } from '@runlith/paging';
import { CommandRevisionAnswer } from '@runlith/executions/protocol/command';
import { CustodyAnswer } from '@runlith/executions/protocol/control';
import { Principal } from '@runlith/executions/protocol/custody';
import { ListenerReport, ProcessReport } from '@runlith/executions/protocol/evidence';
import { ExecutionState } from '@runlith/executions/protocol/execution';
import { InputAnswer } from '@runlith/executions/protocol/input';
import { ScreenAnswer } from '@runlith/executions/protocol/presentation';
import { RecordRange, StreamPositions, TerminalGeometry } from '@runlith/executions/protocol/record';
import { HostMemory } from '@runlith/executions/protocol/runtime';
import { SignalAnswer, StopReceipt } from '@runlith/executions/protocol/stop';
import { TerminalRow, TerminalView, TerminalWaitAnswer } from './terminals.js';
import { OperationKeyRetention, TerminalOperationAnswer } from './requestKeys.js';
import { TerminalLaneRow } from './viewLeases.js';
import { WindowBytes } from './bytes.js';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const typedBy = {
  typedBy: Schema.optional(Schema.Array(Schema.Struct({ writer: Principal, at: Schema.String }))),
};

export const ByteChunk = Schema.Struct({
  range: RecordRange,
  positions: Schema.optional(StreamPositions),
  bytes: WindowBytes,
});
export type ByteChunk = typeof ByteChunk.Type;

export const TerminalInventory = Schema.Struct({
  terminals: Schema.Array(TerminalRow),
  shown: count,
  total: count,
  next: Schema.NullOr(PageCursor),
  complete: Schema.Boolean,
  host: Schema.NullOr(HostMemory),
  operationKeys: OperationKeyRetention,
  grants: Schema.Struct({ view: count, harness: count, agent: count }),
  notice: Schema.NullOr(Schema.String),
  geometry: TerminalGeometry,
});

export const TerminalReading = Schema.Struct({
  terminal: TerminalView,
  state: Schema.NullOr(ExecutionState),
  grid: Schema.NullOr(TerminalGeometry),
  lanes: Schema.Array(TerminalLaneRow),
  ...typedBy,
});

export const TerminalScreenReading = Schema.Struct({ screen: ScreenAnswer, ...typedBy });

export const TerminalBytesReading = Schema.Struct({ ...ByteChunk.fields, ...typedBy });

export const TerminalWaited = Schema.Struct({ waited: TerminalWaitAnswer, ...typedBy });

export const TerminalProcesses = Schema.Struct({ report: Schema.optional(ProcessReport) });

export const TerminalPorts = Schema.Struct({ report: Schema.optional(ListenerReport) });

export const TerminalOperationReading = Schema.Struct({ operation: TerminalOperationAnswer });

export const TerminalInputOutcome = Schema.Struct({ outcome: InputAnswer });

export const TerminalTransferred = Schema.Struct({ outcome: CustodyAnswer, terminal: Schema.NullOr(TerminalView) });

export const TerminalSignalled = Schema.Struct({ outcome: SignalAnswer });

export const ExecutionStopped = Schema.Struct({ receipt: StopReceipt });

export const CommandWaited = Schema.Struct({ waited: TerminalWaitAnswer });

export const CommandLimitChanged = Schema.Struct({ outcome: CommandRevisionAnswer });
