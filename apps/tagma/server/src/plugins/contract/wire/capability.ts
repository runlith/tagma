import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const pluginsCapability = {
  id: 'plugins',
  description: 'plugins on this machine: the tools of those enabled in this project, and installing, enabling or reading one',
  sections: ['plugins'],
} as const satisfies CapabilityDeclaration;
