import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const THREAD_CAPABILITIES = [
  {
    id: 'threads',
    description: "reading and acting on the project's threads",
    sections: ['threads-as-evidence'],
  },
  {
    id: 'peers',
    description: 'spawning and speaking to other agents',
    sections: ['keep-warm'],
    runtimeSources: ['collaboration'],
  },
  {
    id: 'resources',
    description: 'what this thread holds — its scratch, its rollout, the bytes its tools kept',
    sections: [],
    runtimeSources: ['resources'],
  },
] as const satisfies readonly CapabilityDeclaration[];
