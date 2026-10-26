import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { RecordFiles } from '@runlith/executions/RecordFiles';
import { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import {
  CRC32_INITIAL,
  JOURNAL_FILE,
  SEAL_FILE,
  crc32Final,
  crc32Update,
  encodeSegmentHeader,
  recordFolder,
  segmentFile,
} from '@runlith/executions/recordFormat';
import { makeSegmentRecord } from './ExecutionRecord';
import { upgradeRecords } from './RecordUpgrade';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const limits = Schema.decodeUnknownSync(ExecutionLimits)({
  input: { pendingBytes: 64, chunkBytes: 64, receipts: 2 },
  output: { landingBytes: 8, segmentBytes: 8, retainedBytes: 16 },
  parser: { pendingBytes: 64, cellBytes: 64 },
  geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
  read: { chunkBytes: 8, readerCredits: 64, readers: 2 },
  frame: { bytes: 64, inFlight: 1 },
  receipts: 2,
});

it.live('pipes records from before the output stream keep their bytes: a live one carries output from its reopening on', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const files = yield* RecordFiles;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-output-upgrade-' });
      const payload = new TextEncoder().encode('abc');
      const written = Effect.fnUntraced(function* (execution: string) {
        const ref = yield* Schema.decodeUnknownEffect(ExecutionRef)({ installation: 'record-output', incarnation: 1, execution });
        const folder = recordFolder(ref.execution);
        if (typeof folder !== 'string') return yield* folder;
        const directory = path.join(root, folder);
        for (const [stream, bytes] of [
          ['stdout', payload],
          ['stderr', new Uint8Array(0)],
        ] as const) {
          const header = encodeSegmentHeader(stream, 0n);
          if ('defect' in header) return yield* Effect.die(header.detail);
          yield* fs.makeDirectory(path.join(directory, stream), { recursive: true });
          const file = new Uint8Array(header.length + bytes.length);
          file.set(header);
          file.set(bytes, header.length);
          yield* fs.writeFile(path.join(directory, stream, segmentFile(0n)), file);
        }
        return { ref, directory };
      });
      const live = yield* written('live');
      const opening = { stream: 'stdout', retainedFrom: '0', segments: [], ending: 'open', grid: [] };
      yield* fs.writeFileString(
        path.join(live.directory, JOURNAL_FILE),
        `${JSON.stringify({ _tag: 'Snapshot', state: { ref: live.ref, transport: 'pipes', streams: [opening, { ...opening, stream: 'stderr' }] } })}\n`,
      );
      const sealed = yield* written('sealed');
      const checksum = (bytes: Uint8Array) => crc32Final(crc32Update(CRC32_INITIAL, bytes));
      const stream = (name: string, bytes: Uint8Array) => ({
        positions: { stream: name, retainedFrom: '0', durableThrough: String(bytes.length), parsedThrough: '0', ending: 'eof' },
        tail: 'complete',
        segments: [{ first: '0', end: String(bytes.length), checksum: checksum(bytes) }],
      });
      yield* fs.writeFileString(
        path.join(sealed.directory, SEAL_FILE),
        JSON.stringify({ ref: sealed.ref, transport: 'pipes', streams: [stream('stdout', payload), stream('stderr', new Uint8Array(0))] }),
      );
      yield* upgradeRecords({ records: root });
      yield* upgradeRecords({ records: root });
      const retired = yield* files.open(root, sealed.ref);
      const retiredOut = yield* retired.read({ ref: sealed.ref, stream: 'stdout', offset: byteOffset(0n) }, 8);
      const retiredOutput = yield* Effect.flip(retired.read({ ref: sealed.ref, stream: 'output', offset: byteOffset(0n) }, 8));
      const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref: live.ref, transport: 'pipes', limits });
      const reopened = yield* record.positions('output');
      yield* record.capture('stdout', 8, Effect.succeed(new TextEncoder().encode('def')));
      const stdout = yield* record.read({ ref: live.ref, stream: 'stdout', offset: byteOffset(0n) }, 8);
      const output = yield* record.read({ ref: live.ref, stream: 'output', offset: byteOffset(0n) }, 8);
      return { retiredOut, retiredOutput, reopened, stdout, output };
    }).pipe(Effect.provide(Layer.merge(platform, RecordFiles.layer.pipe(Layer.provide(platform)))));
    expect(new TextDecoder().decode(outcome.retiredOut.bytes)).toBe('abc');
    expect(outcome.retiredOutput).toMatchObject({ _tag: 'RecordCursorRefused', reason: 'stream' });
    expect(outcome.reopened).toMatchObject({ retainedFrom: byteOffset(0n), durableThrough: byteOffset(0n), ending: 'open' });
    expect(new TextDecoder().decode(outcome.stdout.bytes)).toBe('abcdef');
    expect(new TextDecoder().decode(outcome.output.bytes)).toBe('def');
  }),
);
it.live('opening the record store translates numbered headers and seals once while preserving payload and known grids', () =>
  Effect.gen(function* () {
    const records = yield* Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const files = yield* RecordFiles;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-layout-' });
      const payload = new TextEncoder().encode('abcdefgh');
      const refs: ExecutionRef[] = [];
      for (const number of [1, 2]) {
        const ref = yield* Schema.decodeUnknownEffect(ExecutionRef)({
          installation: 'record-layout',
          incarnation: 1,
          execution: `numbered-${number}`,
        });
        refs.push(ref);
        const folder = recordFolder(ref.execution);
        if (typeof folder !== 'string') return yield* folder;
        const directory = path.join(root, folder);
        yield* fs.makeDirectory(path.join(directory, 'pty'), { recursive: true });
        const header = encodeSegmentHeader('pty', 0n);
        if ('defect' in header) return yield* Effect.die(header.detail);
        const view = new DataView(header.buffer);
        view.setUint16(4, number, true);
        view.setUint32(16, crc32Final(crc32Update(CRC32_INITIAL, header.subarray(0, 16))), true);
        const bytes = new Uint8Array(header.length + payload.length);
        bytes.set(header);
        bytes.set(payload, header.length);
        yield* fs.writeFile(path.join(directory, 'pty', segmentFile(0n)), bytes);
        yield* fs.writeFileString(
          path.join(directory, SEAL_FILE),
          JSON.stringify({
            version: number,
            ref,
            transport: 'pty',
            streams: [
              {
                positions: { stream: 'pty', retainedFrom: '0', durableThrough: '8', parsedThrough: '0', ending: 'eof' },
                tail: 'complete',
                segments: [{ first: '0', end: '8', checksum: crc32Final(crc32Update(CRC32_INITIAL, payload)) }],
                grid: number === 2 ? [{ at: '0', geometry: { rows: 24, columns: 80 } }] : undefined,
              },
            ],
          }),
        );
      }
      yield* upgradeRecords({ records: root });
      yield* upgradeRecords({ records: root });
      const reads: { text: string; grid: unknown; ref: ExecutionRef }[] = [];
      for (const ref of refs) {
        const record = yield* files.open(root, ref);
        const read = yield* record.read({ ref, stream: 'pty', offset: byteOffset(0n) }, 8);
        reads.push({ text: new TextDecoder().decode(read.bytes), grid: read.range.grid, ref: record.seal.ref });
      }
      return reads;
    }).pipe(Effect.provide(Layer.merge(platform, RecordFiles.layer.pipe(Layer.provide(platform)))));
    expect(records.map((record) => record.text)).toEqual(['abcdefgh', 'abcdefgh']);
    expect(records.map((record) => record.grid)).toEqual([undefined, { rows: 24, columns: 80 }]);
    expect(records.map((record) => String(record.ref.execution))).toEqual(['numbered-1', 'numbered-2']);
  }),
);
