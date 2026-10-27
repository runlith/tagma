import { installation as declaration } from './contract/wire/module.js';
import { Context, Effect, Stream } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { refusing } from '../platform/contract/service/body.js';
import { MachineHost } from './contract/service/machineHost.js';
import { NextInstallation } from './contract/service/next.js';
import { ServerProcess, Succession } from './contract/service/succession.js';
import { NEXT_FEED } from './contract/wire/next.js';
import { installationVerbs } from './cli.js';
import { wiringARepository } from './doctrine/wiringARepository.js';
import { framesWithNewHost } from './newHost.js';

export const installation = manifest({
  ...declaration,
  verbs: installationVerbs,
  live: liveOf([NEXT_FEED] as const, (door: Context.Context<NextInstallation | Succession | MachineHost | ServerProcess>) => ({
    'installation.next': () =>
      Stream.catch(
        framesWithNewHost({
          next: Context.get(door, NextInstallation),
          succession: Context.get(door, Succession),
          machineHost: Context.get(door, MachineHost),
          runs: Context.get(door, ServerProcess).source.installation,
        }),
        (failure) => Stream.fromEffect(refusing(Effect.fail(failure))),
      ),
  })),
  bodies: async () => Object.values((await import('./operations/pairs.js')).INSTALLATION_PAIRS),
  lifetimes: {
    installation: lazyLayer(
      () => import('./registry/export.js'),
      ({ registryExportLayer }) => registryExportLayer,
    ),
  },
  sections: [
    {
      id: 'wiring-a-repository',
      place: { 'SKILL.md': 10 },
      owner: 'installation',
      render: wiringARepository,
      path: 'src/installation/doctrine/wiringARepository.ts',
    },
  ],
});
