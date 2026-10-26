import * as Schema from 'effect/Schema';
import { Incarnation } from '@runlith/executions/protocol/execution';
import { Principal, BindingId, CustodyRevision } from '@runlith/executions/protocol/custody';
import { InputAnswer, InputSequence } from '@runlith/executions/protocol/input';
import { UncertainEffect } from '@runlith/executions/protocol/host';
import { FrameRevision, ScreenFeedItem, ScreenPoint, ScreenUnavailable } from '@runlith/executions/protocol/presentation';
import { ByteOffset, RecordRange, Stream as RecordStream } from '@runlith/executions/protocol/record';
import { SubscriptionEnding } from '@runlith/executions/protocol/wire';

export type DeliveryMark = FrameRevision | ByteOffset;
export type ViewerSource = RecordStream | 'screen';
export type LaneOpened = { readonly binding: BindingId };

export const ViewLeaseId = Schema.NonEmptyString.pipe(Schema.brand('ViewLeaseId'));
export type ViewLeaseId = typeof ViewLeaseId.Type;

export const TerminalScreenSubscription = Schema.Struct({
  projectId: Schema.Int,
  execution: Schema.NonEmptyString,
  incarnation: Incarnation,
  base: Schema.optional(FrameRevision),
});
export type TerminalScreenSubscription = typeof TerminalScreenSubscription.Type;

export const DeliveredBytes = Schema.Uint8Array;

export const TerminalScreenDelivery = Schema.Struct({ viewer: ViewLeaseId, update: ScreenFeedItem });
export type TerminalScreenDelivery = typeof TerminalScreenDelivery.Type;

export const TerminalBytesSubscription = Schema.Struct({
  projectId: Schema.Int,
  execution: Schema.NonEmptyString,
  incarnation: Incarnation,
  stream: RecordStream,
  offset: ByteOffset,
});
export type TerminalBytesSubscription = typeof TerminalBytesSubscription.Type;

export const CommandBytesSubscription = Schema.Struct({
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  execution: Schema.NonEmptyString,
  incarnation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  stream: Schema.Literals(['stdout', 'stderr', 'output']),
  offset: ByteOffset,
});
export type CommandBytesSubscription = typeof CommandBytesSubscription.Type;

export const RecordChunk = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Bytes'), range: RecordRange, bytes: DeliveredBytes }),
  Schema.Struct({ _tag: Schema.Literal('Ended'), ending: SubscriptionEnding }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type RecordChunk = typeof RecordChunk.Type;

export const RecordDelivery = Schema.Struct({ viewer: ViewLeaseId, chunk: RecordChunk });
export type RecordDelivery = typeof RecordDelivery.Type;

export const RecordParsed = Schema.Struct({ viewer: ViewLeaseId, offset: ByteOffset });
export type RecordParsed = typeof RecordParsed.Type;

export const ViewInputCause = Schema.Literals(['typed', 'paste', 'raw', 'mouse', 'interrupt', 'resize']);
export type ViewInputCause = typeof ViewInputCause.Type;

export const TerminalInputWrite = Schema.Struct({
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  execution: Schema.String.check(Schema.isMinLength(1)),
  incarnation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  binding: Schema.String.check(Schema.isMinLength(1)),
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  profile: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  act: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal('Write'), bytes: DeliveredBytes }),
    Schema.Struct({ _tag: Schema.Literal('Interrupt') }),
    Schema.Struct({
      _tag: Schema.Literal('Resize'),
      rows: Schema.Int.check(Schema.isGreaterThan(0)),
      columns: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ]).pipe(Schema.toTaggedUnion('_tag')),
  cause: ViewInputCause,
});
export type TerminalInputWrite = typeof TerminalInputWrite.Type;

export const TerminalInputReceipts = Schema.Struct({
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  execution: Schema.String.check(Schema.isMinLength(1)),
  incarnation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  binding: Schema.String.check(Schema.isMinLength(1)),
});
export type TerminalInputReceipts = typeof TerminalInputReceipts.Type;

export const TerminalInputReceipt = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('applied'),
    sequence: InputSequence,
    outcome: InputAnswer,
  }),
  Schema.Struct({
    kind: Schema.Literal('backpressure'),
    sequence: InputSequence,
    outcome: InputAnswer,
  }),
  Schema.Struct({
    kind: Schema.Literal('refused'),
    sequence: InputSequence,
    outcome: InputAnswer,
  }),
]).pipe(Schema.toTaggedUnion('kind'));
export type TerminalInputReceipt = typeof TerminalInputReceipt.Type;

export const ViewId = Schema.NonEmptyString.check(Schema.isMaxLength(128)).pipe(Schema.brand('ViewId'));
export type ViewId = typeof ViewId.Type;

export const TerminalBox = Schema.Struct({
  rows: Schema.Int.check(Schema.isGreaterThan(0)),
  columns: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type TerminalBox = typeof TerminalBox.Type;

const viewedExecution = {
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  execution: Schema.String.check(Schema.isMinLength(1)),
  incarnation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  view: ViewId,
};

export const TerminalGridSubscription = Schema.Struct({ ...viewedExecution, box: Schema.optional(TerminalBox) });
export type TerminalGridSubscription = typeof TerminalGridSubscription.Type;

export const TerminalGridReport = Schema.Struct({ ...viewedExecution, box: TerminalBox });
export type TerminalGridReport = typeof TerminalGridReport.Type;

export const TerminalDecider = Schema.Struct({ decider: Schema.NullOr(ViewId) });
export type TerminalDecider = typeof TerminalDecider.Type;

export const TerminalLaneOpened = Schema.Struct({ binding: BindingId });
export type TerminalLaneOpened = typeof TerminalLaneOpened.Type;

export const TerminalLaneClosed = Schema.Struct({ closed: Schema.Boolean });
export type TerminalLaneClosed = typeof TerminalLaneClosed.Type;

export const TerminalLaneKind = Schema.Literals(['view', 'harness', 'agent', 'grid']);
export type TerminalLaneKind = typeof TerminalLaneKind.Type;

export const TerminalLaneRow = Schema.Struct({ writer: Principal, kind: TerminalLaneKind });
export type TerminalLaneRow = typeof TerminalLaneRow.Type;

export const TerminalTakeOverAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Moved'), revision: CustodyRevision }),
  Schema.Struct({ _tag: Schema.Literal('Uncertain'), effect: UncertainEffect }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type TerminalTakeOverAnswer = typeof TerminalTakeOverAnswer.Type;

export const TerminalScreenPainted = Schema.Struct({ viewer: ViewLeaseId, revision: FrameRevision });
export type TerminalScreenPainted = typeof TerminalScreenPainted.Type;

export const TerminalScreenPointRead = Schema.Struct({
  projectId: Schema.Int,
  execution: Schema.NonEmptyString,
  incarnation: Incarnation,
  scrollback: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type TerminalScreenPointRead = typeof TerminalScreenPointRead.Type;

export const TerminalScreenPoint = Schema.Union([Schema.Struct({ ...ScreenPoint.fields, bytes: DeliveredBytes }), ScreenUnavailable]).pipe(
  Schema.toTaggedUnion('_tag'),
);
export type TerminalScreenPoint = typeof TerminalScreenPoint.Type;

export const TerminalAcknowledged = Schema.Struct({ acknowledged: Schema.Literal(true) });
export type TerminalAcknowledged = typeof TerminalAcknowledged.Type;
