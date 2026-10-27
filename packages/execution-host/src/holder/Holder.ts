import { Context, Data, type Effect } from 'effect';
import type { Incarnation, NativeExit, ProcessCost } from '@runlith/executions/protocol/execution';
import type { LaunchTransport } from '@runlith/executions/protocol/launch';
import type { Pace } from '@runlith/executions/protocol/pace';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { Capability } from '@runlith/executions/protocol/capability';
import type { HolderLoss } from '@runlith/executions/protocol/runtime';
import type { ForegroundRefusal } from '@runlith/executions/protocol/terminal';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';

export const ACTIVATE_EXIT = 75;

export class ChannelFailed extends Data.TaggedError('ChannelFailed')<{
  readonly reason: 'closed' | 'gone' | 'os' | 'stopped';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class HolderRefused extends Data.TaggedError('HolderRefused')<{
  readonly act:
    | 'launch'
    | 'exit'
    | 'observe'
    | 'act'
    | 'signal'
    | 'pace'
    | 'close-input'
    | 'close-output'
    | 'reap'
    | 'release'
    | 'ready'
    | 'vacate'
    | 'bind-generation'
    | 'prepare'
    | 'activate';
  readonly reason:
    | 'duplicate'
    | 'unknown'
    | 'reaped'
    | 'running'
    | 'transport'
    | 'os'
    | 'invalid'
    | 'lost'
    | 'unsupported'
    | 'capacity'
    | 'gone'
    | 'changed'
    | 'not-found'
    | 'denied'
    | 'timeout';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class HolderLaunchUncertain extends Data.TaggedError('HolderLaunchUncertain')<{
  readonly execution: string;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export type Readable = {
  readonly read: (limit?: number) => Effect.Effect<Uint8Array | undefined, ChannelFailed>;
  readonly stopReading: Effect.Effect<void>;
};

export type Writable = {
  readonly write: (bytes: Uint8Array) => Effect.Effect<number, ChannelFailed>;
  readonly stopWriting: Effect.Effect<void>;
};

export class ForegroundRefused extends Data.TaggedError('ForegroundRefused')<{
  readonly reason: ForegroundRefusal['reason'];
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class TerminalInterruptRefused extends Data.TaggedError('TerminalInterruptRefused')<{
  readonly reason: 'isig-disabled' | 'no-character';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export type Terminal = Readable &
  Writable & {
    readonly resize: (rows: number, cols: number) => Effect.Effect<void, ChannelFailed>;
    readonly size: Effect.Effect<{ readonly rows: number; readonly cols: number }, ChannelFailed>;
    readonly foreground: Effect.Effect<ProcessWitness, ForegroundRefused>;
    readonly interrupt: (onFlush?: () => void) => Effect.Effect<number, TerminalInterruptRefused | ChannelFailed>;
    readonly pendingEchoes: Effect.Effect<ReadonlyArray<PendingEcho>>;
    readonly owe: (echoes: ReadonlyArray<PendingEcho>) => Effect.Effect<void>;
  };

export type PendingEcho = { readonly after: number; readonly bytes: Uint8Array; readonly output?: true };

export type HeldChannels =
  | { readonly _tag: 'pty'; readonly terminal: Terminal | undefined }
  | {
      readonly _tag: 'pipes';
      readonly stdout: Readable;
      readonly stderr: Readable;
      readonly stdin: Writable | undefined;
      readonly input: 'absent' | 'open' | 'closed';
    };

export type HeldLaunch = {
  readonly id: string;
  readonly path: string;
  readonly argv: ReadonlyArray<string>;
  readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly cwd: string | undefined;
  readonly transport: LaunchTransport;
  readonly pace: Pace;
};

export type WorkState = 'ended' | 'standing' | 'unmeasured';

export type HeldReap = {
  readonly exit: NativeExit;
  readonly cost: ProcessCost;
};

export type HeldExecution = {
  readonly id: string;
  readonly pid: number;
  readonly work: number;
  readonly birth: string;
  readonly terminal: string | undefined;
  readonly pace: Pace;
  readonly channels: HeldChannels;
  readonly exit: Effect.Effect<NativeExit, HolderRefused>;
  readonly observed: Effect.Effect<NativeExit | undefined>;
  readonly observe: Effect.Effect<NativeExit | undefined, HolderRefused>;
  readonly workState: Effect.Effect<WorkState>;
  readonly reaped: HeldReap | undefined;
  readonly act: (target: 'leader' | 'work', step: StopStep) => Effect.Effect<void, HolderRefused>;
  readonly signal: (target: 'leader' | 'work', name: string) => Effect.Effect<void, HolderRefused>;
  readonly closeInput: Effect.Effect<void, HolderRefused>;
  readonly closeOutput: Effect.Effect<void, HolderRefused>;
  readonly reap: Effect.Effect<HeldReap, HolderRefused>;
  readonly release: Effect.Effect<void, HolderRefused>;
};

export type TransportDescriptors = { readonly pty: number; readonly pipes: number };

export type PaceAsk = { readonly witness: ProcessWitness; readonly initial: Pace; readonly next: Pace };

export type PaceKept =
  | { readonly _tag: 'held' }
  | { readonly _tag: 'moved' }
  | { readonly _tag: 'refused'; readonly reason: HolderRefused['reason']; readonly detail: string };

export type NextBundle = {
  readonly holder: string;
  readonly logic: ReadonlyArray<string>;
};

export class Holder extends Context.Service<
  Holder,
  {
    readonly pid: number;
    readonly generation: Effect.Effect<Incarnation | undefined>;
    readonly bindGeneration: (generation: Incarnation) => Effect.Effect<void, HolderRefused>;
    readonly capabilities: ReadonlySet<Capability>;
    readonly descriptors: {
      readonly limit: number | 'absent';
      readonly expense: TransportDescriptors;
      readonly copies: TransportDescriptors;
    };
    readonly held: ReadonlyArray<HeldExecution>;
    readonly launch: (launch: HeldLaunch) => Effect.Effect<HeldExecution, HolderRefused | HolderLaunchUncertain>;
    readonly pace: (processes: ReadonlyArray<PaceAsk>) => Effect.Effect<ReadonlyArray<PaceKept>, HolderRefused>;
    readonly ready: Effect.Effect<void, HolderRefused>;
    readonly vacate: Effect.Effect<void, HolderRefused>;
    readonly prepare: (next: NextBundle) => Effect.Effect<void, HolderRefused>;
    readonly activate: Effect.Effect<void, HolderRefused>;
    readonly lost: Effect.Effect<HolderLoss>;
  }
>()('@runlith/execution-host/Holder') {}
