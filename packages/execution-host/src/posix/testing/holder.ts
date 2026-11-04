import { dirname, join, resolve } from 'node:path';
import { Context, Effect, Exit, FileSystem, Layer, Schedule } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { PlatformFacts } from '../../PlatformFacts';
import { ProcessTempo } from '../../ProcessTempo';
import { platformFacts, processReader } from '../../composition/testing/native';
import { nativeArtifact } from '../../composition/artifact';
import { tempoLayer } from '../Tempo';
import { Processes } from '../../ProcessReader';
import { ProcessControl } from '../../ProcessControl';
import { processControl } from '../control';
import { loadLibrary, type LibraryUnavailable } from '../Library';
import { Holder } from '../../holder/Holder';
import { Descriptors } from '../native';
import { HolderUnavailable } from '../../holder-client/Connection';
import { openPosixHolder } from '../PosixHolder';
import { TerminalInputs } from '../../TerminalInputs';
import { testSystem } from '../../composition/testing/system';
import type { FixtureProcess } from './System';

const RELEASE = resolve(import.meta.dir, '../../../native/target/release');
export const HOLDER_BINARY = join(RELEASE, 'execution-holder');
export const HOLDER_LIBRARY = join(RELEASE, nativeArtifact()!.library);
const RELAY = join(RELEASE, 'execution-holder-relay');

export const heldHost = (entry: string, boot: string): Array<string> => [HOLDER_BINARY, dirname(boot), process.execPath, entry, boot];

const unavailable = (detail: string) => new HolderUnavailable({ detail });

export const testHolder = (
  state: string,
  library: string = HOLDER_LIBRARY,
  binary: string = HOLDER_BINARY,
  isolated = false,
): Layer.Layer<
  Holder | Processes | ProcessControl | PlatformFacts | ProcessTempo,
  HolderUnavailable | LibraryUnavailable | import('../../boot').BootRefused,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> => {
  const held = Layer.effectContext(
    Effect.gen(function* () {
      const native = yield* Effect.acquireRelease(
        Effect.try({ try: () => Descriptors.load(library), catch: (error) => unavailable(`${library}: ${String(error)}`) }),
        (loaded) => Effect.sync(() => loaded.unload()),
      );
      const pair = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const pair = native.pair();
          return 'ends' in pair ? { ...pair, owned: new Set(pair.ends) } : pair;
        }),
        (pair) =>
          Effect.sync(() => {
            if ('ends' in pair) for (const fd of pair.owned) native.close(fd);
          }),
      );
      if (!('ends' in pair)) return yield* unavailable(`no socket pair: ${pair.refusal} ${pair.detail}`);
      const detached = isolated ? yield* Effect.flatMap(testSystem, (system) => system.isolated([binary, state, RELAY])) : undefined;
      const mine = detached?.fd ?? pair.ends[0];
      const theirs = pair.ends[1];
      const launching: Effect.Effect<FixtureProcess, HolderUnavailable> =
        detached === undefined
          ? Effect.try({
              try: () => {
                const spawned = Bun.spawn([binary, state, RELAY], { cwd: state, stdin: theirs, stdout: 'ignore', stderr: 'inherit' });
                native.close(theirs);
                pair.owned.delete(theirs);
                return {
                  exited: Effect.promise(() => spawned.exited),
                  kill: Effect.sync(() => spawned.kill('SIGKILL')),
                  exitCode: () => spawned.exitCode,
                };
              },
              catch: (error) => unavailable(`could not start the holder: ${String(error)}`),
            })
          : Effect.succeed(detached);
      let connected = false;
      const child = yield* Effect.acquireRelease(launching, (spawned) =>
        Effect.gen(function* () {
          if (!connected) yield* spawned.kill;
          yield* spawned.exited;
        }).pipe(Effect.orDie),
      );
      yield* Effect.addFinalizer(() =>
        detached === undefined
          ? Effect.sync(() => {
              if (pair.owned.delete(mine)) native.close(mine);
            })
          : detached.disconnect,
      );
      const landing = new Uint8Array(1);
      const handles = new Int32Array(1);
      const reception = Effect.sync(() => native.receive(mine, landing, handles));
      const received = yield* reception.pipe(
        Effect.repeat({ while: (answer) => 'refusal' in answer && answer.refusal === 'would-block', schedule: Schedule.spaced(5) }),
        Effect.raceFirst(
          Effect.flatMap(child.exited, (code) => unavailable(`the holder exited ${code} before handing its control descriptor`)),
        ),
      );
      const control = 'fds' in received ? received.fds[0] : undefined;
      if (control === undefined) {
        yield* child.kill;
        return yield* unavailable(
          `the holder handed no control descriptor (${JSON.stringify(received)}, exit ${child.exitCode() ?? 'pending'})`,
        );
      }
      const system = yield* testSystem;
      const { holder, inputs } = yield* openPosixHolder(library, control, system.processWorker);
      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Effect.exit(holder.vacate), (vacated) => (Exit.isFailure(vacated) ? child.kill : Effect.void)).pipe(Effect.orDie),
      );
      connected = true;
      return Context.make(Holder, holder).pipe(Context.add(TerminalInputs, inputs));
    }),
  );
  return Layer.effectContext(
    Effect.gen(function* () {
      const loaded = yield* loadLibrary(library);
      const reader = yield* processReader(loaded);
      return Context.make(Processes, reader).pipe(
        Context.add(ProcessControl, processControl(reader)),
        Context.add(PlatformFacts, yield* platformFacts(loaded)),
      );
    }),
  ).pipe(Layer.merge(tempoLayer), Layer.provideMerge(held));
};
