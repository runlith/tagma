import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const reflectionsCapability = {
  id: 'reflections',
  description: "filing friction with Tagma itself into Tagma's own graph",
  sections: ['tagma-friction'],
  joins: ['tagma'],
} as const satisfies CapabilityDeclaration;
