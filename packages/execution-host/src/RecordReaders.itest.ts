import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path, Schema, Scope } from 'effect';
import { CapabilityProfile, ceilingsOf } from '@runlith/executions/protocol/capacity';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { ExecutionCapacity } from './ExecutionCapacity';
import { fixtureMachine } from './hostFixture';
import { makeSegmentRecord } from './ExecutionRecord';
import { makeRecordReaders } from './RecordReaders';

const policy = {
  transports: ['pty', 'pipes'],
  relations: ['leader'],
  execution: {
    input: { pendingBytes: 64, chunkBytes: 64, receipts: 1 },
    output: { landingBytes: 16, segmentBytes: 16, retainedBytes: 32 },
    parser: { pendingBytes: 64, cellBytes: 64 },
    geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
    read: { chunkBytes: 16, readerCredits: 16, readers: 2 },
    frame: { bytes: 64, inFlight: 1 },
    receipts: 2,
  },
  host: { bindings: 2, custodyReceipts: 2, tombstones: 2 },
} as const;
const machine = fixtureMachine(policy, 2);
const profile = Schema.decodeUnknownSync(CapabilityProfile)({
  version: 1,
  platform: { os: 'darwin', arch: 'arm64' },
  runtime: { name: 'bun', version: '1.4.2' },
  native: { crate: 'execution-platform', version: '0.1.0', build: 'fixture' },
  ...policy,
  granted: machine.granted,
  ceilings: ceilingsOf(policy, machine),
});
const ref = Schema.decodeUnknownSync(ExecutionRef)({ installation: 'readers-test', execution: 'one', incarnation: 1 });
const shared = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, ExecutionCapacity.layer(profile));

const recorded = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const capacity = yield* ExecutionCapacity;
  const root = path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'record-readers-' }), 'state');
  const record = yield* makeSegmentRecord({
    mode: 'create',
    records: root,
    ref,
    transport: 'pty',
    limits: profile.execution,
    grid: { rows: 24, columns: 80 },
  });
  yield* Effect.acquireRelease(capacity.reserve(ref.execution, 'pty'), () => capacity.release(ref.execution));
  yield* record.append('pty', new Uint8Array(16).fill(0x41));
  yield* record.append('pty', new Uint8Array(16).fill(0x42));
  return { record, readers: yield* makeRecordReaders({ record }) };
});

const flowing = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const capacity = yield* ExecutionCapacity;
  const root = path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'record-flow-' }), 'state');
  const record = yield* makeSegmentRecord({
    mode: 'create',
    records: root,
    ref,
    transport: 'pipes',
    limits: profile.execution,
    streaming: ['stdout'],
  });
  yield* Effect.acquireRelease(capacity.reserve(ref.execution, 'pipes'), () => capacity.release(ref.execution));
  yield* record.append('stdout', new Uint8Array(16).fill(0x41));
  yield* record.append('stdout', new Uint8Array(16).fill(0x42));
  return { record, readers: yield* makeRecordReaders({ record }) };
});
const pending = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
  const finished = yield* Deferred.make<void>();
  const fiber = yield* Effect.forkScoped(effect.pipe(Effect.onExit(() => Deferred.succeed(finished, undefined))), {
    startImmediately: true,
  });
  expect(yield* Deferred.isDone(finished)).toBe(false);
  return fiber;
});

layer(shared, { excludeTestServices: true })('RecordReaders', (it) => {
  it.effect('streaming retention waits for the first reader and only releases bytes that reader has taken', () =>
    Effect.gen(function* () {
      const { record, readers } = yield* flowing;
      const writing = yield* pending(record.append('stdout', new Uint8Array(16).fill(0x43)));
      expect(yield* record.positions('stdout')).toMatchObject({ retainedFrom: byteOffset(0n), durableThrough: byteOffset(32n) });
      const reader = yield* readers.open('stdout', byteOffset(0n));
      yield* readers.grant(reader, 16);
      expect((yield* readers.pull(reader)).bytes).toEqual(new Uint8Array(16).fill(0x41));
      expect(yield* Fiber.join(writing)).toBe(byteOffset(48n));
      expect(yield* record.positions('stdout')).toMatchObject({ retainedFrom: byteOffset(16n), durableThrough: byteOffset(48n) });
      yield* readers.grant(reader, 16);
      expect((yield* readers.pull(reader)).bytes).toEqual(new Uint8Array(16).fill(0x42));
      yield* readers.grant(reader, 16);
      expect((yield* readers.pull(reader)).bytes).toEqual(new Uint8Array(16).fill(0x43));
    }),
  );

  it.effect('the slowest streaming reader holds retention, and releasing it wakes the blocked append without moving the other cursor', () =>
    Effect.gen(function* () {
      const { record, readers } = yield* flowing;
      const fast = yield* readers.open('stdout', byteOffset(0n));
      const slowScope = yield* Scope.fork(yield* Effect.scope);
      yield* readers.open('stdout', byteOffset(0n)).pipe(Scope.provide(slowScope));
      yield* readers.grant(fast, 16);
      yield* readers.pull(fast);
      const writing = yield* pending(record.append('stdout', new Uint8Array(16).fill(0x43)));
      expect((yield* readers.position(fast)).offset).toBe(byteOffset(16n));
      yield* Scope.close(slowScope, Exit.void);
      expect(yield* Fiber.join(writing)).toBe(byteOffset(48n));
      expect((yield* readers.position(fast)).offset).toBe(byteOffset(16n));
      yield* readers.grant(fast, 16);
      const next = yield* readers.pull(fast);
      expect(next.range.gap).toBe(false);
      expect(next.bytes).toEqual(new Uint8Array(16).fill(0x42));
    }),
  );

  it.effect('a pressured append is interruptible, and sealing wakes another with a typed refusal', () =>
    Effect.gen(function* () {
      const { record } = yield* flowing;
      const writing = yield* pending(record.append('stdout', new Uint8Array(16).fill(0x43)));
      yield* Fiber.interrupt(writing);
      expect(Exit.isFailure(yield* Fiber.await(writing))).toBe(true);
      const sealed = yield* pending(Effect.result(record.append('stdout', new Uint8Array(16).fill(0x44))));
      yield* record.seal();
      const refused = yield* Fiber.join(sealed);
      expect(refused._tag === 'Failure' ? refused.failure : undefined).toMatchObject({ _tag: 'RecordRefused', reason: { _tag: 'Sealed' } });
    }),
  );

  it.effect('releasing the last drain restores bounded eviction and the next reader learns the resulting gap', () =>
    Effect.gen(function* () {
      const { record, readers } = yield* flowing;
      const readerScope = yield* Scope.fork(yield* Effect.scope);
      yield* readers.open('stdout', byteOffset(0n)).pipe(Scope.provide(readerScope));
      const writing = yield* pending(record.append('stdout', new Uint8Array(16).fill(0x43)));
      yield* Scope.close(readerScope, Exit.void);
      expect(yield* Fiber.join(writing)).toBe(byteOffset(48n));
      const late = yield* readers.open('stdout', byteOffset(0n));
      yield* readers.grant(late, 16);
      const missed = yield* readers.pull(late);
      expect(missed.range.gap).toBe(true);
      expect(missed.range.next).toBe(byteOffset(16n));
      expect(missed.bytes.length).toBe(0);
    }),
  );

  it.effect('ending a pressured stream wakes its writer with the typed Ended refusal', () =>
    Effect.gen(function* () {
      const { record } = yield* flowing;
      const writing = yield* pending(Effect.result(record.append('stdout', new Uint8Array(16).fill(0x43))));
      yield* record.endStream('stdout', 'eof');
      const refused = yield* Fiber.join(writing);
      expect(refused._tag === 'Failure' ? refused.failure : undefined).toMatchObject({ _tag: 'RecordRefused', reason: { _tag: 'Ended' } });
    }),
  );

  it.effect('two readers hold their own place and their own credit', () =>
    Effect.gen(function* () {
      const { readers } = yield* recorded;
      const fast = yield* readers.open('pty', byteOffset(0n));
      const slow = yield* readers.open('pty', byteOffset(0n));
      yield* readers.grant(fast, 16);
      const first = yield* readers.pull(fast);
      yield* readers.grant(fast, 16);
      const second = yield* readers.pull(fast);
      const idle = yield* readers.pull(slow);
      yield* readers.grant(slow, 8);
      const partial = yield* readers.pull(slow);
      expect(String.fromCharCode(...first.bytes)).toBe('A'.repeat(16));
      expect(String.fromCharCode(...second.bytes)).toBe('B'.repeat(16));
      expect(first.credit).toBe(0);
      expect(idle.bytes.length).toBe(0);
      expect(idle.credit).toBe(0);
      expect(idle.range.durableThrough).toBe(byteOffset(32n));
      expect(partial.bytes.length).toBe(8);
      expect(partial.credit).toBe(0);
      expect((yield* readers.position(slow)).offset).toBe(byteOffset(8n));
      expect((yield* readers.position(fast)).offset).toBe(byteOffset(32n));
    }),
  );

  it.effect('credit a pull did not spend stays spendable, and the stream it follows says how it ended', () =>
    Effect.gen(function* () {
      const { record, readers } = yield* recorded;
      const reader = yield* readers.open('pty', byteOffset(8n));
      yield* readers.grant(reader, 16);
      const first = yield* readers.pull(reader);
      const second = yield* readers.pull(reader);
      yield* record.endStream('pty', 'eof');
      expect(first.bytes.length).toBe(8);
      expect(first.credit).toBe(8);
      expect(second.bytes.length).toBe(8);
      expect(second.credit).toBe(0);
      const positions = yield* readers.positions(reader);
      expect(positions.ending).toBe('eof');
      expect(positions.durableThrough).toBe(byteOffset(32n));
    }),
  );

  it.effect('credit past the declared budget is refused before anything is handed over', () =>
    Effect.gen(function* () {
      const { readers } = yield* recorded;
      const reader = yield* readers.open('pty', byteOffset(0n));
      yield* readers.grant(reader, 16);
      const refused = yield* Effect.flip(readers.grant(reader, 1));
      const pulled = yield* readers.pull(reader);
      expect(refused._tag).toBe('CreditRefused');
      if (refused._tag !== 'CreditRefused') return;
      expect(refused.held).toBe(16);
      expect(refused.limit).toBe(16);
      expect(pulled.bytes.length).toBe(16);
    }),
  );

  it.effect('a reader slot past the execution budget refuses, and a released one is a slot again', () =>
    Effect.gen(function* () {
      const { readers } = yield* recorded;
      const refused = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* readers.open('pty', byteOffset(0n));
          yield* readers.open('pty', byteOffset(0n));
          return yield* Effect.flip(readers.open('pty', byteOffset(0n)));
        }),
      );
      const again = yield* readers.open('pty', byteOffset(0n));
      expect(refused._tag).toBe('CapacityRefused');
      if (refused._tag !== 'CapacityRefused') return;
      expect(refused.budget).toBe('execution.read.readers');
      expect(again).toBeString();
    }),
  );

  it.effect('a reader left below the retained frontier is told of the gap and resumes where the bytes do', () =>
    Effect.gen(function* () {
      const { record, readers } = yield* recorded;
      const reader = yield* readers.open('pty', byteOffset(0n));
      yield* record.acknowledgeParsed('pty', byteOffset(16n));
      yield* record.append('pty', new Uint8Array(16).fill(0x43));
      yield* readers.grant(reader, 16);
      const gapped = yield* readers.pull(reader);
      const resumed = yield* readers.pull(reader);
      expect(gapped.range.gap).toBe(true);
      expect(gapped.bytes.length).toBe(0);
      expect(gapped.range.next).toBe(byteOffset(16n));
      expect(gapped.credit).toBe(16);
      expect(String.fromCharCode(...resumed.bytes)).toBe('B'.repeat(16));
    }),
  );

  it.effect('a reader at the frontier is woken by a resize and handed its grid with no bytes, and waits again until something moves', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const capacity = yield* ExecutionCapacity;
      const root = path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'record-readers-grid-' }), 'state');
      const record = yield* makeSegmentRecord({
        mode: 'create',
        records: root,
        ref,
        transport: 'pty',
        limits: profile.execution,
        grid: { rows: 24, columns: 80 },
      });
      yield* Effect.acquireRelease(capacity.reserve(ref.execution, 'pty'), () => capacity.release(ref.execution));
      yield* record.append('pty', new Uint8Array(8).fill(0x41));
      const readers = yield* makeRecordReaders({ record });
      const reader = yield* readers.open('pty', byteOffset(8n));
      yield* readers.grant(reader, 16);
      yield* readers.awaitMore(reader);
      const born = yield* readers.pull(reader);
      const waiting = yield* pending(readers.awaitMore(reader));
      yield* record.regrid({ rows: 20, columns: 60 });
      yield* Fiber.join(waiting);
      const resized = yield* readers.pull(reader);
      yield* record.append('pty', new Uint8Array(4).fill(0x42));
      yield* readers.awaitMore(reader);
      const bytes = yield* readers.pull(reader);
      expect([born.bytes.length, born.regridded, born.range.grid]).toEqual([0, true, { rows: 24, columns: 80 }]);
      expect([resized.bytes.length, resized.regridded, resized.range.grid]).toEqual([0, true, { rows: 20, columns: 60 }]);
      expect([bytes.bytes.length, bytes.regridded, bytes.range.grid]).toEqual([4, false, { rows: 20, columns: 60 }]);
    }),
  );
});
