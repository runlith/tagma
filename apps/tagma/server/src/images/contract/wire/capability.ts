import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const imagesCapability = {
  id: 'images',
  description: 'drawing and changing pictures with an image model of a signed-in provider',
  sections: [],
  joins: ['tagma'],
} as const satisfies CapabilityDeclaration;
