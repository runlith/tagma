import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

const WORKSPACE_TOOLS_MODULE = '@runlith/agent-tools';

export const FILE_TOOLS = { read: 'eager', write: 'eager', edit: 'eager', delete: 'deferred', rename: 'deferred', ls: 'eager' } as const;
export const SHELL_TOOLS = { bash: 'eager', glob: 'eager', grep: 'eager' } as const;
export const WEB_TOOLS = ['webfetch', 'websearch'] as const;

export const NATIVE_CAPABILITIES = [
  {
    id: 'agents',
    description: 'reading agent definitions and prompts, and writing file declarations',
    sections: ['agent-definitions'],
  },
  {
    id: 'files',
    description: 'the files of the tree the thread stands in',
    sections: [],
    toolCode: { module: WORKSPACE_TOOLS_MODULE, names: Object.keys(FILE_TOOLS) },
  },
  {
    id: 'shell',
    description: 'a shell, a file walk and a content search over the tree',
    sections: [],
    toolCode: { module: WORKSPACE_TOOLS_MODULE, names: Object.keys(SHELL_TOOLS) },
  },
  {
    id: 'web',
    description: 'fetching a page and searching the web',
    sections: [],
    toolCode: { module: WORKSPACE_TOOLS_MODULE, names: WEB_TOOLS },
  },
  { id: 'skills', description: 'loading a skill and the tools it unlocks', sections: [] },
] as const satisfies readonly CapabilityDeclaration[];
