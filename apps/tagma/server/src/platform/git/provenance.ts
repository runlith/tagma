import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { gitCut } from './readings.js';
import { ownGitLayer } from './ownGit.js';
import type { ProcessProvenance } from '../contract/wire/provenance.js';

const HOST = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

export const measureProvenance = async (sourcePath: string): Promise<ProcessProvenance> => ({
  startedAt: new Date(performance.timeOrigin).toISOString(),
  revision: await Effect.runPromise(
    Effect.flatMap(Git, (git) => gitCut(git, sourcePath)).pipe(
      Effect.catchTags({ GitRefused: () => Effect.succeed(null), GitUnreadable: () => Effect.succeed(null) }),
      Effect.provide(ownGitLayer(gitLayer.pipe(Layer.provide(HOST)))),
    ),
  ),
});
