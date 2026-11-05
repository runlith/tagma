import { Effect } from 'effect';
import type { ReleasePlatform } from '../platform.js';

const unreached = (): never => {
  throw new Error('the fixture platform builds nothing past its admission');
};

export const inertPlatform: ReleasePlatform = {
  refusal: () => null,
  application: (channel) => ({ bundle: `${channel}.app`, binary: `${channel}.app/${channel}` }),
  signer: Effect.die('the fixture platform signs nothing'),
  releaseSigner: () => Effect.die('the fixture platform signs nothing'),
  notice: unreached,
  seal: () => Effect.die('the fixture platform seals nothing'),
  targets: [],
  native: () => null,
  trouble: () => Effect.die('the fixture platform cuts no release'),
  runtime: unreached,
  speech: [],
  pack: () => Effect.die('the fixture platform packs nothing'),
  image: { name: unreached, make: () => Effect.die('the fixture platform makes no image') },
  notary: () => Effect.die('the fixture platform notarizes nothing'),
  trial: () => Effect.die('the fixture platform tries nothing'),
};
