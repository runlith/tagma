import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Layer } from 'effect';
import type { World } from '@runlith/agent-tools/world';
import { workspaceLayer } from '../../workspace/layer.js';
import { RootHoldings } from '../../workspace/contract/service/roots.js';
import { hostEnvironmentLayer } from '../../executions/testing/doubles.js';
import { EnvironmentBackends } from '../../workspace/contract/service/environments.js';
import { backendRegistry } from '../../workspace/testing/doubles.js';

export const hostWorkspace = (world: World) =>
  workspaceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.effect(
          EnvironmentBackends,
          Effect.map(hostEnvironmentLayer(world), (backend) => backendRegistry([backend])),
        ).pipe(Layer.provide(BunFileSystem.layer)),
        Layer.succeed(RootHoldings, { has: () => Effect.succeed(false) }),
      ),
    ),
  );
