import { Context, Effect, Layer, type FileSystem, type Scope } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { BootRefused } from '../boot';
import { PlatformFacts, type PlatformIdentity } from '../PlatformFacts';
import { Processes, type ProcessReader } from '../ProcessReader';
import { ProcessControl } from '../ProcessControl';
import { EvidenceReader, type EvidenceProbe } from '../EvidenceScans';
import { UsageSource, type UsageReader, type UsageUnavailable } from '../UsageReader';
import { Holder } from '../holder/Holder';
import { YieldRequests } from '../YieldRequests';
import { loadLibrary, type LibraryUnavailable, type LoadedLibrary } from '../posix/Library';
import { holderLayer as heldLayer } from '../posix/PosixHolder';
import { processControl } from '../posix/control';
import { tempoLayer } from '../posix/Tempo';
import { endpointLayer } from '../posix/endpoint';
import { askLogicToYield, yieldRequests } from '../posix/yieldSignal';
import type { FileHolders } from '../posix/holders';
import { hostSpawner } from '../hostSpawner';

type PosixSystem = {
  readonly processes: (library: LoadedLibrary) => Effect.Effect<ProcessReader, LibraryUnavailable, Scope.Scope>;
  readonly facts: (
    library: LoadedLibrary,
  ) => Effect.Effect<PlatformFacts['Service'], never, Holder | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>;
  readonly identity: (library: LoadedLibrary) => PlatformIdentity;
  readonly evidence: Effect.Effect<EvidenceProbe, never, Processes | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>;
  readonly usage: (path: string) => Effect.Effect<UsageReader, UsageUnavailable, Scope.Scope>;
  readonly fileHolders: (file: string) => Effect.Effect<FileHolders, never, FileSystem.FileSystem>;
  readonly worker: () => Worker;
};

export const composePosix = (system: PosixSystem) => {
  const refused = (error: LibraryUnavailable) =>
    new BootRefused({ detail: `the native library ${error.path}: ${error.reason}: ${error.detail}` });
  const loaded = (path: string) => loadLibrary(path).pipe(Effect.mapError(refused));
  const processes = (library: LoadedLibrary) => system.processes(library).pipe(Effect.mapError(refused));
  return {
    nativePlatform: system,
    holderLayer: (path: string) =>
      heldLayer(path, system.worker).pipe(
        Layer.catchTag('HolderUnavailable', (error) =>
          Layer.effect(Holder, Effect.fail(new BootRefused({ detail: `the holder could not be reached: ${error.detail}` }))),
        ),
      ),
    processLayer: (path: string) => Layer.effect(Processes, Effect.flatMap(loaded(path), processes)),
    yieldAsker: (path: string) => Effect.map(Effect.flatMap(loaded(path), processes), askLogicToYield),
    fileHolders: (file: string) => Effect.provide(system.fileHolders(file), BunFileSystem.layer),
    platformLayer: (path: string) =>
      Layer.effectContext(
        Effect.gen(function* () {
          const library = yield* loaded(path);
          const facts = yield* system.facts(library);
          const reader = yield* processes(library);
          const probe = yield* system.evidence.pipe(Effect.provideService(Processes, reader));
          const asked = yield* yieldRequests;
          return Context.make(PlatformFacts, facts).pipe(
            Context.add(Processes, reader),
            Context.add(ProcessControl, processControl(reader)),
            Context.add(EvidenceReader, probe),
            Context.add(UsageSource, { open: system.usage(path) }),
            Context.add(YieldRequests, asked),
          );
        }),
      ).pipe(Layer.provide(hostSpawner), Layer.merge(tempoLayer), Layer.merge(endpointLayer)),
  };
};
