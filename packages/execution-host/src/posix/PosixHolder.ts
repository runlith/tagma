import { Context, Effect, FileSystem, Layer } from 'effect';
import { Holder } from '../holder/Holder';
import { connect, HolderUnavailable } from '../holder-client/Connection';
import type { Link } from '../holder-client/Link';
import { TerminalInputs } from '../TerminalInputs';
import { Descriptor } from './Descriptor';
import { Descriptors } from './native';
import { Reactor } from './Reactor';
import { openTerminalThread } from './TerminalThread';
import { prepareLaunch } from './launch';
import { leaseProcessWorker } from './ProcessWorker';

export const CONTROL_VARIABLE = 'EXECUTION_HOLDER_FD';
const RECEIVE_DESCRIPTORS = 64;

export const openPosixHolder = Effect.fn('posix.openHolder')(function* (library: string, control: number, spawn: () => Worker) {
  const files = yield* FileSystem.FileSystem;
  const worker = yield* leaseProcessWorker(library, spawn);
  yield* worker.pipe(Effect.mapError((failure) => new HolderUnavailable({ detail: failure.detail })));
  const workState = Effect.fn('posix.workState')(function* (work: number, leader: number, exited: boolean) {
    return yield* Effect.flatMap(worker, (one) => one.group(work, leader, exited)).pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          Effect.as(Effect.logWarning('the process worker could not read work state', failure), 'unmeasured' as const),
        onSuccess: (read) =>
          typeof read === 'string'
            ? Effect.succeed(read)
            : Effect.as(Effect.logWarning('the kernel could not read work state', read), 'unmeasured' as const),
      }),
    );
  });
  const { native, reactor } = yield* Effect.acquireRelease(
    Effect.gen(function* () {
      const native = yield* Effect.try({
        try: () => Descriptors.load(library),
        catch: (error) => new HolderUnavailable({ detail: `the native library ${library} could not be loaded: ${String(error)}` }),
      });
      const reactor = yield* Reactor.open(native).pipe(
        Effect.tapError(() => Effect.sync(() => native.unload())),
        Effect.mapError((failure) => new HolderUnavailable({ detail: failure.detail })),
      );
      return { native, reactor };
    }),
    ({ native, reactor }) =>
      Effect.gen(function* () {
        if (yield* reactor.retire) native.unload();
      }),
  );
  const thread = yield* openTerminalThread(library).pipe(Effect.mapError((failure) => new HolderUnavailable({ detail: failure.detail })));
  const channel = new Descriptor(native, reactor, control);
  const slots = new Int32Array(RECEIVE_DESCRIPTORS);
  const link: Link = {
    copies: { pty: 1, pipes: 3 },
    receive: (landing) =>
      Effect.map(channel.receive(landing, slots), (received) => ({
        count: received.count,
        handles: received.fds,
        capacity: received.capacity,
      })),
    write: (bytes) => channel.write(bytes),
    close: () => channel.close(),
    discard: (fd) => {
      native.close(fd);
    },
    terminal: (fds) => thread.adopt(fds[0]!),
    pipe: (fd) => new Descriptor(native, reactor, fd),
    workState,
    prepare: (launch) => prepareLaunch(launch, native).pipe(Effect.provideService(FileSystem.FileSystem, files)),
  };
  return { holder: yield* connect(link), inputs: thread.inputs };
});

export const openHolder = (library: string, control: number, worker: () => Worker) =>
  Effect.map(openPosixHolder(library, control, worker), (opened) => opened.holder);

export const holderLayer = (library: string, worker: () => Worker) =>
  Layer.effectContext(
    Effect.suspend(() => {
      const named = process.env[CONTROL_VARIABLE];
      const control = named === undefined ? Number.NaN : Number(named);
      return Number.isInteger(control) && control >= 0
        ? Effect.map(openPosixHolder(library, control, worker), (opened) =>
            Context.make(Holder, opened.holder).pipe(Context.add(TerminalInputs, opened.inputs)),
          )
        : Effect.fail(new HolderUnavailable({ detail: `${CONTROL_VARIABLE} names no descriptor; this logic was not started by a holder` }));
    }),
  );
