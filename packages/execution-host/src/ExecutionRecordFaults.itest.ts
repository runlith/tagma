import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, PlatformError, Result, Schedule, Schema } from 'effect';
import { RecordFiles } from '@runlith/executions/RecordFiles';
import { SEAL_FILE, SEGMENT_HEADER_BYTES, recordFolder, segmentFile } from '@runlith/executions/recordFormat';
import { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { type ExecutionRef, ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { byteOffset, type ByteCursor } from '@runlith/executions/protocol/record';
import { makeSegmentRecord } from './ExecutionRecord';
import { faulty } from './testing/faultyFiles';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const shared = RecordFiles.layer.pipe(Layer.provideMerge(platform));

const limits = Schema.decodeUnknownSync(ExecutionLimits)({
  input: { pendingBytes: 64, chunkBytes: 64, receipts: 2 },
  output: { landingBytes: 16, segmentBytes: 32, retainedBytes: 64 },
  parser: { pendingBytes: 64, cellBytes: 64 },
  geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
  read: { chunkBytes: 16, readerCredits: 16, readers: 2 },
  frame: { bytes: 64, inFlight: 1 },
  receipts: 2,
});

const installation = InstallationId.make('faults-test');
const ref = (execution: string): ExecutionRef => ({ installation, execution: ExecutionId.make(execution), incarnation: 1 });

const cursor = (execution: ExecutionRef, offset: bigint): ByteCursor => ({ ref: execution, stream: 'pty', offset: byteOffset(offset) });

const refusalOf = <A, E extends { readonly _tag: string }>(result: Result.Result<A, E>): string =>
  Result.isFailure(result) ? result.failure._tag : `admitted: ${String(result.success)}`;

layer(shared, { excludeTestServices: true })('a record over storage that fails', (it) => {
  it.effect('a write that fails with bytes already on the device loses no frontier, and its record says so', () =>
    Effect.gen(function* () {
      const first = new Uint8Array(16).fill(0x41);
      const second = new Uint8Array(16).fill(0x42);
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const files = yield* RecordFiles;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-fault-' }), 'state');
        const execution = ref('torn');
        const fs = faulty(real, { whenPathHas: segmentFile(0n), onCall: 3, landed: 6, fails: true });
        const sealed = yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: execution,
              transport: 'pty',
              limits,
              grid: { rows: 24, columns: 80 },
            }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
            yield* record.append('pty', first);
            const torn = yield* Effect.flip(record.append('pty', second));
            const after = yield* record.positions('pty');
            const fenced = yield* Effect.flip(record.append('pty', new Uint8Array(4).fill(0x44)));
            yield* record.endStream('pty', 'eof');
            const availability = yield* record.availability;
            return { torn, after, fenced, availability, seal: yield* record.seal() };
          }),
        );
        const folder = recordFolder(execution.execution);
        if (typeof folder !== 'string') return yield* folder;
        const segment = yield* real.readFile(path.join(root, folder, 'pty', segmentFile(0n)));
        const retired = yield* files.open(root, execution);
        const taken: number[] = [];
        let offset = 0n;
        for (;;) {
          const read = yield* retired.read(cursor(execution, offset), 16);
          if (read.bytes.length === 0) break;
          taken.push(...read.bytes);
          offset = BigInt(read.range.next);
        }
        return { ...sealed, segment, taken: Uint8Array.from(taken) };
      });
      expect(outcome.torn._tag).toBe('RecordWriteFailed');
      if (outcome.torn._tag !== 'RecordWriteFailed') return;
      expect(outcome.torn.act).toBe('append');
      expect(outcome.after.durableThrough).toBe(byteOffset(16n));
      expect(outcome.fenced._tag).toBe('RecordRefused');
      if (outcome.fenced._tag !== 'RecordRefused') return;
      expect(outcome.fenced.reason._tag).toBe('Storage');
      expect(outcome.availability).toBe('unavailable');
      expect(outcome.segment.length).toBe(SEGMENT_HEADER_BYTES + 16);
      expect(outcome.segment.subarray(SEGMENT_HEADER_BYTES)).toEqual(first);
      expect(outcome.seal.seal.streams[0]?.tail).toBe('lost');
      expect(outcome.seal.written).toBe(true);
      expect(outcome.taken).toEqual(first);
    }),
  );

  it.effect('a second producer is refused while an append is really in flight', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-busy-' }), 'state');
        const execution = ref('busy');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const fs = faulty(real, { whenPathHas: segmentFile(0n), onCall: 2, held, entered });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: execution,
              transport: 'pty',
              limits,
              grid: { rows: 24, columns: 80 },
            }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
            const running = yield* Effect.forkChild(record.append('pty', new Uint8Array(8).fill(0x41)), { startImmediately: true });
            yield* Deferred.await(entered);
            const busy = yield* Effect.result(record.append('pty', new Uint8Array(8).fill(0x42)));
            yield* Deferred.succeed(held, undefined);
            const durable = yield* Fiber.join(running);
            return { busy, durable, positions: yield* record.positions('pty') };
          }),
        );
      });
      expect(refusalOf(outcome.busy)).toBe('RecordUnavailable');
      if (!Result.isFailure(outcome.busy) || outcome.busy.failure._tag !== 'RecordUnavailable') return;
      expect(outcome.busy.failure.act).toBe('append');
      expect(outcome.durable).toBe(byteOffset(8n));
      expect(outcome.positions.durableThrough).toBe(byteOffset(8n));
    }),
  );

  it.effect('a stream cannot end while its append is inside a write that never answers', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-wedge-' }), 'state');
        const execution = ref('wedged');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const fs = faulty(real, { whenPathHas: segmentFile(0n), onCall: 2, held, entered });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: execution,
              transport: 'pty',
              limits,
              grid: { rows: 24, columns: 80 },
            }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
            const appending = yield* Effect.forkChild(record.append('pty', new Uint8Array(8).fill(0x41)), {
              startImmediately: true,
            });
            yield* Deferred.await(entered);

            const ended = yield* Deferred.make<void>();
            yield* Effect.forkChild(Effect.andThen(record.endStream('pty', 'eof'), Deferred.succeed(ended, undefined)), {
              startImmediately: true,
            });
            for (let step = 0; step < 200; step += 1) yield* Effect.yieldNow;
            const endedWhileWriting = yield* Deferred.isDone(ended);

            yield* Deferred.succeed(held, undefined);
            const durable = yield* Fiber.join(appending);
            yield* Deferred.await(ended);
            return {
              endedWhileWriting,
              durable,
              positions: yield* record.positions('pty'),
            };
          }),
        );
      });

      expect(outcome.endedWhileWriting).toBe(false);
      expect(outcome.durable).toBe(byteOffset(8n));
      expect(outcome.positions.durableThrough).toBe(byteOffset(8n));
    }),
  );

  it.effect('a timeout around the ending cannot cut it while the write is outstanding', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-uncut-' }), 'state');
        const execution = ref('uncut');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const fs = faulty(real, { whenPathHas: segmentFile(0n), onCall: 2, held, entered });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: execution,
              transport: 'pty',
              limits,
              grid: { rows: 24, columns: 80 },
            }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
            const appending = yield* Effect.forkChild(record.append('pty', new Uint8Array(8).fill(0x41)), {
              startImmediately: true,
            });
            yield* Deferred.await(entered);

            const cut = yield* Deferred.make<void>();
            yield* Effect.forkChild(
              Effect.andThen(Effect.timeoutOption(record.endStream('pty', 'eof'), '0 millis'), Deferred.succeed(cut, undefined)),
              { startImmediately: true },
            );
            for (let step = 0; step < 200; step += 1) yield* Effect.yieldNow;
            const cutWhileWriting = yield* Deferred.isDone(cut);

            yield* Deferred.succeed(held, undefined);
            const durable = yield* Fiber.join(appending);
            yield* Deferred.await(cut);
            return { cutWhileWriting, durable, positions: yield* record.positions('pty') };
          }),
        );
      });

      expect(outcome.cutWhileWriting).toBe(false);
      expect(outcome.durable).toBe(byteOffset(8n));
      expect(outcome.positions.durableThrough).toBe(byteOffset(8n));
    }),
  );

  it.effect('a carrier that never answers ends the write, so the stream still ends and claims no bytes', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-bound-' }), 'state');
        const execution = ref('bounded');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const fs = faulty(real, { whenPathHas: segmentFile(0n), onCall: 2, held, entered });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: execution,
              transport: 'pty',
              limits,
              actMs: 25,
              grid: { rows: 24, columns: 80 },
            }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
            const appending = yield* Effect.forkChild(Effect.result(record.append('pty', new Uint8Array(8).fill(0x41))), {
              startImmediately: true,
            });
            yield* Deferred.await(entered);
            yield* record.endStream('pty', 'eof');
            return {
              wrote: yield* Fiber.join(appending),
              positions: yield* record.positions('pty'),
            };
          }),
        );
      });

      expect(Result.isFailure(outcome.wrote)).toBe(true);
      const refusal = Result.isFailure(outcome.wrote) ? outcome.wrote.failure : undefined;
      expect(refusal?._tag).toBe('RecordWriteFailed');
      expect(refusal?._tag === 'RecordWriteFailed' && refusal.act).toBe('append');
      expect(outcome.positions.durableThrough).toBe(byteOffset(0n));
    }),
  );

  it.effect('a capture whose carrier answers its append after the deadline lands the chunk and goes on capturing', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-slow-' }), 'state');
        const execution = ref('slow');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const fs = faulty(real, { whenPathHas: path.join('stdout', segmentFile(0n)), onCall: 2, held, entered });
        const chunk = (text: string) => Effect.succeed(new TextEncoder().encode(text));
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({
              mode: 'create',
              records: root,
              ref: execution,
              transport: 'pipes',
              limits,
              actMs: 50,
            }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
            const slow = yield* Effect.forkChild(Effect.result(record.capture('stdout', 16, chunk('slow'))), { startImmediately: true });
            yield* Deferred.await(entered);
            yield* Effect.sleep('100 millis');
            yield* Deferred.succeed(held, undefined);
            const told = (result: Result.Result<Uint8Array | undefined, { readonly _tag: string }>) =>
              Result.isFailure(result) ? result.failure._tag : new TextDecoder().decode(result.success);
            const captured = [told(yield* Fiber.join(slow)), told(yield* Effect.result(record.capture('stdout', 16, chunk('more'))))];
            const read = yield* record.read({ ref: execution, stream: 'stdout', offset: byteOffset(0n) }, 16);
            return {
              captured,
              positions: yield* record.positions('stdout'),
              availability: yield* record.availability,
              text: new TextDecoder().decode(read.bytes),
            };
          }),
        );
      });
      expect(outcome.captured).toEqual(['slow', 'more']);
      expect(outcome.positions).toMatchObject({ ending: 'open', durableThrough: byteOffset(8n) });
      expect(outcome.availability).toBe('available');
      expect(outcome.text).toBe('slowmore');
    }),
  );

  it.effect(
    'suspension gives up on a capture inside a write that never answers, and the next logic takes none of its bytes even when the cut write lands',
    () =>
      Effect.gen(function* () {
        const outcome = yield* Effect.gen(function* () {
          const real = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-hung-suspend-' }), 'state');
          const execution = ref('hung-suspend');
          const held = yield* Deferred.make<void>();
          const entered = yield* Deferred.make<void>();
          const fs = faulty(real, { whenPathHas: path.join('stdout', segmentFile(0n)), onCall: 3, held, entered, landsAfterCut: true });
          const chunk = (text: string) => Effect.succeed(new TextEncoder().encode(text));
          const captured = yield* Effect.scoped(
            Effect.gen(function* () {
              const record = yield* makeSegmentRecord({
                mode: 'create',
                records: root,
                ref: execution,
                transport: 'pipes',
                limits,
                actMs: 50,
              }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
              yield* record.capture('stdout', 16, chunk('first'));
              const capturing = yield* Effect.forkChild(Effect.result(record.capture('stdout', 16, chunk('torn'))), {
                startImmediately: true,
              });
              yield* Deferred.await(entered);
              yield* record.suspend();
              return yield* Fiber.join(capturing);
            }),
          );
          const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref: execution, transport: 'pipes', limits });
          const read = yield* record.read({ ref: execution, stream: 'stdout', offset: byteOffset(0n) }, 16);
          return { captured, positions: yield* record.positions('stdout'), text: new TextDecoder().decode(read.bytes) };
        });
        const refusal = Result.isFailure(outcome.captured) ? outcome.captured.failure : undefined;
        expect(refusal?._tag === 'RecordWriteFailed' && refusal.act).toBe('append');
        expect(outcome.positions).toMatchObject({ ending: 'error', durableThrough: byteOffset(5n) });
        expect(outcome.text).toBe('first');
      }),
  );

  it.effect('closing the owner of a capture inside a write that never answers still seals the record, without its bytes', () =>
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const files = yield* RecordFiles;
      const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-hung-close-' }), 'state');
      const execution = ref('hung-close');
      const held = yield* Deferred.make<void>();
      const entered = yield* Deferred.make<void>();
      const fs = faulty(real, { whenPathHas: path.join('stdout', segmentFile(0n)), onCall: 2, held, entered });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pipes',
            limits,
            actMs: 50,
          }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
          yield* Effect.forkScoped(record.capture('stdout', 16, Effect.succeed(new TextEncoder().encode('lost'))), {
            startImmediately: true,
          });
          yield* Deferred.await(entered);
        }),
      );
      const stdout = (yield* files.open(root, execution)).seal.streams.find((stream) => stream.positions.stream === 'stdout');
      expect(stdout?.positions.durableThrough).toBe(byteOffset(0n));
      expect(stdout?.tail).toBe('lost');
    }),
  );

  it.effect('reopening a live record whose open segment never answers its read refuses within the deadline', () =>
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-hung-reopen-' }), 'state');
      const execution = ref('hung-reopen');
      yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref: execution, transport: 'pipes', limits });
          yield* record.capture('stdout', 16, Effect.succeed(new TextEncoder().encode('kept')));
          yield* record.suspend();
        }),
      );
      const held = yield* Deferred.make<void>();
      const fs = faulty(real, { whenPathHas: path.join('stdout', segmentFile(0n)), act: 'read', onCall: 1, held });
      const refused = yield* Effect.flip(
        makeSegmentRecord({ mode: 'reopen', records: root, ref: execution, transport: 'pipes', limits, actMs: 50 }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
        ),
      );
      expect(refused).toMatchObject({ _tag: 'RecordWriteFailed', act: 'open', stream: 'stdout' });
    }),
  );

  it.effect('sealing fences the streams before it states anything about them', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const files = yield* RecordFiles;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-seal-' }), 'state');
        const execution = ref('fenced');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const fs = faulty(real, { whenPathHas: path.join('stderr', segmentFile(0n)), act: 'sync', onCall: 1, held, entered });
        const outcome = yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref: execution, transport: 'pipes', limits }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            );
            yield* record.append('stdout', new Uint8Array(8).fill(0x41));
            yield* record.endStream('stdout', 'eof');
            const sealing = yield* Effect.forkChild(record.seal());
            yield* Deferred.await(entered);
            const refused = yield* Effect.result(record.append('stderr', new Uint8Array(4).fill(0x42)));
            yield* Deferred.succeed(held, undefined);
            return { refused, seal: yield* Fiber.join(sealing) };
          }),
        );
        const retired = yield* files.open(root, execution);
        const folder = recordFolder(execution.execution);
        if (typeof folder !== 'string') return yield* folder;
        return {
          ...outcome,
          read: yield* retired.read({ ref: execution, stream: 'stdout', offset: byteOffset(0n) }, 8),
          segment: yield* real.readFile(path.join(root, folder, 'stderr', segmentFile(0n))),
        };
      });
      expect(refusalOf(outcome.refused)).toBe('RecordRefused');
      if (!Result.isFailure(outcome.refused) || outcome.refused.failure._tag !== 'RecordRefused') return;
      expect(outcome.refused.failure.reason._tag).toBe('Sealed');
      expect(outcome.seal.written).toBe(true);
      expect(outcome.seal.seal.streams.map((stream) => [stream.positions.stream, stream.tail])).toEqual([
        ['stdout', 'complete'],
        ['stderr', 'unmeasured'],
        ['output', 'unmeasured'],
      ]);
      expect(outcome.read.bytes.length).toBe(8);
      expect(outcome.segment.length).toBe(SEGMENT_HEADER_BYTES);
    }),
  );

  it.effect(
    'a resize applied while an append is inside its write stands after it, and where that write failed, at the bytes storage confirmed',
    () =>
      Effect.gen(function* () {
        const born = { rows: 24, columns: 80 };
        const wider = { rows: 30, columns: 100 };
        const outcome = yield* Effect.gen(function* () {
          const real = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const files = yield* RecordFiles;
          const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-grid-fault-' }), 'state');
          const execution = ref('regrid-torn');
          const held = yield* Deferred.make<void>();
          const entered = yield* Deferred.make<void>();
          const fs = faulty(real, { whenPathHas: segmentFile(0n), onCall: 3, held, entered, fails: true });
          const live = yield* Effect.scoped(
            Effect.gen(function* () {
              const record = yield* makeSegmentRecord({
                mode: 'create',
                records: root,
                ref: execution,
                transport: 'pty',
                limits,
                grid: born,
              }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
              yield* record.append('pty', new Uint8Array(8).fill(0x41));
              const running = yield* Effect.forkChild(Effect.result(record.append('pty', new Uint8Array(8).fill(0x42))), {
                startImmediately: true,
              });
              yield* Deferred.await(entered);
              yield* record.regrid(wider);
              const during = yield* record.read(cursor(execution, 8n), 16);
              yield* Deferred.succeed(held, undefined);
              yield* Fiber.join(running);
              return { during, after: yield* record.read(cursor(execution, 8n), 16), now: yield* record.grid };
            }),
          );
          const sealed = yield* files.open(root, execution);
          return { live, track: sealed.seal.streams.map((stream) => ('grid' in stream ? stream.grid : undefined)) };
        });
        expect(outcome.live.during.range.grid).toEqual(born);
        expect(outcome.live.after.range.grid).toEqual(wider);
        expect(outcome.live.now).toEqual(wider);
        expect(outcome.track).toEqual([
          [
            { at: byteOffset(0n), geometry: born },
            { at: byteOffset(8n), geometry: wider },
          ],
        ]);
      }),
  );

  it.effect('opening a record without enough descriptors reports exhaustion to launch admission', () =>
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      const root = yield* real.makeTempDirectoryScoped({ prefix: 'record-emfile-' });
      const fs: FileSystem.FileSystem = {
        ...real,
        open: () => PlatformError.systemError({ _tag: 'Unknown', module: 'FileSystem', method: 'open', cause: { code: 'EMFILE' } }),
      };
      const refused = yield* Effect.flip(
        makeSegmentRecord({
          mode: 'create',
          records: root,
          ref: ref('record-emfile'),
          transport: 'pipes',
          limits,
        }).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
      );
      expect(refused._tag).toBe('RecordWriteFailed');
      if (refused._tag !== 'RecordWriteFailed') return;
      expect(refused.exhausted).toBe(true);
    }),
  );

  it.effect('suspension lands an output chunk captured behind an earlier output write, so the next logic reads both', () =>
    Effect.gen(function* () {
      const text = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-queued-output-' }), 'state');
        const execution = ref('queued-output');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const fs = faulty(real, { whenPathHas: path.join('output', segmentFile(0n)), onCall: 2, held, entered });
        const chunk = (text: string) => Effect.succeed(new TextEncoder().encode(text));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref: execution, transport: 'pipes', limits }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            );
            const first = yield* Effect.forkChild(record.capture('stdout', 16, chunk('first')));
            yield* Deferred.await(entered);
            const second = yield* Effect.forkChild(record.capture('stderr', 16, chunk('second')));
            yield* record
              .positions('stderr')
              .pipe(
                Effect.repeat({ until: (positions) => positions.durableThrough === byteOffset(6n), schedule: Schedule.spaced('1 millis') }),
              );
            const suspending = yield* Effect.forkChild(record.suspend());
            yield* Effect.result(record.read({ ref: execution, stream: 'stdout', offset: byteOffset(0n) }, 1)).pipe(
              Effect.repeat({ until: Result.isFailure, schedule: Schedule.spaced('1 millis') }),
            );
            yield* Deferred.succeed(held, undefined);
            yield* Fiber.join(first);
            yield* Fiber.join(second);
            yield* Fiber.join(suspending);
          }),
        );
        const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref: execution, transport: 'pipes', limits });
        const read = yield* record.read({ ref: execution, stream: 'output', offset: byteOffset(0n) }, 16);
        return new TextDecoder().decode(read.bytes);
      });
      expect(text).toBe('firstsecond');
    }),
  );

  it.effect('an output segment that fails to open stays ended after reopening while its sources continue', () =>
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-output-roll-' }), 'state');
      const execution = ref('output-roll');
      const fs = faulty(real, { whenPathHas: path.join('output', segmentFile(32n)), onCall: 1, fails: true });
      const chunk = (text: string) => Effect.succeed(new TextEncoder().encode(text));
      const before = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref: execution, transport: 'pipes', limits }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
          );
          yield* record.capture('stdout', 16, chunk('abcdefghijklmnop'));
          yield* record.capture('stdout', 16, chunk('qrstuvwxyz012345'));
          yield* record.capture('stderr', 16, chunk('lost'));
          const ended = yield* record.positions('output');
          yield* record.suspend();
          return ended;
        }),
      );
      const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref: execution, transport: 'pipes', limits });
      yield* record.capture('stderr', 16, chunk('more'));
      const after = yield* record.positions('output');
      const stderr = yield* record.read({ ref: execution, stream: 'stderr', offset: byteOffset(0n) }, 16);
      expect(before).toMatchObject({ ending: 'error', durableThrough: byteOffset(32n) });
      expect(after).toMatchObject({ ending: 'error', durableThrough: byteOffset(32n) });
      expect(new TextDecoder().decode(stderr.bytes)).toBe('lostmore');
    }),
  );

  it.effect('a kept output file the device never answers holds no ending, names no path, and its successor writes it whole', () =>
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-kept-output-' }), 'state');
      const execution = ref('kept-output');
      const fs = faulty(real, { whenPathHas: 'output.log', onCall: 1, held: yield* Deferred.make<void>() });
      const chunk = (text: string) => Effect.succeed(new TextEncoder().encode(text));
      const cut = yield* Effect.scoped(
        Effect.gen(function* () {
          const record = yield* makeSegmentRecord({
            mode: 'create',
            records: root,
            ref: execution,
            transport: 'pipes',
            limits,
            actMs: 50,
          }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
          yield* record.capture('stdout', 16, chunk('abcd'));
          yield* record.capture('stderr', 16, chunk('wxyz'));
          yield* record.endStream('stdout', 'eof');
          yield* record.endStream('stderr', 'eof');
          const named = yield* record.outputFile;
          yield* record.suspend();
          return { named, ending: (yield* record.positions('output')).ending };
        }),
      );
      const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref: execution, transport: 'pipes', limits });
      const kept = yield* record.outputFile;
      expect(cut).toEqual({ named: undefined, ending: 'eof' });
      expect(kept).toMatchObject({ from: byteOffset(0n), through: byteOffset(8n) });
      expect(kept === undefined ? undefined : yield* real.readFileString(kept.path)).toBe('abcdwxyz');
    }),
  );

  it.effect('an output write that fails ends output in error for its readers and its successor, and stdout capture goes on', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = path.join(yield* real.makeTempDirectoryScoped({ prefix: 'record-broken-output-' }), 'state');
        const execution = ref('broken-output');
        const fs = faulty(real, { whenPathHas: path.join('output', segmentFile(0n)), onCall: 2, fails: true });
        const chunk = (text: string) => Effect.succeed(new TextEncoder().encode(text));
        const before = yield* Effect.scoped(
          Effect.gen(function* () {
            const record = yield* makeSegmentRecord({ mode: 'create', records: root, ref: execution, transport: 'pipes', limits }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            );
            const waiting = yield* Effect.forkChild(record.awaitBeyond('output', 0n, undefined));
            yield* record.capture('stdout', 16, chunk('lost'));
            yield* record.capture('stdout', 16, chunk('kept'));
            const woke = yield* Fiber.join(waiting);
            const ended = yield* record.positions('output');
            yield* record.suspend();
            return { woke, ended };
          }),
        );
        const record = yield* makeSegmentRecord({ mode: 'reopen', records: root, ref: execution, transport: 'pipes', limits });
        yield* record.capture('stdout', 16, chunk('more'));
        const stdout = yield* record.read({ ref: execution, stream: 'stdout', offset: byteOffset(0n) }, 16);
        return { ...before, reopened: yield* record.positions('output'), stdout: new TextDecoder().decode(stdout.bytes) };
      });
      expect(outcome.woke).toBe(false);
      expect(outcome.ended.ending).toBe('error');
      expect(outcome.reopened).toMatchObject({ ending: 'error', durableThrough: byteOffset(0n) });
      expect(outcome.stdout).toBe('lostkeptmore');
    }),
  );
});
