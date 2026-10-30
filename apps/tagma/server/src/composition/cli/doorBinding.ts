import type { VerbBinding } from './binding.js';

export const door = async () => {
  const [{ door: bound }, { here, lens }] = await Promise.all([import('./door.js'), import('../../cli/door.js')]);
  return { ...bound, here, lens };
};

export const EXTERNAL_HARNESS_BINDINGS: readonly VerbBinding[] = [
  async () => (await door()).client,
  async () => {
    const { ask, here } = await door();
    return { ask, here };
  },
  async () => (await import('./harnessCatalog.js')).HARNESS_CATALOG,
  async () => (await import('../adapters.js')).BUILTIN_HOSTED_RUNNERS,
];
