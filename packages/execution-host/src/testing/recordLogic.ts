import { Effect, Layer, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { makeSegmentRecord } from '../ExecutionRecord';

const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'record-restart', incarnation: 37, execution: 'continued' });
const limits = Schema.decodeUnknownSync(ExecutionLimits)({
  input: { pendingBytes: 64, chunkBytes: 64, receipts: 2 },
  output: { landingBytes: 4, segmentBytes: 8, retainedBytes: 32 },
  parser: { pendingBytes: 64, cellBytes: 64 },
  geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
  read: { chunkBytes: 8, readerCredits: 64, readers: 2 },
  frame: { bytes: 64, inFlight: 1 },
  receipts: 2,
});

const [root, phase] = process.argv.slice(2);
if (root === undefined || (phase !== 'begin' && phase !== 'continue')) throw new Error('expected record root and begin or continue');
await Effect.runPromise(
  Effect.gen(function* () {
    const result = yield* Effect.gen(function* () {
      const record = yield* makeSegmentRecord({
        mode: phase === 'begin' ? 'create' : 'reopen',
        records: root,
        ref,
        transport: 'pty',
        limits,
        grid: { rows: 24, columns: 80 },
      });
      const append = (text: string) => record.append('pty', new TextEncoder().encode(text));
      if (phase === 'begin') {
        yield* append('abcd');
        yield* append('efgh');
        yield* record.regrid({ rows: 30, columns: 100 });
        yield* append('ijkl');
        return { ref, positions: yield* record.positions('pty') };
      }
      const resumed = yield* record.positions('pty');
      const cursor = { ref, stream: 'pty' as const, offset: byteOffset(8n) };
      const before = yield* record.read(cursor, 8);
      yield* append('mnop');
      const after = yield* record.read({ ...cursor, offset: before.range.next }, 8);
      yield* record.regrid({ rows: 40, columns: 120 });
      yield* append('qrst');
      yield* record.endStream('pty', 'eof');
      return { resumed, seen: new TextDecoder().decode(before.bytes) + new TextDecoder().decode(after.bytes), seal: yield* record.seal() };
    });
    yield* Effect.sync(() => {
      console.log(JSON.stringify(result));
      process.exit(0);
    });
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
