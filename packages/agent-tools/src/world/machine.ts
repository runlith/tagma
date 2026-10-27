import { tmpdir } from 'node:os';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { ToolFailed } from '@runlith/agent/tool';
import { Effect, Layer } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { resolveRipgrepPath } from '@runlith/ripgrep';
import { bunSpawner } from '@runlith/executions/bunSpawner';
import type { World } from '../world';
import { gitLayer } from '@runlith/git/Git';
import { workingAt } from '@runlith/files/working';
import { machineEntries } from '@runlith/files/entries';

const HOST_SHELL = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';

const hostPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const hostExec: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> =
  process.platform === 'win32' ? BunChildProcessSpawner.layer.pipe(Layer.provide(hostPlatform)) : bunSpawner();

const hostRipgrep: Effect.Effect<string, ToolFailed> = Effect.tryPromise({
  try: () => resolveRipgrepPath(),
  catch: (error) => new ToolFailed({ reason: error instanceof Error ? error.message : `ripgrep is unavailable: ${String(error)}` }),
});

export const machineWorld = {
  files: BunFileSystem.layer,
  entries: machineEntries,
  exec: hostExec,
  git: gitLayer.pipe(Layer.provide(hostExec)),
  working: workingAt,
  egress: {
    fetch: globalThis.fetch,
    fetchDefaultMs: 30_000,
    fetchCeilingMs: 120_000,
    searchMs: 25_000,
  },
  environment: {
    platform: process.platform,
    shell: HOST_SHELL,
    tmp: tmpdir(),
    executables: { ripgrep: hostRipgrep },
  },
} satisfies World;
