import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Layer } from 'effect';
import { ChildProcessSpawner } from 'effect/process';

export const hostSpawner: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> = BunChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
);
