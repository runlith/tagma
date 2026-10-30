import type { AdapterSource } from '../../providers/contract/service/registry.js';
import { BUILTIN_ADAPTERS } from '../adapters.js';

export const TESTING_ADAPTERS: readonly AdapterSource[] = [
  ...BUILTIN_ADAPTERS,
  { id: 'subscription', origin: 'builtin', version: null, load: () => import('@runlith/builtin-catalog/subscription/adapter') },
  { id: 'device-fixture', origin: 'builtin', version: null, load: () => import('./deviceAdapter.js') },
  { id: 'ask-program', origin: 'builtin', version: null, load: () => import('./askProgram.js') },
];
