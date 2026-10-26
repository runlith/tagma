import { Effect } from 'effect';
import { ByteOffset, offsetValue, byteOffset, type ByteCursor } from '@runlith/executions/protocol/record';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { OUTPUT_STREAMS } from '../contract/wire/commands.js';
import type { ExecutionRecords } from '../contract/service/records.js';
import type { TerminalFailure } from '../contract/service/terminals.js';

export const recordTail = Effect.fn('CommandOutput.recordTail')(function* (
  records: ExecutionRecords['Service'],
  execution: ExecutionRef,
  bytesPerStream: number,
): Effect.fn.Return<string, TerminalFailure> {
  const parts: string[] = [];
  for (const stream of OUTPUT_STREAMS) {
    const bounds = yield* records.bytes({ ref: execution, stream, offset: ByteOffset.make('0') }, 0, { withPositions: true });
    const retainedFrom = offsetValue(bounds.range.retainedFrom);
    const durable = offsetValue(bounds.range.durableThrough);
    const window = BigInt(bytesPerStream);
    const wanted = durable > window ? durable - window : 0n;
    const from = wanted < retainedFrom ? retainedFrom : wanted;
    if (durable <= from) continue;
    const bytes = yield* readRange(records.bytes, { ref: execution, stream, offset: byteOffset(from) }, durable);
    const text = decodeUtf8(bytes);
    if (text !== '') parts.push(text);
  }
  return parts.join('\n');
});

export const readRange = Effect.fn('CommandOutput.readRange')(function* (
  read: ExecutionRecords['Service']['bytes'],
  cursor: ByteCursor,
  through: bigint,
): Effect.fn.Return<Uint8Array, TerminalFailure> {
  const from = offsetValue(cursor.offset);
  const bytes = new Uint8Array(Number(through - from));
  yield* walkRange(read, cursor, through, (chunk, at) => Effect.sync(() => bytes.set(chunk, Number(at - from))));
  return bytes;
});

export const walkRange = Effect.fnUntraced(function* <E>(
  read: ExecutionRecords['Service']['bytes'],
  cursor: ByteCursor,
  through: bigint,
  take: (chunk: Uint8Array, at: bigint) => Effect.Effect<void, E>,
): Effect.fn.Return<void, TerminalFailure | E> {
  let at = offsetValue(cursor.offset);
  while (at < through) {
    const chunk = yield* read({ ...cursor, offset: byteOffset(at) }, Number(through - at));
    if (chunk.range.gap) {
      return yield* new TerminalRefused({
        reason: 'record-lost',
        message: `${cursor.stream} no longer retains the selected output at byte ${at}; retained from ${chunk.range.retainedFrom}.`,
      });
    }
    const next = offsetValue(chunk.range.next);
    if (next <= at) {
      return yield* new TerminalUnavailable({
        owner: 'host',
        message: `${cursor.stream} stopped at byte ${at} before the selected output ended at ${through}.`,
      });
    }
    yield* take(chunk.bytes, at);
    at = next;
  }
});

export const decodeUtf8 = (bytes: Uint8Array): string => {
  let start = 0;
  while (start < bytes.length && ((bytes[start] as number) & 0xc0) === 0x80) start += 1;
  return new TextDecoder().decode(bytes.subarray(start));
};

export const lastLines = (text: string, lines: number): string => {
  if (lines <= 0) return '';
  let cut = text.length;
  let seen = 0;
  for (let at = text.length - 1; at >= 0; at -= 1) {
    if (text[at] !== '\n' || at === text.length - 1) continue;
    seen += 1;
    if (seen === lines) {
      cut = at + 1;
      break;
    }
  }
  return seen < lines ? text : text.slice(cut);
};
