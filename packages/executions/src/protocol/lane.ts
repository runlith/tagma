import { Schema } from 'effect';
import { BindingId, Principal } from './custody';
import { ExecutionId } from './execution';
import { InputAnswer, InputReceipt, InputSequence } from './input';
import { ByteOffset } from './record';

export const LANE_PATH = '/terminal';

export const LaneClose = { unknown: 4401, slow: 4408, replaced: 4409, closed: 4410, malformed: 1008 } as const;

export const TerminalLane = Schema.Struct({
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  token: Schema.NonEmptyString,
  next: InputSequence,
});
export type TerminalLane = typeof TerminalLane.Type;

export const LaneInput = Schema.Struct({ binding: BindingId, principal: Principal, receipt: InputReceipt });
export type LaneInput = typeof LaneInput.Type;

export const LaneHello = Schema.Struct({ lane: Schema.NonEmptyString });
export type LaneHello = typeof LaneHello.Type;

export const LaneCause = Schema.Literals(['typed', 'paste', 'raw', 'interrupt']);
export type LaneCause = typeof LaneCause.Type;

export const LaneAct = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Write'), bytes: Schema.Uint8ArrayFromBase64 }),
  Schema.Struct({ _tag: Schema.Literal('Interrupt') }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type LaneAct = typeof LaneAct.Type;

export const LaneRequest = Schema.Union([
  Schema.Struct({ t: Schema.Literal('act'), sequence: InputSequence, cause: LaneCause, act: LaneAct }),
  Schema.Struct({ t: Schema.Literal('follow'), offset: ByteOffset }),
]).pipe(Schema.toTaggedUnion('t'));
export type LaneRequest = typeof LaneRequest.Type;

export const LaneReply = Schema.Union([
  Schema.Struct({ t: Schema.Literal('ready'), execution: ExecutionId, head: ByteOffset }),
  Schema.Struct({ t: Schema.Literal('receipt'), sequence: InputSequence, answer: InputAnswer }),
  Schema.Struct({ t: Schema.Literal('behind'), retainedFrom: ByteOffset }),
  Schema.Struct({ t: Schema.Literal('ended') }),
]).pipe(Schema.toTaggedUnion('t'));
export type LaneReply = typeof LaneReply.Type;

export const LaneHelloText = Schema.fromJsonString(LaneHello);
export const LaneRequestText = Schema.fromJsonString(LaneRequest);
export const LaneReplyText = Schema.fromJsonString(LaneReply);

export const OUTPUT_OFFSET_BYTES = 8;

export const outputFrame = (offset: bigint, bytes: Uint8Array): Uint8Array => {
  const frame = new Uint8Array(OUTPUT_OFFSET_BYTES + bytes.length);
  new DataView(frame.buffer).setBigUint64(0, offset);
  frame.set(bytes, OUTPUT_OFFSET_BYTES);
  return frame;
};

export const readOutputFrame = (frame: Uint8Array): { readonly offset: bigint; readonly bytes: Uint8Array } | undefined =>
  frame.length < OUTPUT_OFFSET_BYTES
    ? undefined
    : {
        offset: new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getBigUint64(0),
        bytes: frame.subarray(OUTPUT_OFFSET_BYTES),
      };
