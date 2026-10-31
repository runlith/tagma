import { Effect, Layer } from 'effect';
import { browserWorld } from '../../browser/testing/world.js';
import { desktopAdapter } from '../adapter.js';
import { scopedHome } from './home.js';

export const desktopWorld = (prefix: string) =>
  Layer.unwrap(Effect.map(scopedHome(prefix), (home) => browserWorld({ host: Layer.empty, adapters: [desktopAdapter], home })));
