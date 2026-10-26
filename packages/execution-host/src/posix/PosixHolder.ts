import { Effect, FileSystem, Layer } from 'effect';
import { Holder } from '../holder/Holder';
import { connect, HolderUnavailable } from '../holder-client/Connection';
import type { Link } from '../holder-client/Link';
import { Descriptor } from './Descriptor';
import { Descriptors } from './native';
import { Reactor } from './Reactor';
import { prepareLaunch } from './launch';

export const CONTROL_VARIABLE = 'EXECUTION_HOLDER_FD';
const RECEIVE_DESCRIPTORS = 64;

export const openHolder = Effect.fn('posix.openHolder')(function* (library: string, control: number) {
  const files = yield* FileSystem.FileSystem;
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
    terminal: (fds) => new Descriptor(native, reactor, fds[0]!),
    pipe: (fd) => new Descriptor(native, reactor, fd),
    workState: (work, leader, exited) => {
      const read = native.groupState(work, leader, exited);
      return typeof read === 'string' ? read : 'unmeasured';
    },
    prepare: (launch) => prepareLaunch(launch, native).pipe(Effect.provideService(FileSystem.FileSystem, files)),
  };
  return yield* connect(link);
});

export const holderLayer = (library: string) =>
  Layer.effect(
    Holder,
    Effect.suspend(() => {
      const named = process.env[CONTROL_VARIABLE];
      const control = named === undefined ? Number.NaN : Number(named);
      return Number.isInteger(control) && control >= 0
        ? openHolder(library, control)
        : Effect.fail(new HolderUnavailable({ detail: `${CONTROL_VARIABLE} names no descriptor; this logic was not started by a holder` }));
    }),
  );
