import { Effect, FileSystem } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { LimitsUnreadable, PlatformFacts, type PlatformIdentity } from '../../PlatformFacts';
import { Holder } from '../../holder/Holder';
import type { LoadedLibrary } from '../Library';
import { readStanding, MACHINE_PROBE_LIMITS } from './standing';

export const platformIdentity = (loaded: LoadedLibrary): PlatformIdentity => ({
  platform: { os: 'darwin', arch: process.arch },
  runtime: { name: 'bun', version: Bun.version },
  native: { crate: loaded.build.crate, version: loaded.build.version, build: loaded.build.digest },
  transports: ['pipes', 'pty'],
  relations: ['leader'],
});

export const platformFacts = Effect.fnUntraced(function* (loaded: LoadedLibrary) {
  const holder = yield* Holder;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return PlatformFacts.of({
    identity: platformIdentity(loaded),
    descriptors: {
      pty: { holder: holder.descriptors.expense.pty, logic: holder.descriptors.copies.pty },
      pipes: { holder: holder.descriptors.expense.pipes, logic: holder.descriptors.copies.pipes },
    },
    limits: Effect.suspend(() => {
      const read = loaded.abi.limits();
      return 'refusal' in read
        ? Effect.fail(new LimitsUnreadable({ detail: read.detail === '' ? read.refusal : read.detail }))
        : Effect.succeed({ ...read, holderFiles: holder.descriptors.limit });
    }),
    standing: (observe) =>
      readStanding(MACHINE_PROBE_LIMITS, holder.pid, loaded, observe).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
    recountMs: MACHINE_PROBE_LIMITS.probeMs,
    uptimeNanos: () => loaded.abi.uptimeNanos(),
  });
});
