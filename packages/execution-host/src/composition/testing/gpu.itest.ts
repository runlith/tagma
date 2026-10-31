import { expect } from 'bun:test';
import { dlopen, FFIType } from 'bun:ffi';
import { layer } from '@runlith/effect-test';
import { Data, Effect, Stream } from 'effect';
import { hosted } from './host';
import { posix } from './posix';
import { Host } from './session';
import { NativeUsage } from '../../posix/macos/UsageAbi';
import { HOLDER_LIBRARY } from '../../posix/testing/holder';

class MetalUnavailable extends Data.TaggedError('MetalUnavailable')<{ readonly message: string }> {}

if (process.platform === 'darwin' && process.arch === 'arm64') {
  const adapter = hosted('macOS GPU', posix(), { usage: { periodMs: 100 } });
  layer(adapter.layer, { excludeTestServices: true })('native GPU load', (it) => {
    it.effect('the host preserves the native GPU measurement or its unavailable outcome', () =>
      Effect.gen(function* () {
        const metal = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              dlopen('/System/Library/Frameworks/Metal.framework/Metal', {
                MTLCreateSystemDefaultDevice: { args: [], returns: FFIType.ptr },
              }),
            catch: (error) => new MetalUnavailable({ message: String(error) }),
          }),
          (library) => Effect.sync(() => library.close()),
        );
        const objc = yield* Effect.acquireRelease(
          Effect.try({
            try: () => dlopen('/usr/lib/libobjc.A.dylib', { objc_release: { args: [FFIType.ptr], returns: FFIType.void } }),
            catch: (error) => new MetalUnavailable({ message: String(error) }),
          }),
          (library) => Effect.sync(() => library.close()),
        );
        yield* Effect.acquireRelease(
          Effect.sync(() => metal.symbols.MTLCreateSystemDefaultDevice()),
          (device) =>
            Effect.sync(() => {
              if (device !== null) objc.symbols.objc_release(device);
            }),
        );
        const native = yield* Effect.acquireRelease(
          Effect.try({
            try: () => NativeUsage.load(HOLDER_LIBRARY),
            catch: (error) => new MetalUnavailable({ message: String(error) }),
          }),
          (library) => Effect.sync(() => library.unload()),
        );
        const snapshot = native.gpu();
        const clients = snapshot._tag === 'Read' ? snapshot.clients.filter((client) => client.pid === process.pid) : [];
        const measured = clients.length > 0 && clients.every((client) => client.gpu._tag === 'Measured');
        const host = yield* Host;
        const subscription = yield* host.client.load(process.pid, []);
        const readings = yield* subscription.readings.pipe(Stream.take(3), Stream.runCollect);
        const own = readings[2]?.groups.flatMap((group) => group.processes).find((row) => row.identity.pid === process.pid);
        if (!measured) {
          expect(own?.gpu, JSON.stringify(readings[2])).toMatchObject({ _tag: 'Unavailable' });
          if (own?.gpu._tag === 'Unavailable') expect(own.gpu.reason.length).toBeGreaterThan(0);
        } else {
          expect(own?.gpu, JSON.stringify(readings[2])).toMatchObject({ _tag: 'Measured' });
          if (own?.gpu._tag === 'Measured') expect(own.gpu.cores).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
}
