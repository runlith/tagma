import { machineWorld as platformWorld } from '@runlith/agent-tools/world/machine';
import type { World } from '@runlith/agent-tools/world';
import { Effect, Layer } from 'effect';
import { gitLayer } from '@runlith/git/Git';
import { ledgeredSpawner } from '../../platform/git/ledgered.js';

export const makeMachineWorld = (carriedRipgrep: () => string | null) =>
  ({
    ...platformWorld,
    git: gitLayer.pipe(Layer.provide(ledgeredSpawner('git').pipe(Layer.provide(platformWorld.exec)))),
    environment: {
      ...platformWorld.environment,
      executables: {
        ripgrep: Effect.suspend(() => {
          const carried = carriedRipgrep();
          return carried === null ? platformWorld.environment.executables.ripgrep : Effect.succeed(carried);
        }),
      },
    },
  }) satisfies World;
