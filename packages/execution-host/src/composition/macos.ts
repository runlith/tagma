import { Context, Effect, Layer } from 'effect';
import { PlatformFacts } from '../PlatformFacts';
import { Processes } from '../ProcessReader';
import { ProcessControl } from '../ProcessControl';
import { processControl } from '../posix/control';
import { EvidenceReader } from '../EvidenceScans';
import { UsageSource } from '../UsageReader';
import { Holder } from '../holder/Holder';
import { loadLibrary } from '../posix/Library';
import { holderLayer as heldLayer } from '../posix/PosixHolder';
import { processReader, processWorker } from '../posix/macos/processes';
import { platformFacts, platformIdentity } from '../posix/macos/facts';
import { evidenceProbe } from '../posix/macos/evidence';
import { MACHINE_PROBE_LIMITS, readStanding } from '../posix/macos/standing';
import { tempoLayer } from '../posix/Tempo';
import { openUsage } from '../posix/Usage';
import { endpointLayer } from '../posix/endpoint';
import { fileHolders as holdersOf } from '../posix/macos/holders';
import { askLogicToYield, yieldRequests } from '../posix/yieldSignal';
import { YieldRequests } from '../YieldRequests';
import { hostSpawner } from '../hostSpawner';
import { BootRefused } from '../boot';

export const nativePlatform = {
  processes: processReader,
  facts: platformFacts,
  identity: platformIdentity,
  standing: readStanding,
  usage: (path: string) => openUsage(path, processWorker),
};

export const holderLayer = (path: string) =>
  heldLayer(path).pipe(
    Layer.catchTag('HolderUnavailable', (error) =>
      Layer.effect(Holder, Effect.fail(new BootRefused({ detail: `the holder could not be reached: ${error.detail}` }))),
    ),
  );

const loaded = (path: string) =>
  loadLibrary(path).pipe(
    Effect.mapError((error) => new BootRefused({ detail: `the native library ${error.path}: ${error.reason}: ${error.detail}` })),
  );

export const processLayer = (path: string) => Layer.effect(Processes, Effect.flatMap(loaded(path), processReader));

export const yieldAsker = (path: string) => Effect.map(Effect.flatMap(loaded(path), processReader), askLogicToYield);

export const fileHolders = (file: string) => holdersOf(file);

export const platformLayer = (path: string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const library = yield* loaded(path);
      const facts = yield* platformFacts(library);
      const reader = yield* processReader(library);
      const probe = yield* evidenceProbe({ ...MACHINE_PROBE_LIMITS, probeMs: 2_000 }).pipe(Effect.provideService(Processes, reader));
      const asked = yield* yieldRequests;
      return Context.make(PlatformFacts, facts).pipe(
        Context.add(Processes, reader),
        Context.add(ProcessControl, processControl(reader)),
        Context.add(EvidenceReader, probe),
        Context.add(UsageSource, { open: openUsage(path, processWorker) }),
        Context.add(YieldRequests, asked),
      );
    }),
  ).pipe(Layer.provide(hostSpawner), Layer.merge(tempoLayer), Layer.merge(endpointLayer));
