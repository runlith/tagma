import { invocation as declaration } from './contract/wire/module.js';
import { manifest } from '../platform/contract/service/manifest.js';

export const invocation = manifest({
  ...declaration,
  bodies: async () => [(await import('./readOperations.js')).READ_OPERATIONS_PAIR],
  tables: async () => {
    const { callPlace } = await import('./store/places.js');
    return { entities: [], history: [callPlace] };
  },
});
