import { Effect, Layer } from 'effect';
import { type AdapterInstalls, PackageHolders } from '../contract/service/adapters.js';

export const sessionless = PackageHolders.of({ standing: () => new Set(), recorded: Effect.succeed(new Set()) });

export const sessionlessLayer = Layer.succeed(PackageHolders, sessionless);

const uninstalled = () => Effect.die('this fixture installs no adapters');

export const noInstalls: AdapterInstalls['Service'] = {
  install: uninstalled,
  update: uninstalled,
  remove: uninstalled,
  disable: uninstalled,
  enable: uninstalled,
  hold: () => Effect.succeed(true),
};
