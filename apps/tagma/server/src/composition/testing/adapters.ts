import type { AdapterSource } from '../../providers/contract/service/registry.js';
import { BUILTIN_ADAPTERS } from '../adapters.js';

const fixture = (id: string, load: AdapterSource['load']): AdapterSource => ({ id, title: id, origin: 'builtin', version: null, load });

export const TESTING_ADAPTERS: readonly AdapterSource[] = [
  ...BUILTIN_ADAPTERS,
  fixture('subscription', async () => (await import('@runlith/builtin-catalog/subscription/adapter')).adapter),
  fixture('device-fixture', async () => (await import('./deviceAdapter.js')).adapter),
  fixture('ask-program', async () => (await import('./askProgram.js')).adapter),
];
