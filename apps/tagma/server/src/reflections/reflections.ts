import { reflections as declaration } from './contract/wire/module.js';
import { manifest } from '../platform/contract/service/manifest.js';
import { reflectionsCapability } from './contract/wire/capability.js';
import { friction } from './doctrine/friction.js';

export const reflections = manifest({
  ...declaration,
  capabilities: [reflectionsCapability],
  bodies: async () => Object.values((await import('./operations.js')).FILING_PAIRS),
  sections: [
    {
      id: 'tagma-friction',
      place: { prompt: 125, law: 115 },
      owner: 'reflections',
      render: friction,
      path: 'src/reflections/doctrine/friction.ts',
    },
  ],
});
