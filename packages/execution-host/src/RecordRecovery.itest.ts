import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Data, Effect, Fiber, FileSystem, Layer, Option, Path, Schema } from 'effect';
import { RecordFiles } from '@runlith/executions/RecordFiles';
import { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { StreamPositions, byteOffset, type ByteCursor, type Stream } from '@runlith/executions/protocol/record';
import { JOURNAL_FILE, SEAL_FILE, recordFolder, segmentFile } from '@runlith/executions/recordFormat';
import { makeSegmentRecord } from './ExecutionRecord';
import { runtimeProfile } from './runtimeFixture';
import { restoreScreen } from './screenRestore';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const shared = RecordFiles.layer.pipe(Layer.provideMerge(platform));
const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'record-restart', incarnation: 37, execution: 'continued' });
const at = (offset: bigint, stream: Stream = 'pty'): ByteCursor => ({ ref, stream, offset: byteOffset(offset) });
const limits = Schema.decodeUnknownSync(ExecutionLimits)({
  input: { pendingBytes: 64, chunkBytes: 64, receipts: 2 },
  output: { landingBytes: 8, segmentBytes: 8, retainedBytes: 16 },
  parser: { pendingBytes: 64, cellBytes: 64 },
  geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
  read: { chunkBytes: 8, readerCredits: 64, readers: 2 },
  frame: { bytes: 64, inFlight: 1 },
  receipts: 2,
});
class LogicFailed extends Data.TaggedError('LogicFailed')<{ readonly message: string }> {}

const LogicAnswer = Schema.fromJsonString(
  Schema.Struct({
    positions: Schema.optional(StreamPositions),
    resumed: Schema.optional(StreamPositions),
    seen: Schema.optional(Schema.String),
    seal: Schema.optional(Schema.Struct({ written: Schema.Boolean, detail: Schema.optional(Schema.String) })),
  }),
);

const logic = Effect.fnUntraced(function* (root: string, phase: 'begin' | 'continue') {
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn([process.execPath, `${import.meta.dir}/testing/recordLogic.ts`, root, phase], { stdout: 'pipe', stderr: 'pipe' }),
      catch: (error) => new LogicFailed({ message: `record logic ${phase} would not start: ${String(error)}` }),
    }),
    (child) =>
      Effect.andThen(
        Effect.sync(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }),
        Effect.promise(() => child.exited),
      ),
  );
  const [code, text, error] = yield* Effect.all(
    [
      Effect.promise(() => child.exited),
      Effect.tryPromise({
        try: () => new Response(child.stdout).text(),
        catch: (error) => new LogicFailed({ message: `record output: ${String(error)}` }),
      }),
      Effect.tryPromise({
        try: () => new Response(child.stderr).text(),
        catch: (error) => new LogicFailed({ message: `record error output: ${String(error)}` }),
      }),
    ],
    { concurrency: 3 },
  );
  if (code !== 0) return yield* new LogicFailed({ message: `record logic ${phase} exited ${code}: ${error}` });
  return yield* Schema.decodeUnknownEffect(LogicAnswer)(text);
});

layer(shared, { excludeTestServices: true })('record recovery', (it) => {
  it.effect('another logic process continues an unsealed record with the same cursor, grid boundaries and payload checksums', () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-processes-' });
        const folder = recordFolder(ref.execution);
        if (typeof folder !== 'string') return yield* folder;
        const began = yield* logic(root, 'begin');
        expect(began.positions?.durableThrough).toBe(byteOffset(12n));
        expect(yield* fs.exists(path.join(root, folder, SEAL_FILE))).toBe(false);
        const continued = yield* logic(root, 'continue');
        expect(continued.resumed?.durableThrough).toBe(byteOffset(12n));
        expect(continued.seen).toBe('ijklmnop');
        expect(continued.seal?.written).toBe(true);
        expect(continued.seal?.detail).toBeUndefined();
        const record = yield* (yield* RecordFiles).open(root, ref);
        const pieces: { text: string; from: string; next: string; grid: unknown }[] = [];
        let cursor = at(0n);
        for (;;) {
          const read = yield* record.read(cursor, 8);
          expect(read.range.gap).toBe(false);
          if (read.bytes.length === 0) break;
          pieces.push({
            text: new TextDecoder().decode(read.bytes),
            from: read.range.cursor.offset,
            next: read.range.next,
            grid: read.range.grid,
          });
          cursor = { ...cursor, offset: read.range.next };
        }
        return { seal: record.seal, pieces };
      });
      expect(result.seal.ref).toEqual(ref);
      expect(result.seal.streams[0]?.tail).toBe('complete');
      expect(result.pieces).toEqual([
        { text: 'abcdefgh', from: '0', next: '8', grid: { rows: 24, columns: 80 } },
        { text: 'ijklmnop', from: '8', next: '16', grid: { rows: 30, columns: 100 } },
        { text: 'qrst', from: '16', next: '20', grid: { rows: 40, columns: 120 } },
      ]);
    }),
  );

  it.effect('suspension preserves retention and an ended stream across journal compaction and an incomplete final entry', () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-suspended-' });
        const directory = yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref, transport: 'pipes', limits });
            yield* record.endStream('stderr', 'eof');
            for (const text of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee', 'ffffffff']) {
              yield* record.append('stdout', new TextEncoder().encode(text));
            }
            yield* record.suspend();
            return record.directory;
          }),
        );
        expect(yield* fs.exists(path.join(directory, SEAL_FILE))).toBe(false);
        yield* fs.writeFileString(path.join(directory, JOURNAL_FILE), '{"_tag":"Grid"', { flag: 'a' });
        const foreign = yield* Effect.flip(
          Effect.scoped(makeSegmentRecord({ mode: 'reopen', records: root, ref: { ...ref, incarnation: 38 }, transport: 'pipes', limits })),
        );
        const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref, transport: 'pipes', limits });
        const gap = yield* record.read(at(0n, 'stdout'), 8);
        const first = yield* record.read(at(32n, 'stdout'), 8);
        const ended = yield* record.positions('stderr');
        const refused = yield* Effect.flip(record.append('stderr', Uint8Array.of(1)));
        yield* record.append('stdout', new TextEncoder().encode('gggggggg'));
        yield* record.endStream('stdout', 'eof');
        const seal = yield* record.seal();
        const sealed = yield* (yield* RecordFiles).open(root, ref);
        const retained = yield* sealed.read(at(40n, 'stdout'), 8);
        const last = yield* sealed.read(at(48n, 'stdout'), 8);
        return { foreign, gap, first, ended, refused, seal, retained, last };
      });
      expect(result.foreign._tag).toBe('RecordWriteFailed');
      expect(result.gap.range.gap).toBe(true);
      expect(result.gap.range.next).toBe(byteOffset(32n));
      expect(new TextDecoder().decode(result.first.bytes)).toBe('eeeeeeee');
      expect(result.ended.ending).toBe('eof');
      expect(result.refused._tag === 'RecordRefused' ? result.refused.reason._tag : result.refused._tag).toBe('Ended');
      expect(result.seal.written).toBe(true);
      expect(result.seal.detail).toBeUndefined();
      expect(new TextDecoder().decode(result.retained.bytes)).toBe('ffffffff');
      expect(new TextDecoder().decode(result.last.bytes)).toBe('gggggggg');
    }),
  );

  it.effect('another logic continues output after the chunks its predecessor captured, in the order they were read', () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-output-reopen-' });
        const chunk = (text: string) => Effect.succeed(new TextEncoder().encode(text));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref, transport: 'pipes', limits });
            yield* record.capture('stdout', 8, chunk('ab'));
            yield* record.capture('stderr', 8, chunk('cd'));
            yield* record.suspend();
          }),
        );
        const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref, transport: 'pipes', limits });
        const resumed = yield* record.positions('output');
        yield* record.capture('stderr', 8, chunk('ef'));
        yield* record.capture('stdout', 8, chunk('gh'));
        yield* record.endStream('stdout', 'eof');
        yield* record.endStream('stderr', 'eof');
        yield* record.seal();
        const sealed = yield* (yield* RecordFiles).open(root, ref);
        const output = yield* sealed.read(at(0n, 'output'), 8);
        const stdout = yield* sealed.read(at(0n, 'stdout'), 8);
        const tail = sealed.seal.streams.find((held) => held.positions.stream === 'output')?.tail;
        return { resumed, output, stdout, tail };
      });
      expect(result.resumed.durableThrough).toBe(byteOffset(4n));
      expect(new TextDecoder().decode(result.output.bytes)).toBe('abcdefgh');
      expect(new TextDecoder().decode(result.stdout.bytes)).toBe('abgh');
      expect(result.tail).toBe('complete');
    }),
  );

  it.effect('a reopened streaming record protects retained bytes until the next reader drains them', () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-streaming-reopen-' });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref,
              transport: 'pipes',
              limits,
              streaming: ['stdout'],
            });
            yield* record.append('stdout', new TextEncoder().encode('abcdefgh'));
            yield* record.append('stdout', new TextEncoder().encode('ijklmnop'));
            yield* record.suspend();
          }),
        );
        const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref, transport: 'pipes', limits });
        const writing = yield* Effect.forkScoped(record.append('stdout', new TextEncoder().encode('qrstuvwx')));
        expect(Option.isNone(yield* Fiber.join(writing).pipe(Effect.timeoutOption('20 millis')))).toBe(true);
        const drain = yield* record.follow('stdout', byteOffset(0n));
        const first = yield* record.read(at(0n, 'stdout'), 8);
        expect(new TextDecoder().decode(first.bytes)).toBe('abcdefgh');
        yield* record.advance('stdout', drain, first.range.next);
        expect(yield* Fiber.join(writing)).toBe(byteOffset(24n));
        const second = yield* record.read(at(8n, 'stdout'), 8);
        expect(second.range.gap).toBe(false);
        expect(new TextDecoder().decode(second.bytes)).toBe('ijklmnop');
        expect(yield* record.positions('stdout')).toMatchObject({ retainedFrom: byteOffset(8n), durableThrough: byteOffset(24n) });
      });
    }),
  );

  it.effect('reopening completes an unfinished header at a frontier that holds no payload', () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-header-' });
        const directory = yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref, transport: 'pipes', limits });
            yield* record.suspend();
            return record.directory;
          }),
        );
        yield* fs.truncate(path.join(directory, 'stdout', segmentFile(0n)), 10);
        const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref, transport: 'pipes', limits });
        const through = yield* record.append('stdout', new TextEncoder().encode('abcdefgh'));
        yield* record.endStream('stdout', 'eof');
        const seal = yield* record.seal();
        const saved = yield* (yield* RecordFiles).open(root, ref);
        const read = yield* saved.read(at(0n, 'stdout'), 8);
        return { through, seal, bytes: read.bytes };
      });
      expect(result.through).toBe(byteOffset(8n));
      expect(result.seal.written).toBe(true);
      expect(new TextDecoder().decode(result.bytes)).toBe('abcdefgh');
    }),
  );

  it.effect('a lost screen after reopening a full retained PTY does not block the next output chunk', () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: 'record-lost-screen-' });
        const geometry = { rows: 2, columns: 4 };
        const profile = runtimeProfile({ ...geometry, scrollbackRows: 2 });
        const terminalLimits = yield* Schema.decodeUnknownEffect(ExecutionLimits)({
          ...profile.execution,
          output: limits.output,
          read: limits.read,
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref,
              transport: 'pty',
              limits: terminalLimits,
              grid: geometry,
            });
            yield* record.append('pty', new TextEncoder().encode('aaaaaaaa'));
            yield* record.append('pty', new TextEncoder().encode('bbbbbbbb'));
            yield* record.acknowledgeParsed('pty', byteOffset(8n));
            yield* record.append('pty', new TextEncoder().encode('cccccccc'));
            yield* record.suspend();
          }),
        );
        const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref, transport: 'pty', limits: terminalLimits });
        const before = yield* record.positions('pty');
        const blocked = yield* Effect.flip(record.append('pty', new TextEncoder().encode('dddddddd')));
        const interpretation = yield* restoreScreen(
          fs,
          path,
          record,
          ref,
          terminalLimits,
          {
            palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
            foreground: 0xe5e5e5,
            background: 0,
            cursor: 0xe5e5e5,
          },
          () => Effect.succeed({ delivered: true, ending: false, detail: '' }),
          undefined,
        );
        const failure = yield* interpretation.unavailable;
        const through = yield* record.append('pty', new TextEncoder().encode('dddddddd'));
        const after = yield* record.positions('pty');
        const read = yield* record.read(at(24n), 8);
        return { before, blocked, failure, through, after, read };
      });
      expect(result.before.retainedFrom).toBe(byteOffset(8n));
      expect(result.before.durableThrough).toBe(byteOffset(24n));
      expect(result.before.parsedThrough).toBe(result.before.retainedFrom);
      expect(result.blocked._tag === 'RecordRefused' ? result.blocked.reason._tag : result.blocked._tag).toBe('Saturated');
      expect(result.failure?.reason).toBe('checkpoint');
      expect(result.through).toBe(byteOffset(32n));
      expect(result.after.retainedFrom).toBe(byteOffset(16n));
      expect(result.after.ending).toBe('open');
      expect(result.read.range.gap).toBe(false);
      expect(new TextDecoder().decode(result.read.bytes)).toBe('dddddddd');
    }),
  );
});
