import { CString, dlopen, FFIType, ptr, toArrayBuffer, type Pointer } from 'bun:ffi';
import { constants } from 'node:os';
import { birthOf } from './birth';
import { refusalOf, type NativeStatus, type Refused } from '../refusal';
import type { Field, ProcessFacts, ProcessIdentity, ProcessReading, ProcessRow, ProcessProbe } from '../../ProcessReader';

const unread = (errno: number): { readonly _tag: 'Gone' } | { readonly _tag: 'Unreadable'; readonly detail: string } =>
  errno === constants.errno.ESRCH ? { _tag: 'Gone' } : { _tag: 'Unreadable', detail: `the native process read answered errno ${errno}` };

const SYMBOLS = {
  execution_platform_identity: { args: [], returns: FFIType.ptr },
  execution_platform_error: { args: [], returns: FFIType.ptr },
  execution_platform_uptime_nanos: { args: [], returns: FFIType.u64 },
  execution_platform_limits: { args: [FFIType.ptr], returns: FFIType.i32 },
  execution_platform_process_table: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  execution_platform_process_facts: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  execution_platform_processes_release: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  execution_platform_process_identity: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  execution_platform_process_descriptors: { args: [FFIType.i32], returns: FFIType.i32 },
} as const;

type Library = ReturnType<typeof dlopen<typeof SYMBOLS>>;

export interface ProcessAbi {
  unload(): void;
  identity(): string;
  uptimeNanos(): bigint;
  limits(): { readonly openFiles: number; readonly processes: number; readonly terminals: number } | Refused;
  descriptors(pid: number): { readonly count: number } | Refused;
  processTable(request: ProcessProbe): ReadonlyArray<ProcessRow> | Refused;
  processFacts(pids: ReadonlyArray<number>): ProcessReading | Refused;
  processIdentity(pid: number): ProcessIdentity | Refused;
}

export class Abi implements ProcessAbi {
  constructor(private readonly library: Library) {}

  static load(path: string): Abi {
    return new Abi(dlopen(path, SYMBOLS));
  }

  unload(): void {
    this.library.close();
  }

  private detail(): string {
    const pointer = this.library.symbols.execution_platform_error();
    return pointer === null ? '' : new CString(pointer).toString();
  }

  private refused(code: number): Refused {
    const refusal = refusalOf(code);
    return { refusal, detail: refusal === 'failed' || refusal === 'invalid' ? this.detail() : '' };
  }

  private status(code: number): NativeStatus {
    return code >= 0 ? undefined : this.refused(code);
  }

  identity(): string {
    const pointer = this.library.symbols.execution_platform_identity();
    return pointer === null ? '' : new CString(pointer).toString();
  }

  uptimeNanos(): bigint {
    return BigInt(this.library.symbols.execution_platform_uptime_nanos());
  }

  limits(): { readonly openFiles: number; readonly processes: number; readonly terminals: number } | Refused {
    const values = new BigUint64Array(3);
    const code = this.library.symbols.execution_platform_limits(ptr(values));
    if (code < 0) return this.refused(code);
    const [openFiles, processes, terminals] = Array.from(values, Number) as [number, number, number];
    return { openFiles, processes, terminals };
  }

  descriptors(pid: number): { readonly count: number } | Refused {
    const code = this.library.symbols.execution_platform_process_descriptors(pid);
    return code < 0 ? this.refused(code) : { count: code };
  }

  processTable(request: ProcessProbe): ReadonlyArray<ProcessRow> | Refused {
    const pids = request._tag === 'Pids' ? Int32Array.from(request.pids) : new Int32Array(0);
    const terminal =
      request._tag === 'Terminal'
        ? new TextEncoder().encode(`${request.terminal.startsWith('/dev/') ? request.terminal : `/dev/${request.terminal}`}\0`)
        : undefined;
    const slot = new BigUint64Array(1);
    const length = new BigUint64Array(1);
    const code = this.library.symbols.execution_platform_process_table(
      request._tag === 'Table' ? 0 : request._tag === 'Pids' ? 1 : 2,
      pids.length === 0 ? null : ptr(pids),
      pids.length,
      terminal === undefined ? null : ptr(terminal),
      ptr(slot),
      ptr(length),
    );
    if (code < 0) return this.refused(code);
    return this.taken(slot, length, decodeTable);
  }

  processFacts(pids: ReadonlyArray<number>): ProcessReading | Refused {
    const listed = Int32Array.from(pids);
    const slot = new BigUint64Array(1);
    const length = new BigUint64Array(1);
    const code = this.library.symbols.execution_platform_process_facts(
      pids.length === 0 ? null : ptr(listed),
      pids.length,
      ptr(slot),
      ptr(length),
    );
    if (code < 0) return this.refused(code);
    return this.taken(slot, length, decodeFacts);
  }

  private taken<A>(slot: BigUint64Array, length: BigUint64Array, decode: (bytes: Uint8Array) => A): A | Refused {
    const answer = Number(slot[0]) as Pointer;
    const size = Number(length[0]);
    let bytes = new Uint8Array(0);
    let released: NativeStatus;
    try {
      bytes = new Uint8Array(toArrayBuffer(answer, 0, size)).slice();
    } finally {
      released = this.status(this.library.symbols.execution_platform_processes_release(answer, BigInt(size)));
    }
    return released ?? decode(bytes);
  }

  processIdentity(pid: number): ProcessIdentity | Refused {
    const values = new BigUint64Array(5);
    const code = this.library.symbols.execution_platform_process_identity(pid, ptr(values));
    if (code < 0) return this.refused(code);
    if (code > 0) return unread(code);
    return {
      _tag: 'Read',
      pid,
      parent: Number(values[0]!),
      work: Number(values[1]!),
      birth: birthOf(values[2]!, values[3]!),
      zombie: values[4] !== 0n,
    };
  }
}

const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const TABLE_ROW = 7;

function decodeTable(bytes: Uint8Array): ReadonlyArray<ProcessRow> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const half = (index: number): number => view.getUint32(index * 4, true);
  const count = half(0);
  const rows: ProcessRow[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const at = 1 + index * TABLE_ROW;
    rows[index] = {
      pid: half(at),
      parent: half(at + 1),
      work: half(at + 2),
      birth: birthOf(BigInt(half(at + 3)) + (BigInt(half(at + 4)) << 32n), half(at + 5)),
      zombie: half(at + 6) !== 0,
    };
  }
  return rows;
}

function decodeFacts(bytes: Uint8Array): ProcessReading {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const word = (): number => {
    const value = Number(view.getBigUint64(at, true));
    at += 8;
    return value;
  };
  const string = (): string | undefined => {
    const size = word();
    const slice = bytes.subarray(at, at + size);
    at += size;
    try {
      return text.decode(slice);
    } catch {
      return undefined;
    }
  };
  const field = <A>(value: () => A | undefined): Field<A> => {
    const errno = word();
    if (errno !== 0) return { _tag: 'Unreadable', detail: `the native field read answered errno ${errno}` };
    const read = value();
    return read === undefined ? { _tag: 'Unreadable', detail: 'the field is not UTF-8' } : { _tag: 'Read', value: read };
  };
  const strings = (): ReadonlyArray<string> | undefined => {
    const listed = Array.from({ length: word() }, string);
    return listed.every((value): value is string => value !== undefined) ? listed : undefined;
  };
  const processes: ProcessFacts[] = [];
  const refused: Array<ProcessReading['unread'][number]> = [];
  const count = word();
  for (let index = 0; index < count; index += 1) {
    const pid = word();
    const errno = word();
    if (errno !== 0) {
      refused.push({ pid, ...unread(errno) });
      continue;
    }
    const parent = word();
    const work = word();
    const birth = birthOf(word(), word());
    word();
    const args = field(strings);
    const executable = field(string);
    const folder = field(string);
    processes.push({ pid, parent, work, birth, args, executable, folder });
  }
  return { processes, unread: refused };
}
