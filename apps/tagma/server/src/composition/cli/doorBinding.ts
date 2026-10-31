import type { Channel } from '../../installation/contract/wire/channel.js';
import type { VerbBinding } from './binding.js';

export const doorFor = (channel: Channel) => async () => {
  const [{ doorOf }, { here, lens }] = await Promise.all([import('./door.js'), import('../../cli/door.js')]);
  return { ...doorOf(channel), here, lens };
};

export const externalHarnessBindings = (channel: Channel): readonly VerbBinding[] => {
  const door = doorFor(channel);
  return [
    async () => (await door()).client,
    async () => {
      const { ask, here } = await door();
      return { ask, here };
    },
    async () => (await import('./harnessCatalog.js')).HARNESS_CATALOG,
    async () => (await import('../adapters.js')).BUILTIN_HOSTED_RUNNERS,
  ];
};
