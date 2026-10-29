import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const pluginsCapability = {
  id: 'plugins',
  description: 'agent plugins on this machine: installing, enabling or reading one',
  sections: [],
} as const satisfies CapabilityDeclaration;
