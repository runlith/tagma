import { CString, dlopen, FFIType, ptr, type JSCallback, type Pointer } from 'bun:ffi';
import type { WorkState } from '../holder/Holder';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import { birthOf } from './birth';
export type TerminalFacts = {
  readonly pid: number;
  readonly pgid: number;
  readonly sid: number;
  readonly foreground: number;
  readonly rows: number;
  readonly cols: number;
  readonly interrupt: number;
  readonly isig: boolean;
  readonly canonical: boolean;
  readonly echo: boolean;
  readonly echoControl: boolean;
  readonly noFlush: boolean;
  readonly external: boolean;
};

import { refusalOf, type NativeAnswer, type NativeStatus, type Refused } from './refusal';

const SYMBOLS = {
  execution_platform_error: { args: [], returns: FFIType.ptr },
  execution_platform_user_home: { args: [], returns: FFIType.ptr },
  execution_platform_fd_read: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  execution_platform_fd_write: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  execution_platform_fd_close: { args: [FFIType.i32], returns: FFIType.i32 },
  execution_platform_fd_receive: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  execution_platform_fd_pair: { args: [FFIType.ptr], returns: FFIType.i32 },
  execution_platform_group_state: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  execution_platform_fd_resize: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  execution_platform_fd_interrupt: { args: [FFIType.i32], returns: FFIType.i32 },
  execution_platform_fd_terminal: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  execution_platform_fd_foreground: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  execution_platform_thread_interactive: { args: [], returns: FFIType.i32 },
  execution_platform_reactor_open: { args: [FFIType.ptr], returns: FFIType.ptr },
  execution_platform_reactor_arm: { args: [FFIType.ptr, FFIType.i32, FFIType.u64, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  execution_platform_reactor_take: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  execution_platform_reactor_close: { args: [FFIType.ptr], returns: FFIType.i32 },
  execution_platform_reactor_dispose: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const;

export type ReactorHandle = Pointer & { readonly __executionReactor: never };

export type Reception = { readonly count: number; readonly fds: ReadonlyArray<number>; readonly capacity: boolean };

export class Descriptors {
  private constructor(private readonly library: ReturnType<typeof dlopen<typeof SYMBOLS>>) {}

  static load(path: string): Descriptors {
    return new Descriptors(dlopen(path, SYMBOLS));
  }

  unload(): void {
    this.library.close();
  }

  private refused(code: number): Refused {
    const refusal = refusalOf(code);
    if (refusal !== 'failed' && refusal !== 'invalid') return { refusal, detail: '' };
    const pointer = this.library.symbols.execution_platform_error();
    return { refusal, detail: pointer === null ? '' : new CString(pointer).toString() };
  }

  private answer(code: number): NativeAnswer {
    return code >= 0 ? { count: code } : this.refused(code);
  }

  private status(code: number): NativeStatus {
    return code >= 0 ? undefined : this.refused(code);
  }

  home(): { readonly path: string } | Refused {
    const home = this.library.symbols.execution_platform_user_home();
    return home === null ? this.refused(-1) : { path: new CString(home).toString() };
  }

  read(fd: number, landing: Uint8Array): NativeAnswer {
    return this.answer(this.library.symbols.execution_platform_fd_read(fd, ptr(landing), landing.length));
  }

  write(fd: number, bytes: Uint8Array): NativeAnswer {
    return this.answer(this.library.symbols.execution_platform_fd_write(fd, ptr(bytes), bytes.length));
  }

  close(fd: number): NativeStatus {
    return this.status(this.library.symbols.execution_platform_fd_close(fd));
  }

  receive(fd: number, landing: Uint8Array, slots: Int32Array): Reception | Refused {
    const carried = new Int32Array(2);
    const code = this.library.symbols.execution_platform_fd_receive(
      fd,
      ptr(landing),
      landing.length,
      ptr(slots),
      slots.length,
      ptr(carried),
    );
    if (code < 0) return this.refused(code);
    return { count: code, fds: Array.from(slots.subarray(0, carried[0]!)), capacity: carried[1] === 1 };
  }

  pair(): { readonly ends: readonly [number, number] } | Refused {
    const ends = new Int32Array(2);
    const code = this.library.symbols.execution_platform_fd_pair(ptr(ends));
    return code < 0 ? this.refused(code) : { ends: [ends[0]!, ends[1]!] };
  }

  groupState(group: number, leader: number, leaderExited: boolean): WorkState | Refused {
    const code = this.library.symbols.execution_platform_group_state(group, leader, Number(leaderExited));
    if (code < 0) return this.refused(code);
    return code === 0 ? 'ended' : code === 1 ? 'standing' : 'unmeasured';
  }

  resize(fd: number, rows: number, cols: number): NativeStatus {
    return this.status(this.library.symbols.execution_platform_fd_resize(fd, rows, cols));
  }

  interrupt(fd: number): NativeAnswer {
    return this.answer(this.library.symbols.execution_platform_fd_interrupt(fd));
  }

  foreground(fd: number): ProcessWitness | Refused {
    const values = new BigUint64Array(3);
    const code = this.library.symbols.execution_platform_fd_foreground(fd, ptr(values));
    if (code < 0) return this.refused(code);
    return { pid: Number(values[0]!), birth: birthOf(values[1]!, values[2]!) };
  }

  terminal(fd: number, pid: number): { readonly facts: TerminalFacts } | Refused {
    const values = new BigUint64Array(13);
    const code = this.library.symbols.execution_platform_fd_terminal(fd, pid, ptr(values));
    if (code < 0) return this.refused(code);
    const [leader, pgid, sid, foreground, rows, cols, interrupt, isig, canonical, echo, echoControl, noFlush, external] = Array.from(
      values,
      Number,
    ) as [number, number, number, number, number, number, number, number, number, number, number, number, number];
    return {
      facts: {
        pid: leader,
        pgid,
        sid,
        foreground,
        rows,
        cols,
        interrupt,
        isig: isig !== 0,
        canonical: canonical !== 0,
        echo: echo !== 0,
        echoControl: echoControl !== 0,
        noFlush: noFlush !== 0,
        external: external !== 0,
      },
    };
  }

  interactive(): NativeStatus {
    return this.status(this.library.symbols.execution_platform_thread_interactive());
  }

  openReactor(callback: JSCallback): { readonly reactor: ReactorHandle } | Refused {
    const handle = this.library.symbols.execution_platform_reactor_open(callback.ptr);
    return handle === null ? this.refused(-1) : { reactor: handle as ReactorHandle };
  }

  arm(reactor: ReactorHandle, fd: number, token: number, read: boolean, write: boolean): NativeStatus {
    return this.status(this.library.symbols.execution_platform_reactor_arm(reactor, fd, token, Number(read), Number(write)));
  }

  take(reactor: ReactorHandle, out: BigUint64Array): NativeAnswer {
    return this.answer(this.library.symbols.execution_platform_reactor_take(reactor, ptr(out), out.length));
  }

  closeReactor(reactor: ReactorHandle): { readonly state: 'closed' | 'retiring' } | Refused {
    const code = this.library.symbols.execution_platform_reactor_close(reactor);
    if (code < 0) return this.refused(code);
    return { state: code === 0 ? 'closed' : 'retiring' };
  }

  disposeReactor(reactor: ReactorHandle): NativeStatus {
    return this.status(this.library.symbols.execution_platform_reactor_dispose(reactor));
  }
}
