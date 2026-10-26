import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const NATIVE_CAPABILITIES = [
  {
    id: 'agents',
    description: 'reading agent definitions and prompts, and writing file declarations',
    sections: ['agent-definitions'],
  },
  { id: 'files', description: 'the files of the tree the thread stands in', sections: [] },
  { id: 'shell', description: 'a shell, a file walk and a content search over the tree', sections: [] },
  { id: 'web', description: 'fetching a page and searching the web', sections: [] },
  { id: 'skills', description: 'loading a skill and the tools it unlocks', sections: [] },
] as const satisfies readonly CapabilityDeclaration[];
