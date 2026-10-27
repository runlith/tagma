import { Schema } from 'effect';
import { ExecutionRef } from './execution';
import { InputRevision } from './inputProfile';
import { ByteOffset, TerminalGeometry } from './record';

export const InputCause = Schema.Literals(['typed', 'paste', 'raw', 'mouse', 'interrupt', 'resize', 'reply', 'end']);
export type InputCause = typeof InputCause.Type;

export const InputSequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type InputSequence = typeof InputSequence.Type;

export const InputFrontier = Schema.Struct({
  sequence: Schema.optional(InputSequence),
  acceptedThrough: ByteOffset,
  pendingBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type InputFrontier = typeof InputFrontier.Type;

export const InputInstruction = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Write'), bytes: Schema.Uint8Array }),
  Schema.Struct({ _tag: Schema.Literal('End') }),
  Schema.Struct({ _tag: Schema.Literal('Interrupt') }),
  Schema.Struct({ _tag: Schema.Literal('Resize'), geometry: TerminalGeometry }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type InputInstruction = typeof InputInstruction.Type;

export const InputRequest = Schema.Struct({
  sequence: InputSequence,
  cause: InputCause,
  profile: Schema.optional(InputRevision),
  act: InputInstruction,
});
export type InputRequest = typeof InputRequest.Type;

export const InputReceipt = Schema.Struct({
  execution: ExecutionRef,
  sequence: InputSequence,
  cause: InputCause,
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  acceptedThrough: ByteOffset,
});
export type InputReceipt = typeof InputReceipt.Type;

export const InputUnsupported = Schema.Struct({
  _tag: Schema.Literal('InputUnsupported'),
  act: Schema.Literals(['interrupt', 'resize', 'end']),
  reason: Schema.Literals(['transport', 'isig-disabled', 'no-character', 'geometry', 'unreadable']),
  detail: Schema.String,
});
export type InputUnsupported = typeof InputUnsupported.Type;

export const InputAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('InputAdmitted'), receipt: InputReceipt }),
  Schema.Struct({ _tag: Schema.Literal('InputEnded') }),
  Schema.Struct({
    _tag: Schema.Literal('InputBackpressure'),
    frontier: InputFrontier,
    pendingBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    limit: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  Schema.Struct({ _tag: Schema.Literal('InputConflict'), sequence: InputSequence }),
  Schema.Struct({
    _tag: Schema.Literal('InputReceiptExpired'),
    sequence: InputSequence,
    retainedFrom: InputSequence,
  }),
  InputUnsupported,
]).pipe(Schema.toTaggedUnion('_tag'));
export type InputAnswer = typeof InputAnswer.Type;
