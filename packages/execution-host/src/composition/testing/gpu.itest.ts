import { expect } from 'bun:test';
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { layer } from '@runlith/effect-test';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Data, Deferred, Effect, Layer, Stream } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import type { LoadReading } from '@runlith/executions/protocol/evidence';
import { hosted } from './host';
import { posix } from './posix';
import { Host } from './session';
import { NativeUsage } from '../../posix/macos/UsageAbi';
import { HOLDER_LIBRARY } from '../../posix/testing/holder';

class GpuFixtureFailed extends Data.TaggedError('GpuFixtureFailed')<{ readonly message: string }> {}
const failed = (error: unknown) => new GpuFixtureFailed({ message: String(error) });
const packageRoot = resolve(import.meta.dir, '../../..');

if (process.platform === 'darwin') {
  const adapter = hosted('macOS GPU', posix(), { usage: { periodMs: 100 } });
  layer(adapter.layer.pipe(Layer.provideMerge(BunServices.layer)), { excludeTestServices: true })('native GPU load', (it) => {
    it.effect('completed work on two queues grows native GPU and reaches Load with a positive interval', () =>
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const compiler = yield* spawner.spawn(
          ChildProcess.make(
            'cargo',
            [
              'build',
              '-j',
              '1',
              '--release',
              '--locked',
              '--manifest-path',
              'native/Cargo.toml',
              '-p',
              'execution-platform',
              '--example',
              'gpu-work',
              '--target-dir',
              'native/target',
            ],
            { cwd: packageRoot, env: { HOME: userInfo().homedir }, extendEnv: true, stdout: 'inherit', stderr: 'inherit' },
          ),
        );
        if ((yield* compiler.exitCode) !== 0) return yield* failed('the Metal fixture did not compile');
        const child = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              Bun.spawn([resolve(packageRoot, 'native/target/release/examples/gpu-work')], {
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'inherit',
              }),
            catch: failed,
          }),
          (child) =>
            Effect.andThen(
              Effect.sync(() => child.stdin.end()),
              Effect.promise(() => child.exited),
            ),
        );
        const reader = yield* Effect.acquireRelease(
          Effect.sync(() => child.stdout.getReader()),
          (reader) => Effect.sync(() => reader.releaseLock()),
        );
        const decoder = new TextDecoder();
        let pending = '';
        const line = () =>
          Effect.tryPromise({
            try: async () => {
              while (!pending.includes('\n')) {
                const read = await reader.read();
                if (read.done) throw new Error(`the Metal fixture ended before its event: ${pending}`);
                pending += decoder.decode(read.value, { stream: true });
              }
              const at = pending.indexOf('\n');
              const next = pending.slice(0, at);
              pending = pending.slice(at + 1);
              return next;
            },
            catch: failed,
          });
        const ready = yield* line();
        expect(['ready', 'unavailable']).toContain(ready);
        const native = yield* Effect.acquireRelease(Effect.try({ try: () => NativeUsage.load(HOLDER_LIBRARY), catch: failed }), (library) =>
          Effect.sync(() => library.unload()),
        );
        const own = () => {
          const read = native.gpu();
          return read._tag === 'Read' ? read.clients.filter((client) => client.pid === child.pid) : [];
        };
        const before = own();
        const measured = before.length > 0 && before.every((client) => client.gpu._tag === 'Measured');
        const host = yield* Host;
        const subscription = yield* host.client.load(process.pid, []);
        const processOf = (reading: LoadReading) =>
          reading.groups.flatMap((group) => group.processes).find((row) => row.identity.pid === child.pid);
        if (!measured || ready === 'unavailable') {
          const readings = yield* subscription.readings.pipe(Stream.take(3), Stream.runCollect);
          const gpu = processOf(readings[2]!)?.gpu;
          expect(gpu).toMatchObject({ _tag: measured ? 'Measured' : 'Unavailable' });
          if (gpu?._tag === 'Unavailable') expect(gpu.reason.length).toBeGreaterThan(0);
          return;
        }
        expect(ready).toBe('ready');
        const baseline = yield* Deferred.make<LoadReading, unknown>();
        const positive = yield* Deferred.make<LoadReading, unknown>();
        yield* Effect.forkScoped(
          subscription.readings.pipe(
            Stream.runForEach((reading) => {
              const gpu = processOf(reading)?.gpu;
              return gpu?._tag !== 'Measured'
                ? Effect.void
                : gpu.cores > 0
                  ? Deferred.succeed(positive, reading)
                  : Deferred.succeed(baseline, reading);
            }),
            Effect.tapError((error) => Effect.andThen(Deferred.fail(baseline, error), Deferred.fail(positive, error))),
          ),
        );
        yield* Deferred.await(baseline);
        const total = () => own().reduce((sum, client) => sum + (client.gpu._tag === 'Measured' ? client.gpu.micros : 0), 0);
        const initial = total();
        yield* Effect.sync(() => child.stdin.write('first\n'));
        const firstEvent = (yield* line()).split(' ');
        expect(firstEvent[0]).toBe('first');
        expect(Number(firstEvent[1])).toBeGreaterThan(0);
        const first = total();
        expect(first).toBeGreaterThan(initial);
        yield* Effect.sync(() => child.stdin.write('second\n'));
        const secondEvent = (yield* line()).split(' ');
        expect(secondEvent[0]).toBe('second');
        expect(Number(secondEvent[1])).toBeGreaterThan(0);
        const second = total();
        expect(second).toBeGreaterThan(first);
        const reading = yield* Deferred.await(positive);
        const gpu = processOf(reading)?.gpu;
        expect(gpu?._tag === 'Measured' ? gpu.cores : undefined).toBeGreaterThan(0);
        const abi = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              dlopen(HOLDER_LIBRARY, {
                execution_usage_gpu: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
              }),
            catch: failed,
          }),
          (library) => Effect.sync(() => library.close()),
        );
        let capacity = 128;
        let raw: BigUint64Array;
        let count: number;
        for (;;) {
          raw = new BigUint64Array(capacity * 6);
          count = abi.symbols.execution_usage_gpu(ptr(raw), capacity);
          if (count <= capacity) break;
          capacity = count;
        }
        expect(count).toBeGreaterThanOrEqual(0);
        const nanos = new Map<string, bigint>();
        for (let at = 0; at < count; at += 1) {
          const offset = at * 6;
          if (Number(raw[offset]) === child.pid && raw[offset + 5] === 0n) nanos.set(String(raw[offset + 3]!), raw[offset + 4]!);
        }
        const after = own();
        expect(after.length).toBeGreaterThan(0);
        for (const client of after) {
          expect(client.gpu._tag).toBe('Measured');
          const rawNanos = nanos.get(client.client);
          expect(rawNanos).toBeDefined();
          if (client.gpu._tag === 'Measured' && rawNanos !== undefined) expect(client.gpu.micros).toBe(Number(rawNanos / 1000n));
        }
        yield* Effect.sync(() => child.stdin.write('end\n'));
        expect(yield* Effect.promise(() => child.exited)).toBe(0);
      }),
    );
  });
}
