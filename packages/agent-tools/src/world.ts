import type { ToolFailed } from '@runlith/agent/tool';
import type { CommandClass, CommandExit } from '@runlith/executions/protocol/command';
import type { ProcessCost } from '@runlith/executions/protocol/execution';
import type { Effect, Layer } from 'effect';
import type { FileSystem } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { CommandWork } from './CommandWork';
import type { Git } from '@runlith/git/Git';
import type { workingAt } from '@runlith/files/working';
import type { Entries } from '@runlith/files/entries';

export type Egress = {
  readonly fetch: typeof globalThis.fetch;
  readonly fetchDefaultMs: number;
  readonly fetchCeilingMs: number;
  readonly searchMs: number;
};

export type FinishedCommand = {
  readonly class: CommandClass;
  readonly monotonicStart: number;
  readonly monotonicEnd: number;
  readonly exit: CommandExit;
  readonly cost: ProcessCost;
};

export type Commands = {
  readonly finished: (command: FinishedCommand) => Effect.Effect<void>;
};

export type WorldExecutables = {
  readonly ripgrep: Effect.Effect<string, ToolFailed>;
};

export type WorldEnvironment = {
  readonly platform: string;
  readonly shell: string;
  readonly home?: string;
  readonly tmp: string;
  readonly executables: WorldExecutables;
};

export type World = {
  readonly files?: Layer.Layer<FileSystem.FileSystem>;
  readonly entries?: Entries;
  readonly exec?: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly git?: Layer.Layer<Git>;
  readonly working?: typeof workingAt;
  readonly egress?: Egress;
  readonly commandWork?: CommandWork;
  readonly commands?: Commands;
  readonly environment: WorldEnvironment;
};
