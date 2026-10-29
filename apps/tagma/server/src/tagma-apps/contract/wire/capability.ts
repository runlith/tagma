import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const tagmaAppsCapability = {
  id: 'apps',
  description: 'apps on this machine: the tools of those enabled in this project, and installing, enabling or reading one',
  sections: ['apps'],
} as const satisfies CapabilityDeclaration;
