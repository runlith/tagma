import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { RecordFiles, type SealedRecord } from '@runlith/executions/RecordFiles';
import { trackOf } from '@runlith/executions/recordFormat';
import { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset, type ByteCursor, type RecordRange } from '@runlith/executions/protocol/record';
import { makeSegmentRecord, type RecordRead } from './ExecutionRecord';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const shared = RecordFiles.layer.pipe(Layer.provideMerge(platform));
const limits = (output: { landingBytes: number; segmentBytes: number; retainedBytes: number }, chunkBytes = 64) =>
  Schema.decodeUnknownSync(ExecutionLimits)({
    input: { pendingBytes: 64, chunkBytes: 64, receipts: 2 },
    output,
    parser: { pendingBytes: 64, cellBytes: 64 },
    geometry: { columns: 200, rows: 60, scrollbackRows: 100 },
    read: { chunkBytes, readerCredits: 64, readers: 2 },
    frame: { bytes: 64, inFlight: 1 },
    receipts: 2,
  });
const ref = (execution: string) => Schema.decodeUnknownSync(ExecutionRef)({ installation: 'grid-test', execution, incarnation: 1 });
const records = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'record-grid-' }), 'state');
});
const at = (execution: ExecutionRef, offset: bigint): ByteCursor => ({ ref: execution, stream: 'pty', offset: byteOffset(offset) });
const born = { rows: 24, columns: 80 };
const wider = { rows: 30, columns: 100 };
const widest = { rows: 40, columns: 120 };
type Part = { readonly from: string; readonly next: string; readonly text: string; readonly grid: RecordRange['grid'] };
const walk = Effect.fnUntraced(function* (read: (cursor: ByteCursor) => Effect.Effect<RecordRead, unknown>, execution: ExecutionRef) {
  const parts: Part[] = [];
  let offset = 0n;
  for (;;) {
    const answer = yield* read(at(execution, offset));
    if (answer.bytes.length === 0) return parts;
    parts.push({
      from: answer.range.cursor.offset,
      next: answer.range.next,
      text: new TextDecoder().decode(answer.bytes),
      grid: answer.range.grid,
    });
    offset = BigInt(answer.range.next);
  }
});
const retired = (record: SealedRecord) => (cursor: ByteCursor) => record.read(cursor, 64);

layer(shared, { excludeTestServices: true })('the grid track beside a terminal record', (it) => {
  it.effect(
    'each applied resize stands at the byte it took effect at, live and sealed, and the bytes are those of a record never resized',
    () =>
      Effect.gen(function* () {
        const files = yield* RecordFiles;
        const root = yield* records;
        const resized = ref('resized');
        const plain = ref('plain');
        const output = limits({ landingBytes: 16, segmentBytes: 64, retainedBytes: 256 });
        const live = yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: resized,
              transport: 'pty',
              limits: output,
              grid: born,
            });
            const untouched = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: plain,
              transport: 'pty',
              limits: output,
              grid: born,
            });
            yield* record.append('pty', new TextEncoder().encode('aaaa'));
            yield* record.regrid(wider);
            yield* record.append('pty', new TextEncoder().encode('bbbbbb'));
            yield* record.regrid(widest);
            yield* record.append('pty', new TextEncoder().encode('cc'));
            for (const text of ['aaaa', 'bbbbbb', 'cc']) yield* untouched.append('pty', new TextEncoder().encode(text));
            const middle = yield* record.read(at(resized, 6n), 64);
            const parts = yield* walk((cursor) => record.read(cursor, 64), resized);
            const unresized = yield* walk((cursor) => untouched.read(cursor, 64), plain);
            const frontier = yield* record.read(at(resized, 12n), 64);
            return {
              middle,
              parts,
              unresized,
              frontier,
              now: yield* record.grid,
              positions: [yield* record.positions('pty'), yield* untouched.positions('pty')],
            };
          }),
        );
        const sealed = yield* files.open(root, resized);
        const parts = yield* walk(retired(sealed), resized);
        const expected = [
          { from: '0', next: '4', text: 'aaaa', grid: born },
          { from: '4', next: '10', text: 'bbbbbb', grid: wider },
          { from: '10', next: '12', text: 'cc', grid: widest },
        ];
        expect(live.parts).toEqual(expected);
        expect(parts).toEqual(expected);
        expect(sealed.seal.streams.map(trackOf)).toEqual([
          [
            { at: byteOffset(0n), geometry: born },
            { at: byteOffset(4n), geometry: wider },
            { at: byteOffset(10n), geometry: widest },
          ],
        ]);
        expect([live.middle.range.next, live.middle.range.grid]).toEqual([byteOffset(10n), wider]);
        expect([live.frontier.bytes.length, live.frontier.range.grid]).toEqual([0, widest]);
        expect(live.now).toEqual(widest);
        expect(live.unresized.map((part) => part.text).join('')).toBe(expected.map((part) => part.text).join(''));
        expect(live.positions[0]?.durableThrough).toBe(live.positions[1]?.durableThrough);
      }),
  );

  it.effect('resizes with no byte between them leave one entry, and a resize undone before the next byte leaves none', () =>
    Effect.gen(function* () {
      const files = yield* RecordFiles;
      const root = yield* records;
      const execution = ref('settled');
      yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 64, retainedBytes: 256 }),
            grid: born,
          });
          yield* record.append('pty', new TextEncoder().encode('aaaa'));
          yield* record.regrid(wider);
          yield* record.regrid(widest);
          yield* record.append('pty', new TextEncoder().encode('bb'));
          yield* record.regrid(wider);
          yield* record.regrid(widest);
          yield* record.append('pty', new TextEncoder().encode('cc'));
        }),
      );
      expect((yield* files.open(root, execution)).seal.streams.map(trackOf)).toEqual([
        [
          { at: byteOffset(0n), geometry: born },
          { at: byteOffset(4n), geometry: widest },
        ],
      ]);
    }),
  );

  it.effect('a resize applied while bytes already read from the terminal are still landing stands after all of them', () =>
    Effect.gen(function* () {
      const root = yield* records;
      const execution = ref('arriving');
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 4, segmentBytes: 64, retainedBytes: 256 }),
            grid: born,
          });
          yield* record.receiving('pty', 8);
          yield* record.append('pty', new TextEncoder().encode('aaaa'));
          yield* record.regrid(wider);
          yield* record.append('pty', new TextEncoder().encode('bbbb'));
          yield* record.append('pty', new TextEncoder().encode('cc'));
          return yield* walk((cursor) => record.read(cursor, 64), execution);
        }),
      );
      expect(outcome).toEqual([
        { from: '0', next: '8', text: 'aaaabbbb', grid: born },
        { from: '8', next: '10', text: 'cc', grid: wider },
      ]);
    }),
  );

  it.effect('a terminal record opened with no grid to be born at is refused', () =>
    Effect.gen(function* () {
      const root = yield* records;
      const outcome = yield* Effect.flip(
        Effect.scoped(
          makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: ref('unborn'),
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 64, retainedBytes: 256 }),
          }),
        ),
      );
      expect(outcome._tag === 'RecordOpenRefused' && outcome.act).toBe('grid');
    }),
  );

  it.effect('retention keeps the entry standing at the oldest byte it holds, and a gap names that grid', () =>
    Effect.gen(function* () {
      const files = yield* RecordFiles;
      const root = yield* records;
      const execution = ref('retained');
      const live = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 16, retainedBytes: 32 }, 16),
            grid: born,
          });
          yield* record.append('pty', new Uint8Array(8).fill(0x41));
          yield* record.regrid(wider);
          yield* record.append('pty', new Uint8Array(8).fill(0x42));
          yield* record.append('pty', new Uint8Array(16).fill(0x43));
          yield* record.acknowledgeParsed('pty', byteOffset(32n));
          yield* record.append('pty', new Uint8Array(16).fill(0x44));
          return yield* record.read(at(execution, 0n), 16);
        }),
      );
      const sealed = yield* files.open(root, execution);
      const kept = yield* sealed.read(at(execution, 0n), 16);
      for (const gap of [live, kept]) expect([gap.range.gap, gap.range.next, gap.range.grid]).toEqual([true, byteOffset(16n), wider]);
      expect(sealed.seal.streams.map(trackOf)).toEqual([[{ at: byteOffset(8n), geometry: wider }]]);
    }),
  );
});
