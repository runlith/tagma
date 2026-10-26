import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { RecordFiles } from '@runlith/executions/RecordFiles';
import { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset, type ByteCursor, type Stream } from '@runlith/executions/protocol/record';
import { makeSegmentRecord, readerDescriptors, type SegmentRecord } from './ExecutionRecord';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const shared = RecordFiles.layer.pipe(Layer.provideMerge(platform));

const limits = (
  output: { landingBytes: number; segmentBytes: number; retainedBytes: number },
  read: { chunkBytes: number; readers: number },
) =>
  Schema.decodeUnknownSync(ExecutionLimits)({
    input: { pendingBytes: 64, chunkBytes: 64, receipts: 2 },
    output,
    parser: { pendingBytes: 64, cellBytes: 64 },
    geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
    read: { chunkBytes: read.chunkBytes, readerCredits: 64, readers: read.readers },
    frame: { bytes: 64, inFlight: 1 },
    receipts: 2,
  });

const ref = (execution: string) => Schema.decodeUnknownSync(ExecutionRef)({ installation: 'records-test', execution, incarnation: 1 });
const records = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'execution-record-' }), 'state');
});
const cursor = (execution: ExecutionRef, stream: Stream, offset: bigint): ByteCursor => ({
  ref: execution,
  stream,
  offset: byteOffset(offset),
});
const textOf = Effect.fnUntraced(function* (record: SegmentRecord, execution: ExecutionRef, stream: Stream) {
  let text = '';
  let offset = 0n;
  for (;;) {
    const read = yield* record.read(cursor(execution, stream, offset), 64);
    if (read.bytes.length === 0) return text;
    text += new TextDecoder().decode(read.bytes);
    offset = BigInt(read.range.next);
  }
});

layer(shared, { excludeTestServices: true })('SegmentRecord', (it) => {
  it.effect('raw bytes crossing chunk and segment boundaries come back exactly as they went in', () =>
    Effect.gen(function* () {
      const written = new TextEncoder().encode('héllo wörld ✓ — raw bytes, not characters');
      const root = yield* records;
      const execution = ref('split');
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 5, segmentBytes: 16, retainedBytes: 128 }, { chunkBytes: 16, readers: 2 }),
            grid: { rows: 24, columns: 80 },
          });
          for (let at = 0; at < written.length; at += 5) yield* record.append('pty', written.subarray(at, at + 5));
          const taken: number[] = [];
          const reads: number[] = [];
          let offset = 0n;
          for (;;) {
            const read = yield* record.read(cursor(execution, 'pty', offset), 16);
            if (read.bytes.length === 0) break;
            taken.push(...read.bytes);
            reads.push(read.bytes.length);
            offset = BigInt(read.range.next);
          }
          return { taken: Uint8Array.from(taken), reads, positions: yield* record.positions('pty') };
        }),
      );
      expect(outcome.taken).toEqual(written);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(outcome.taken)).toBe('héllo wörld ✓ — raw bytes, not characters');
      expect(outcome.positions.durableThrough).toBe(byteOffset(BigInt(written.length)));
      expect(outcome.reads[0]).toBe(15);
      expect(outcome.reads.reduce((sum, read) => sum + read, 0)).toBe(written.length);
    }),
  );

  it.effect('a stream that ended holds no descriptor: its segment closes at the end, not at the seal', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* records;
      const execution = ref('ended-closes');
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pipes',
            limits: limits({ landingBytes: 16, segmentBytes: 64, retainedBytes: 256 }, { chunkBytes: 16, readers: 2 }),
          });
          yield* record.append('stdout', new Uint8Array(8).fill(0x41));
          yield* record.append('stderr', new Uint8Array(8).fill(0x42));
          const open = (yield* fs.readDirectory('/dev/fd')).length;
          yield* record.endStream('stdout', 'eof');
          yield* record.endStream('stderr', 'eof');
          const ended = (yield* fs.readDirectory('/dev/fd')).length;
          const read = yield* record.read(cursor(execution, 'stdout', 0n), 16);
          return { open, ended, bytes: read.bytes.length, positions: yield* record.positions('stderr') };
        }),
      );
      expect(outcome.open - outcome.ended).toBe(3);
      expect(outcome.bytes).toBe(8);
      expect(outcome.positions.durableThrough).toBe(byteOffset(8n));
    }),
  );

  it.effect('output holds every captured chunk whole in the order its read returned, and stdout and stderr keep their own', () =>
    Effect.gen(function* () {
      const root = yield* records;
      const execution = ref('output-order');
      const returned: string[] = [];
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pipes',
            limits: limits({ landingBytes: 8, segmentBytes: 16, retainedBytes: 256 }, { chunkBytes: 64, readers: 2 }),
          });
          const source = Effect.fnUntraced(function* (stream: 'stdout' | 'stderr', mark: string) {
            for (let index = 0; index < 8; index += 1) {
              const read = Effect.sync(() => {
                returned.push(`${mark}${index}`);
                return new TextEncoder().encode(`${mark}${index}`);
              });
              yield* record.capture(stream, 8, read);
            }
            yield* record.endStream(stream, 'eof');
          });
          yield* Effect.all([source('stdout', 'o'), source('stderr', 'e')], { concurrency: 2 });
          return {
            stdout: yield* textOf(record, execution, 'stdout'),
            stderr: yield* textOf(record, execution, 'stderr'),
            output: yield* textOf(record, execution, 'output'),
            ending: (yield* record.positions('output')).ending,
          };
        }),
      );
      expect(outcome.stdout).toBe('o0o1o2o3o4o5o6o7');
      expect(outcome.stderr).toBe('e0e1e2e3e4e5e6e7');
      expect(outcome.output).toBe(returned.join(''));
      expect(outcome.output).not.toBe(outcome.stdout + outcome.stderr);
      expect(outcome.ending).toBe('eof');
    }),
  );

  it.effect('a live stream bounds sequential history handles independently of retained segments, and an ended one lends none', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* records;
      const execution = ref('lent-handles');
      const output = limits({ landingBytes: 16, segmentBytes: 16, retainedBytes: 256 }, { chunkBytes: 16, readers: 2 });
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref: execution, transport: 'pipes', limits: output });
          for (let chunk = 0; chunk < 3; chunk += 1) yield* record.append('stdout', new Uint8Array(16).fill(0x41 + chunk));
          const before = (yield* fs.readDirectory('/dev/fd')).length;
          const owned = record.openHandles;
          for (let pull = 0; pull < 2; pull += 1) yield* record.read(cursor(execution, 'stdout', 0n), 16);
          const one = (yield* fs.readDirectory('/dev/fd')).length;
          const oneOwned = record.openHandles;
          yield* record.read(cursor(execution, 'stdout', 16n), 16);
          yield* record.read(cursor(execution, 'stdout', 32n), 16);
          const three = (yield* fs.readDirectory('/dev/fd')).length;
          yield* record.endStream('stdout', 'eof');
          const ended = (yield* fs.readDirectory('/dev/fd')).length;
          const after = yield* record.read(cursor(execution, 'stdout', 0n), 16);
          const retained = (yield* fs.readDirectory('/dev/fd')).length;
          return { before, owned, oneOwned, one, three, ended, retained, bytes: after.bytes.length, first: after.bytes[0] };
        }),
      );
      expect(outcome.one - outcome.before).toBe(1);
      expect(outcome.oneOwned - outcome.owned).toBe(outcome.one - outcome.before);
      expect(outcome.three - outcome.before).toBe(1);
      expect(outcome.three - outcome.before).toBeLessThanOrEqual(readerDescriptors(output, 'pipes'));
      expect(outcome.ended).toBe(outcome.before - 1);
      expect(outcome.retained).toBe(outcome.ended);
      expect(outcome.bytes).toBe(16);
      expect(outcome.first).toBe(0x41);
    }),
  );

  it.effect('retention releases only what the interpreter has taken, and says exactly what it dropped', () =>
    Effect.gen(function* () {
      const root = yield* records;
      const execution = ref('retention');
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 16, retainedBytes: 32 }, { chunkBytes: 16, readers: 2 }),
            grid: { rows: 24, columns: 80 },
          });
          const chunk = new Uint8Array(16).fill(0x41);
          yield* record.append('pty', chunk);
          yield* record.append('pty', chunk);
          const saturated = yield* Effect.flip(record.append('pty', chunk));
          const held = yield* record.positions('pty');
          yield* record.acknowledgeParsed('pty', byteOffset(16n));
          const durable = yield* record.append('pty', chunk);
          const gapped = yield* record.read(cursor(execution, 'pty', 0n), 16);
          const resumed = yield* record.read(cursor(execution, 'pty', BigInt(gapped.range.next)), 16);
          return {
            saturated,
            held,
            durable,
            gapped,
            resumed,
            after: yield* record.positions('pty'),
            availability: yield* record.availability,
          };
        }),
      );
      expect(outcome.saturated._tag).toBe('RecordRefused');
      if (outcome.saturated._tag !== 'RecordRefused' || outcome.saturated.reason._tag !== 'Saturated') return;
      expect(outcome.saturated.reason.parsedThrough).toBe(byteOffset(0n));
      expect(outcome.saturated.reason.durableThrough).toBe(byteOffset(32n));
      expect(outcome.saturated.reason.limit).toBe(32);
      expect(outcome.held.durableThrough).toBe(byteOffset(32n));
      expect(outcome.held.retainedFrom).toBe(byteOffset(0n));
      expect(outcome.durable).toBe(byteOffset(48n));
      expect(outcome.after.retainedFrom).toBe(byteOffset(16n));
      expect(outcome.gapped.range.gap).toBe(true);
      expect(outcome.gapped.range.next).toBe(byteOffset(16n));
      expect(outcome.gapped.bytes.length).toBe(0);
      expect(outcome.resumed.range.gap).toBe(false);
      expect(outcome.resumed.bytes.length).toBe(16);
      expect(outcome.availability).toBe('gapped');
    }),
  );

  it.effect('the parse frontier only moves forward, and never past what storage confirmed', () =>
    Effect.gen(function* () {
      const root = yield* records;
      const execution = ref('frontier');
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 16, retainedBytes: 64 }, { chunkBytes: 16, readers: 2 }),
            grid: { rows: 24, columns: 80 },
          });
          yield* record.append('pty', new Uint8Array(16).fill(0x42));
          yield* record.acknowledgeParsed('pty', byteOffset(8n));
          const ahead = yield* Effect.flip(record.acknowledgeParsed('pty', byteOffset(24n)));
          const behind = yield* Effect.flip(record.acknowledgeParsed('pty', byteOffset(4n)));
          return { ahead, behind, positions: yield* record.positions('pty') };
        }),
      );
      expect(outcome.ahead._tag).toBe('FrontierRefused');
      expect(outcome.behind._tag).toBe('FrontierRefused');
      if (outcome.ahead._tag !== 'FrontierRefused' || outcome.behind._tag !== 'FrontierRefused') return;
      expect(outcome.ahead.reason).toBe('ahead');
      expect(outcome.behind.reason).toBe('behind');
      expect(outcome.positions.parsedThrough).toBe(byteOffset(8n));
    }),
  );

  it.effect('a cursor that names something the record cannot answer is refused, and a sealed record answers nothing live', () =>
    Effect.gen(function* () {
      const root = yield* records;
      const execution = ref('cursors');
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 16, retainedBytes: 64 }, { chunkBytes: 16, readers: 2 }),
            grid: { rows: 24, columns: 80 },
          });
          yield* record.append('pty', new Uint8Array(8).fill(0x44));
          const foreign = { ...execution, incarnation: execution.incarnation + 1 };
          return {
            stream: yield* Effect.flip(record.read(cursor(execution, 'stdout', 0n), 8)),
            incarnation: yield* Effect.flip(record.read(cursor(foreign, 'pty', 0n), 8)),
            ahead: yield* Effect.flip(record.read(cursor(execution, 'pty', 9n), 8)),
            limit: yield* Effect.flip(record.read(cursor(execution, 'pty', 0n), 0)),
            frontier: yield* record.read(cursor(execution, 'pty', 8n), 8),
            sealed: yield* Effect.andThen(record.seal(), Effect.flip(record.read(cursor(execution, 'pty', 0n), 8))),
          };
        }),
      );
      expect(outcome.stream._tag).toBe('StreamMissing');
      expect([outcome.incarnation._tag, outcome.ahead._tag, outcome.limit._tag]).toEqual([
        'CursorRefused',
        'CursorRefused',
        'CursorRefused',
      ]);
      if (outcome.incarnation._tag !== 'CursorRefused' || outcome.ahead._tag !== 'CursorRefused' || outcome.limit._tag !== 'CursorRefused')
        return;
      expect([outcome.incarnation.reason, outcome.ahead.reason, outcome.limit.reason]).toEqual(['ref', 'ahead', 'limit']);
      expect(outcome.frontier.bytes.length).toBe(0);
      expect(outcome.frontier.range.gap).toBe(false);
      expect(outcome.frontier.range.next).toBe(byteOffset(8n));
      expect(outcome.sealed._tag).toBe('RecordRefused');
      if (outcome.sealed._tag !== 'RecordRefused') return;
      expect(outcome.sealed.reason._tag).toBe('Sealed');
    }),
  );

  it.effect('limits whose retention could never release a rolled segment are refused, not met as permanent backpressure', () =>
    Effect.gen(function* () {
      const root = yield* records;
      const outcome = yield* Effect.flip(
        Effect.scoped(
          makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: ref('wedged'),
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 64, retainedBytes: 64 }, { chunkBytes: 16, readers: 2 }),
            grid: { rows: 24, columns: 80 },
          }),
        ),
      );
      expect(outcome._tag).toBe('RecordOpenRefused');
      if (outcome._tag !== 'RecordOpenRefused') return;
      expect(outcome.act).toBe('limits');
    }),
  );

  it.effect('a records root that cannot be written refuses the record before an execution exists', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* records;
      yield* fs.makeDirectory(root, { recursive: true });
      yield* fs.chmod(root, 0o500);
      const outcome = yield* Effect.flip(
        Effect.scoped(
          makeSegmentRecord({
            mode: 'create',
            records: path.join(root, 'records'),
            ref: ref('unwritable'),
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 16, retainedBytes: 64 }, { chunkBytes: 16, readers: 2 }),
            grid: { rows: 24, columns: 80 },
          }),
        ),
      );
      yield* fs.chmod(root, 0o700);
      expect(outcome._tag).toBe('RecordWriteFailed');
      if (outcome._tag !== 'RecordWriteFailed') return;
      expect(outcome.act).toBe('directory');
    }),
  );

  it.effect('a sealed record states what it holds, and its retired reader answers the same bytes', () =>
    Effect.gen(function* () {
      const files = yield* RecordFiles;
      const out = new TextEncoder().encode('standard output');
      const err = new TextEncoder().encode('diagnostics');
      const root = yield* records;
      const execution = ref('sealed');
      const sealed = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pipes',
            limits: limits({ landingBytes: 8, segmentBytes: 8, retainedBytes: 64 }, { chunkBytes: 8, readers: 2 }),
          });
          for (let at = 0; at < out.length; at += 8) yield* record.append('stdout', out.subarray(at, at + 8));
          for (let at = 0; at < err.length; at += 8) yield* record.append('stderr', err.subarray(at, at + 8));
          yield* record.endStream('stdout', 'eof');
          return yield* record.seal();
        }),
      );
      const retired = yield* files.open(root, execution);
      const taken: number[] = [];
      let offset = 0n;
      for (;;) {
        const read = yield* retired.read(cursor(execution, 'stdout', offset), 8);
        if (read.bytes.length === 0) break;
        taken.push(...read.bytes);
        offset = BigInt(read.range.next);
      }
      const ahead = yield* Effect.flip(retired.read(cursor(execution, 'stdout', BigInt(out.length) + 1n), 8));
      const mismatch = yield* Effect.flip(files.open(root, ref('another')));
      expect(sealed.written).toBe(true);
      expect(sealed.detail).toBeUndefined();
      expect(Uint8Array.from(taken)).toEqual(out);
      expect(retired.seal.streams.map((stream) => [stream.positions.stream, stream.tail])).toEqual([
        ['stdout', 'complete'],
        ['stderr', 'unmeasured'],
        ['output', 'unmeasured'],
      ]);
      expect(ahead._tag).toBe('RecordCursorRefused');
      expect(mismatch._tag).toBe('RecordSealMissing');
    }),
  );

  it.effect('a sealed record whose bytes were evicted answers the gap, not a missing file', () =>
    Effect.gen(function* () {
      const files = yield* RecordFiles;
      const root = yield* records;
      const execution = ref('evicted');
      yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pty',
            limits: limits({ landingBytes: 16, segmentBytes: 16, retainedBytes: 32 }, { chunkBytes: 16, readers: 2 }),
            grid: { rows: 24, columns: 80 },
          });
          yield* record.append('pty', new Uint8Array(16).fill(0x41));
          yield* record.append('pty', new Uint8Array(16).fill(0x42));
          yield* record.acknowledgeParsed('pty', byteOffset(16n));
          yield* record.append('pty', new Uint8Array(16).fill(0x43));
          yield* record.endStream('pty', 'eof');
        }),
      );
      const retired = yield* files.open(root, execution);
      const gapped = yield* retired.read(cursor(execution, 'pty', 0n), 16);
      const resumed = yield* retired.read(cursor(execution, 'pty', BigInt(gapped.range.next)), 16);
      expect(gapped.range.gap).toBe(true);
      expect(gapped.range.next).toBe(byteOffset(16n));
      expect(gapped.bytes.length).toBe(0);
      expect(String.fromCharCode(...resumed.bytes)).toBe('B'.repeat(16));
      expect(retired.seal.streams[0]?.tail).toBe('complete');
    }),
  );
});
