import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Layer } from 'effect';
import { bunSpawner } from './bunSpawner';
import { processConformance } from './conformance/processSpawner';

processConformance('Bun child processes', bunSpawner({ detached: true }));
processConformance(
  'Node child processes',
  BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.merge(BunFileSystem.layer, BunPath.layer))),
);
