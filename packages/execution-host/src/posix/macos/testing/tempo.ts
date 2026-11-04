import { dlopen, FFIType, ptr } from 'bun:ffi';
import { Effect } from 'effect';
import { ChannelFailed } from '../../../holder/Holder';

const TASK_INFO = 4;
const TASK_BYTES = 96;
const THREAD_COUNT_OFFSET = 84;
const THREAD_LIST = 6;
const THREAD_INFO = 5;
const THREAD_BYTES = 112;
const PRIORITY_OFFSET = 40;
const BACKGROUND_PRIORITY = 4;
const BSD_INFO = 3;
const BSD_BYTES = 136;
const DARWINBG = 0x8000 | 0x10000;

export const background = Effect.fn('posix.testing.background')(function* (pid: number) {
  const library = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        dlopen('libproc.dylib', {
          proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
        }),
      catch: (error) => new ChannelFailed({ reason: 'os', detail: String(error) }),
    }),
    (opened) => Effect.sync(() => opened.close()),
  );
  const task = new Uint8Array(TASK_BYTES);
  const read = library.symbols.proc_pidinfo(pid, TASK_INFO, 0n, ptr(task), task.length);
  if (read !== task.length) return yield* new ChannelFailed({ reason: 'os', detail: `task info of ${pid} returned ${read} bytes` });
  const count = new DataView(task.buffer).getInt32(THREAD_COUNT_OFFSET, true);
  if (count <= 0) return yield* new ChannelFailed({ reason: 'os', detail: `task ${pid} has no readable threads` });
  const threads = new BigUint64Array(count);
  const listed = library.symbols.proc_pidinfo(pid, THREAD_LIST, 0n, ptr(threads), threads.byteLength);
  if (listed !== threads.byteLength)
    return yield* new ChannelFailed({ reason: 'os', detail: `thread list of ${pid} returned ${listed} bytes` });
  const bsd = new Uint8Array(BSD_BYTES);
  const flagged = library.symbols.proc_pidinfo(pid, BSD_INFO, 0n, ptr(bsd), bsd.length);
  if (flagged !== bsd.length) return yield* new ChannelFailed({ reason: 'os', detail: `bsd info of ${pid} returned ${flagged} bytes` });
  const thread = new Uint8Array(THREAD_BYTES);
  let background = (new DataView(bsd.buffer).getUint32(0, true) & DARWINBG) !== 0;
  for (const address of threads) {
    const read = library.symbols.proc_pidinfo(pid, THREAD_INFO, address, ptr(thread), thread.length);
    if (read !== thread.length)
      return yield* new ChannelFailed({ reason: 'os', detail: `thread ${address} of ${pid} returned ${read} bytes` });
    background &&= new DataView(thread.buffer).getInt32(PRIORITY_OFFSET, true) === BACKGROUND_PRIORITY;
  }
  const checked = library.symbols.proc_pidinfo(pid, TASK_INFO, 0n, ptr(task), task.length);
  if (checked !== task.length || new DataView(task.buffer).getInt32(THREAD_COUNT_OFFSET, true) !== count)
    return yield* new ChannelFailed({ reason: 'os', detail: `thread population of ${pid} changed during the reading` });
  return background;
}, Effect.scoped);
