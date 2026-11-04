import type { Effect, FileSystem, Scope } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { HolderUnavailable } from '../../holder-client/Connection';
import type { ChannelFailed } from '../../holder/Holder';

export type FixtureProcess = {
  readonly exited: Effect.Effect<number, HolderUnavailable>;
  readonly exitCode: () => number | null;
  readonly kill: Effect.Effect<void, HolderUnavailable>;
};

export type FixtureSystem = {
  readonly libc: string;
  readonly nofile: number;
  readonly errno: string;
  readonly priorities: { readonly low: string; readonly lowest: string };
  readonly background: (pid: number) => Effect.Effect<boolean, ChannelFailed>;
  readonly isolated: (
    command: readonly string[],
  ) => Effect.Effect<
    (FixtureProcess & { readonly fd: number; readonly disconnect: Effect.Effect<void> }) | undefined,
    HolderUnavailable,
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  >;
};
