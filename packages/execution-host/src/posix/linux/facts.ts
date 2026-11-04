import { Effect, FileSystem } from 'effect';
import { Holder } from '../../holder/Holder';
import { LimitsUnreadable, PlatformFacts, StandingUnreadable, type PlatformIdentity } from '../../PlatformFacts';
import type { LoadedLibrary } from '../Library';
import { pids, statusOf } from './proc';

export const platformIdentity = (loaded: LoadedLibrary): PlatformIdentity => ({
  platform: { os: 'linux', arch: process.arch },
  runtime: { name: 'bun', version: Bun.version },
  native: { crate: loaded.build.crate, version: loaded.build.version, build: loaded.build.digest },
  transports: ['pipes', 'pty'],
  relations: ['leader'],
});

export const platformFacts = Effect.fnUntraced(function* (loaded: LoadedLibrary) {
  const holder = yield* Holder;
  const files = yield* FileSystem.FileSystem;
  const uid = process.getuid?.();
  const standing = Effect.fn('posix.readStanding')(function* (observe: () => void) {
    const read = yield* Effect.sync(() => {
      const logic = loaded.abi.descriptors(process.pid);
      const held = loaded.abi.descriptors(holder.pid);
      observe();
      return { logic, held };
    });
    if ('refusal' in read.logic)
      return yield* new StandingUnreadable({ region: 'the logic descriptors', detail: read.logic.detail || read.logic.refusal });
    if ('refusal' in read.held)
      return yield* new StandingUnreadable({ region: 'the holder descriptors', detail: read.held.detail || read.held.refusal });
    let processes = 0;
    for (const pid of yield* pids.pipe(
      Effect.mapError((error) => new StandingUnreadable({ region: error.region, detail: error.detail })),
    )) {
      const status = yield* statusOf(pid).pipe(
        Effect.mapError((error) => new StandingUnreadable({ region: error.region, detail: error.detail })),
      );
      if (status._tag === 'Read' && status.uid === uid) processes += status.threads;
    }
    const path = '/proc/sys/kernel/pty/nr';
    const text = yield* files
      .readFileString(path)
      .pipe(Effect.mapError((error) => new StandingUnreadable({ region: path, detail: error.message })));
    const terminals = Number(text.trim());
    if (!Number.isSafeInteger(terminals) || terminals < 0)
      return yield* new StandingUnreadable({ region: path, detail: 'the kernel PTY count is not a nonnegative integer' });
    if (processes < 1)
      return yield* new StandingUnreadable({ region: 'the current UID process population', detail: 'the census omitted its own caller' });
    return { descriptors: read.logic.count, holderDescriptors: read.held.count, processes, terminals };
  });
  return PlatformFacts.of({
    identity: platformIdentity(loaded),
    descriptors: {
      pty: { holder: holder.descriptors.expense.pty, logic: holder.descriptors.copies.pty },
      pipes: { holder: holder.descriptors.expense.pipes, logic: holder.descriptors.copies.pipes },
    },
    limits: Effect.suspend(() => {
      const read = loaded.abi.limits();
      return 'refusal' in read
        ? Effect.fail(new LimitsUnreadable({ detail: read.detail || read.refusal }))
        : Effect.succeed({ ...read, holderFiles: holder.descriptors.limit });
    }),
    standing: (observe) => Effect.provideService(standing(observe), FileSystem.FileSystem, files),
    recountMs: 2_000,
    uptimeNanos: () => loaded.abi.uptimeNanos(),
  });
});
