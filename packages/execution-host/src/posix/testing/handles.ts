import { dlopen, FFIType, ptr, read } from 'bun:ffi';
import { Effect } from 'effect';
import { constants } from 'node:os';
import { testSystem } from '../../composition/testing/system';

const LIMIT = 32n;
const DEVICE = new TextEncoder().encode('/dev/null\0');
const symbols = {
  getrlimit: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  setrlimit: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  open: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
} as const;

export const withoutHandles = <A, E, R>(work: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const system = yield* Effect.orDie(testSystem);
      const NOFILE = system.nofile;
      const errno = yield* Effect.acquireRelease(
        Effect.sync(() => dlopen(system.libc, { [system.errno]: { args: [], returns: FFIType.ptr } })),
        (opened) => Effect.sync(() => opened.close()),
      );
      const library = yield* Effect.acquireRelease(
        Effect.sync(() => dlopen(system.libc, symbols)),
        (opened) => Effect.sync(() => opened.close()),
      );
      const original = new BigUint64Array(2);
      const held: number[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          if (library.symbols.getrlimit(NOFILE, ptr(original)) !== 0) throw new Error('getrlimit refused the test quota');
          const limited = new BigUint64Array([original[0]! < LIMIT ? original[0]! : LIMIT, original[1]!]);
          if (library.symbols.setrlimit(NOFILE, ptr(limited)) !== 0) throw new Error('setrlimit refused the test quota');
        }),
        () =>
          Effect.sync(() => {
            for (const fd of held) library.symbols.close(fd);
            if (library.symbols.setrlimit(NOFILE, ptr(original)) !== 0) throw new Error('setrlimit refused to restore the test quota');
          }),
      );
      yield* Effect.sync(() => {
        for (;;) {
          const fd = library.symbols.open(ptr(DEVICE), 0);
          if (fd >= 0) {
            held.push(fd);
            continue;
          }
          const error = errno.symbols[system.errno]!();
          if (error === null || read.i32(error, 0) !== constants.errno.EMFILE)
            throw new Error('the descriptor fixture stopped without EMFILE');
          break;
        }
      });
      return yield* work;
    }),
  );
